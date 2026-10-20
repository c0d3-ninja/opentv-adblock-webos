#!/bin/sh
# opentv-adblock control script.
#
#   ctl.sh status     show what is active
#   ctl.sh start      turn ad blocking on now
#   ctl.sh stop       turn ad blocking off now (back to stock behaviour)
#   ctl.sh restart    stop, then start
#   ctl.sh logs       show recent log lines
#   ctl.sh boot       used by the Homebrew Channel boot script
#
# Settings live in "config" next to this script.

DIR=$(cd "$(dirname "$0")" && pwd)
CONF="$DIR/config"
LOG="$DIR/opentv-adblock.log"
PLOG="$DIR/pvproxy.log"
LOOP_PID="$DIR/run-proxy.pid"
NODE_PID="$DIR/pvproxy.pid"
MARK="# opentv-adblock blocklist"
APP_ID=amazon

ENABLE_PRIME=1
ENABLE_HOSTS=1
PROXY_PORT=8888
REMOVE_REMOTE=1
RESTART_WAM=1
WAM_DELAY=20
[ -f "$CONF" ] && . "$CONF"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
say() { echo "$*"; log "$*"; }

rotate() {
  for f in "$LOG" "$PLOG"; do
    if [ -f "$f" ] && [ "$(wc -c < "$f")" -gt 1000000 ]; then mv "$f" "$f.old"; fi
  done
}

node_bin() { command -v node 2>/dev/null; }

listening() {
  if command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | grep -q "127.0.0.1:$PROXY_PORT "
  else
    node -e "require('net').connect($PROXY_PORT,'127.0.0.1').on('connect',function(){process.exit(0)}).on('error',function(){process.exit(1)})" 2>/dev/null
  fi
}

is_mounted() { grep -q " $1 " /proc/mounts 2>/dev/null; }

pid_alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

restart_wam() {
  # Web apps (SonyLIV, ZEE5, ...) run in the web-app engine, which caches DNS answers.
  # Restarting it makes them pick up the blocklist.
  if systemctl restart webapp-mgr.service 2>/dev/null; then log "web-app engine restarted (systemd)"
  elif initctl restart webapp-mgr 2>/dev/null; then log "web-app engine restarted (upstart)"
  else log "could not restart the web-app engine; reboot or reopen apps to apply the blocklist"
  fi
}

close_prime() {
  luna-send -n 1 luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$APP_ID\"}" >/dev/null 2>&1
}

# ---------------- Google ad-server blocklist (/etc/hosts) ----------------

hosts_active() { grep -q "^$MARK" /etc/hosts 2>/dev/null; }

hosts_start() {
  [ "$ENABLE_HOSTS" = 1 ] || return 1
  if hosts_active; then return 1; fi
  {
    cat /etc/hosts
    echo
    echo "$MARK"
    grep -v '^[[:space:]]*#' "$DIR/hosts.blocklist" | grep -v '^[[:space:]]*$'
    [ -f "$DIR/hosts.custom" ] && grep -v '^[[:space:]]*#' "$DIR/hosts.custom" | grep -v '^[[:space:]]*$'
  } > "$DIR/hosts.generated"
  if mount --bind "$DIR/hosts.generated" /etc/hosts; then
    log "blocklist active ($(grep -c '^0\.0\.0\.0' "$DIR/hosts.generated") domains)"
    return 0
  fi
  log "could not mount the blocklist over /etc/hosts"
  return 1
}

hosts_stop() {
  n=0
  while hosts_active && [ $n -lt 5 ]; do umount /etc/hosts 2>/dev/null || break; n=$((n + 1)); done
  hosts_active && log "could not remove the blocklist from /etc/hosts" || log "blocklist off"
}

# ---------------- Prime Video proxy ----------------

prime_dir() {
  d=$(luna-send -n 1 -f luna://com.webos.applicationManager/getAppInfo "{\"id\":\"$APP_ID\"}" 2>/dev/null \
      | sed -n 's/.*"folderPath": *"\([^"]*\)".*/\1/p' | head -n 1)
  for c in "$d" /media/cryptofs/apps/usr/palm/applications/$APP_ID /usr/palm/applications/$APP_ID; do
    if [ -n "$c" ] && [ -f "$c/appinfo.json" ]; then echo "$c"; return 0; fi
  done
  return 1
}

prime_supported() {
  # Only the Ignition-based (native) Prime Video app accepts the proxy options.
  grep -q '"main" *: *"bin/ignition"' "$1/appinfo.json" 2>/dev/null &&
    grep -q 'http-proxy-server' "$1/bin/ignition" 2>/dev/null
}

proxy_loop() {
  echo $$ > "$LOOP_PID"
  while [ -f "$LOOP_PID" ] && [ "$(cat "$LOOP_PID" 2>/dev/null)" = "$$" ]; do
    if ! listening; then
      PROXY_PORT=$PROXY_PORT REMOVE_REMOTE=$REMOVE_REMOTE PIDFILE="$NODE_PID" \
        node "$DIR/pvproxy.js" >> "$PLOG" 2>&1
      [ -f "$LOOP_PID" ] && log "proxy exited; restarting"
    fi
    sleep 5
  done
}

proxy_start() {
  pid_alive "$LOOP_PID" && return 0
  nohup sh "$DIR/ctl.sh" run-proxy </dev/null >/dev/null 2>&1 &
}

proxy_stop() {
  if [ -f "$LOOP_PID" ]; then
    p=$(cat "$LOOP_PID"); rm -f "$LOOP_PID"; kill "$p" 2>/dev/null
  fi
  if [ -f "$NODE_PID" ]; then
    kill "$(cat "$NODE_PID")" 2>/dev/null; rm -f "$NODE_PID"
  fi
}

prime_targets() {
  echo "$1/default_config.json"
  echo "/var/palm/jail/$APP_ID$1/default_config.json"
}

prime_start() {
  # $1 = seconds to wait for the proxy and for the app's jail folder
  wait=${1:-120}
  [ "$ENABLE_PRIME" = 1 ] || return 0
  if [ -z "$(node_bin)" ]; then log "Prime Video: Node.js not found, skipped"; return 0; fi
  if [ ! -f "$DIR/key.pem" ] || [ ! -f "$DIR/cert.pem" ]; then log "Prime Video: certificate missing, skipped"; return 0; fi

  dir=""; n=0
  while [ -z "$dir" ] && [ $n -lt "$wait" ]; do dir=$(prime_dir) || { sleep 5; n=$((n + 5)); }; done
  if [ -z "$dir" ]; then log "Prime Video: app not installed, skipped"; return 0; fi
  if ! prime_supported "$dir"; then log "Prime Video: this app version does not support a proxy, skipped ($dir)"; return 0; fi

  proxy_start
  n=0
  while ! listening && [ $n -lt "$wait" ]; do sleep 2; n=$((n + 2)); done
  if ! listening; then log "Prime Video: proxy did not start, app left untouched"; return 0; fi

  orig="$dir/default_config.json"
  if ! is_mounted "$orig"; then
    node "$DIR/primeconfig.js" "$orig" "$DIR/prime_config.json" "$PROXY_PORT" || { log "Prime Video: could not build config"; return 0; }
  fi

  mounted=0
  for t in $(prime_targets "$dir"); do
    case "$t" in /var/palm/jail/*)
      n=0
      while [ ! -f "$t" ] && [ $n -lt "$wait" ]; do sleep 2; n=$((n + 2)); done ;;
    esac
    [ -f "$t" ] || continue
    if is_mounted "$t" || mount --bind "$DIR/prime_config.json" "$t"; then mounted=$((mounted + 1)); fi
  done
  if [ $mounted -gt 0 ]; then log "Prime Video: routed through the proxy ($dir)"
  else log "Prime Video: no config file to override, app left untouched ($dir)"
  fi
}

prime_stop() {
  dir=$(prime_dir)
  if [ -n "$dir" ]; then
    for t in $(prime_targets "$dir"); do
      while is_mounted "$t"; do umount "$t" 2>/dev/null || break; done
    done
  fi
  proxy_stop
  log "Prime Video: proxy off"
}

# ---------------- commands ----------------

cmd_status() {
  echo "opentv-adblock  ($DIR)"
  echo "webOS:          $(cat /etc/starfish-release 2>/dev/null || echo unknown)"
  echo "Node.js:        $(node -v 2>/dev/null || echo 'not found')"
  echo
  if hosts_active; then echo "Google ad blocklist: ON  ($(grep -c '^0\.0\.0\.0' /etc/hosts) domains)"
  else echo "Google ad blocklist: OFF$( [ "$ENABLE_HOSTS" = 1 ] || echo ' (disabled in config)')"
  fi
  dir=$(prime_dir)
  if [ "$ENABLE_PRIME" != 1 ]; then echo "Prime Video proxy:   OFF (disabled in config)"
  elif [ -z "$dir" ]; then echo "Prime Video proxy:   app not installed"
  elif ! prime_supported "$dir"; then echo "Prime Video proxy:   not supported by this Prime Video version"
  else
    m=0; for t in $(prime_targets "$dir"); do is_mounted "$t" && m=$((m + 1)); done
    if listening && [ $m -gt 0 ]; then echo "Prime Video proxy:   ON  (port $PROXY_PORT)"
    elif listening; then echo "Prime Video proxy:   proxy running, app not routed yet"
    else echo "Prime Video proxy:   OFF"
    fi
    [ -f "$PLOG" ] && echo "                     ad breaks removed so far: $(grep -c 'Remote ad break' "$PLOG")"
  fi
}

case "$1" in
  boot)
    rotate
    log "boot"
    if hosts_start && [ "$RESTART_WAM" = 1 ]; then
      ( sleep "$WAM_DELAY"; restart_wam ) </dev/null >/dev/null 2>&1 &
    fi
    ( prime_start 120 ) </dev/null >/dev/null 2>&1 &
    ;;
  start)
    rotate
    if hosts_start && [ "$RESTART_WAM" = 1 ]; then restart_wam; fi
    close_prime
    prime_start 30
    cmd_status
    ;;
  stop)
    prime_stop
    hosts_stop
    close_prime
    [ "$RESTART_WAM" = 1 ] && restart_wam
    cmd_status
    ;;
  restart)
    sh "$0" stop >/dev/null
    sh "$0" start
    ;;
  status) cmd_status ;;
  logs)
    echo "== $LOG"; tail -n 20 "$LOG" 2>/dev/null
    echo "== $PLOG"; tail -n 30 "$PLOG" 2>/dev/null
    ;;
  run-proxy) proxy_loop ;;
  *)
    echo "usage: $0 {status|start|stop|restart|logs}"
    exit 1
    ;;
esac
