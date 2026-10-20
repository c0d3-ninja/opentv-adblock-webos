#!/bin/sh
# opentv-adblock installer for rooted LG webOS TVs (Homebrew Channel).
#
# Run on the TV as root, from the project folder:
#   sh install.sh              install (or update) and turn it on now
#   sh install.sh --no-start   install only; it turns on at the next boot
#
# Environment: INSTALL_DIR (default /home/root/opentv-adblock)

SRC=$(cd "$(dirname "$0")" && pwd)
DEST=${INSTALL_DIR:-/home/root/opentv-adblock}
INIT_DIR=/var/lib/webosbrew/init.d
BOOT_SCRIPT="$INIT_DIR/70opentv-adblock"
START=1
[ "$1" = "--no-start" ] && START=0

die() { echo "error: $*" >&2; exit 1; }
warn() { echo "warning: $*" >&2; }

# ---- checks ----
[ "$(id -u)" = 0 ] || die "run this as root on the TV"
command -v luna-send >/dev/null 2>&1 || die "this does not look like a webOS TV (luna-send not found)"
[ -d /var/lib/webosbrew ] || die "Homebrew Channel with root access is required (/var/lib/webosbrew not found)"
[ -f "$SRC/src/pvproxy.js" ] || die "run install.sh from the opentv-adblock-webos folder"

echo "webOS: $(cat /etc/starfish-release 2>/dev/null || echo unknown)"

PRIME=1
if ! command -v node >/dev/null 2>&1; then
  warn "Node.js not found: Prime Video ad removal disabled (Google ad blocking still works)"
  PRIME=0
else
  major=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
  echo "Node.js: $(node -v)"
  if [ "${major:-0}" -lt 8 ]; then
    warn "Node.js 8 or newer is needed for Prime Video ad removal; it is disabled"
    PRIME=0
  fi
fi
if [ $PRIME = 1 ] && ! command -v openssl >/dev/null 2>&1 && [ ! -f "$DEST/key.pem" ]; then
  warn "openssl not found: Prime Video ad removal disabled (Google ad blocking still works)"
  PRIME=0
fi

# ---- stop a previous install before updating ----
if [ -f "$DEST/ctl.sh" ]; then
  echo "Updating the existing install in $DEST"
  sh "$DEST/ctl.sh" stop >/dev/null 2>&1
fi

# ---- copy files ----
mkdir -p "$DEST" "$INIT_DIR" || die "cannot create $DEST"
for f in pvproxy.js primeconfig.js ctl.sh hosts.blocklist; do
  cp "$SRC/src/$f" "$DEST/$f" || die "cannot copy $f"
done
cp "$SRC/uninstall.sh" "$DEST/uninstall.sh"
chmod 755 "$DEST/ctl.sh" "$DEST/uninstall.sh"

# ---- per-TV certificate (only secures the hop between the app and the proxy on this TV) ----
if [ $PRIME = 1 ] && { [ ! -f "$DEST/key.pem" ] || [ ! -f "$DEST/cert.pem" ]; }; then
  echo "Generating a certificate for this TV..."
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=opentv-adblock" \
    -keyout "$DEST/key.pem" -out "$DEST/cert.pem" >/dev/null 2>&1 || { warn "certificate generation failed; Prime Video ad removal disabled"; PRIME=0; }
  chmod 600 "$DEST/key.pem" 2>/dev/null
fi

# ---- settings (kept on update) ----
if [ ! -f "$DEST/config" ]; then
  cat > "$DEST/config" <<EOF
# opentv-adblock settings. Run "sh $DEST/ctl.sh restart" after changing them.
ENABLE_PRIME=$PRIME      # Prime Video ad removal (on-device proxy)
ENABLE_HOSTS=1           # block Google ad servers for the whole TV
PROXY_PORT=8888          # local port for the Prime Video proxy
REMOVE_REMOTE=1          # 0 = only hide ad markers/pause ads (uBlock-style), keep ad entries
RESTART_WAM=1            # restart the web-app engine so web apps pick up the blocklist
WAM_DELAY=20             # seconds to wait after boot before that restart
EOF
elif [ $PRIME = 0 ]; then
  sed -i 's/^ENABLE_PRIME=1/ENABLE_PRIME=0/' "$DEST/config"
fi
[ -f "$DEST/hosts.custom" ] || printf '# Extra domains to block, one per line, e.g.\n# 0.0.0.0 ads.example.com\n' > "$DEST/hosts.custom"

# ---- boot script ----
cat > "$BOOT_SCRIPT" <<EOF
#!/bin/sh
# opentv-adblock: turns ad blocking on at boot. Remove with: sh $DEST/uninstall.sh
[ -f "$DEST/ctl.sh" ] && sh "$DEST/ctl.sh" boot
EOF
chmod 755 "$BOOT_SCRIPT"

echo "Installed to $DEST (boot script: $BOOT_SCRIPT)"

if [ $START = 1 ]; then
  echo "Turning it on..."
  sh "$DEST/ctl.sh" start
else
  echo "It will turn on at the next boot. To start now: sh $DEST/ctl.sh start"
fi
