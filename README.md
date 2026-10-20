# opentv-adblock-webos

Ad blocking for **rooted LG webOS TVs**. It runs entirely on the TV, needs no other device, and turns itself on at every boot.

| | What it does | How |
|---|---|---|
| **Prime Video** | Removes ad breaks, the ad markers on the progress bar, and pause ads | A small on-device proxy edits the app's playback data before the player reads it |
| **Google ads, TV-wide** | Blocks Google's ad servers for every app and the browser (SonyLIV, ZEE5, Hotstar, banner ads, ...) | Adds Google's ad-serving domains to the TV's hosts file |

## Requirements

- An LG webOS TV **rooted** with [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) (root status must show *ok*)
- Telnet or SSH access to the TV as root
- For Prime Video: Node.js 8 or newer and `openssl` on the TV. Both are included in webOS 4 and later. Without them, only the Google ad blocking is installed.

## Install

On the TV, as root, paste this one line:

```sh
curl -fsSL https://raw.githubusercontent.com/c0d3-ninja/opentv-adblock-webos/main/install.sh | sh
```

No internet on the TV? Copy this project folder to the TV (for example with `scp`) and run `sh install.sh` inside it.

The installer downloads the current release, checks every file against its checksum (it warns if the TV has no `sha256sum` to do that), creates a certificate for your TV, installs to `/home/root/opentv-adblock`, adds a boot script to Homebrew Channel and turns everything on. It ends with **"Done! opentv-adblock is installed."** If something didn't turn on, it says so and points you to `ctl.sh logs`.

Running the same command again updates it and keeps your settings.

## Use

```sh
sh /home/root/opentv-adblock/ctl.sh off       # turn off, and keep it off after a reboot
sh /home/root/opentv-adblock/ctl.sh on        # turn on, and keep it on after a reboot
sh /home/root/opentv-adblock/ctl.sh status    # what is active
sh /home/root/opentv-adblock/ctl.sh logs      # recent activity, e.g. "[pv] removed: ... Remote ad break x2"
```

`ctl.sh start` and `ctl.sh stop` do the same as `on` and `off`, but only until the next reboot. `ctl.sh state` prints the status as `key=value` lines for scripts and apps.

### Settings

Settings are in `/home/root/opentv-adblock/config`. Run `ctl.sh restart` after changing them.

| Setting | Default | What it does |
|---|---|---|
| `ENABLED` | `1` | Turn on at every boot. `ctl.sh on` and `ctl.sh off` change it. |
| `ENABLE_PRIME` | `1` | Prime Video ad removal |
| `ENABLE_HOSTS` | `1` | Block Google ad servers for the whole TV |
| `PROXY_PORT` | `8888` | Local port for the Prime Video proxy |
| `REMOVE_REMOTE` | `1` | `0` only hides the ad markers and pause ads (like uBlock Origin) and keeps the ad breaks |
| `RESTART_WAM` | `0` | `1` restarts LG's web-app engine when blocking switches on or off (see below) |

Add your own domains to block in `/home/root/opentv-adblock/hosts.custom`, one per line. Every blocked domain is blocked for both IPv4 and IPv6.

## Uninstall

```sh
sh /home/root/opentv-adblock/uninstall.sh
```

Or, if the folder is gone:

```sh
curl -fsSL https://raw.githubusercontent.com/c0d3-ninja/opentv-adblock-webos/main/uninstall.sh | sh
```

This turns everything off and removes it, leaving the TV as it was.

While installed, opentv-adblock keeps its own files in `/home/root/opentv-adblock` and a boot script in `/var/lib/webosbrew/init.d`. It never edits the TV's system files or the Prime Video app: `/etc/hosts` and the app's `default_config.json` are only covered by modified copies while blocking is on, and the originals are untouched underneath. Turning it off, uninstalling or rebooting removes those covers.

## How it works

### Prime Video

The webOS Prime Video app is a native app (Amazon's *Ignition* engine) that reads launch options from its `default_config.json`. Two of those options are `http-proxy-server` and `disable-ssl-cert`. opentv-adblock:

1. Runs `pvproxy.js` on the TV at `127.0.0.1:8888`.
2. Overlays the app's `default_config.json` (and the copy inside the app's jail) with one that adds those two options, keeping the app's own settings.
3. Edits the `GetVodPlaybackResources` response, the same way the [uBlock Origin](https://github.com/uBlockOrigin/uAssets) and [AdGuard](https://github.com/AdguardTeam/AdguardFilters) filter lists do in a browser:
   - removes `shouldShowOnScrubBar` (the ad markers), `pauseBehavior` / `pauseAdsResolution` (pause ads) and the ad cue points
   - removes the `Remote` playlist entries, which are the ad breaks themselves (only when the programme itself is still in the playlist)
   - blocks `getVideoAds` requests, and drops the `deviceAdInsertionTypeOverride` and `CuepointPlaylist` request options
4. Passes everything else through unchanged, including the video stream. If a response can't be parsed, it is passed on unchanged, so a format change at Amazon means ads come back rather than playback breaking.

**Certificates stay checked.** `disable-ssl-cert` stops the app from checking certificates itself, for every server it talks to. So the proxy handles **all** of the app's secure connections: it answers the app with a certificate created on your TV during install, then makes its own connection to the real server and checks that server's certificate, exactly as the app would. It trusts Node.js's own list of certificate authorities plus the TV's list (`/etc/ssl/certs/ca-certificates.crt`), so older TVs with an old Node.js still know newer authorities. A server with an invalid certificate is refused. Connections to the real servers are reused, so this adds very little work per video segment.

**Safety net.** If the proxy stops, it is restarted within seconds. Prime Video is set back to its normal settings, and the reason logged, if the proxy stops three times in a row, if its port is used by another program, or if Amazon's certificates keep being refused while none is accepted. The app is never left unable to connect, and with its normal settings it checks certificates itself again.

### Google ads

Google's ad servers (`doubleclick.net`, `googlesyndication.com`, `googleadservices.com`, `2mdn.net` and others; see [`src/hosts.blocklist`](src/hosts.blocklist)) are pointed at `0.0.0.0` (and `::` for IPv6) by overlaying `/etc/hosts`. Apps using Google's IMA video ads, like SonyLIV, then fail to load the ad and continue with the content.

Two domains are deliberately **not** blocked: `imasdk.googleapis.com` (the video player SDK, which apps need to play anything) and `dai.google.com` (some live streams are delivered entirely through it).

Web apps run inside LG's web-app engine, which remembers addresses it has already looked up for a short time, so the blocklist reaches them shortly after switching it on. If an app still shows Google ads right after you switch it on, close and reopen the app. `RESTART_WAM=1` applies it straight away by restarting the engine, but that closes every web app, including home-screen replacements such as [OpenTV Launcher](https://github.com/c0d3-ninja/opentv-launcher-LG), so it is off by default. When it is on, the app that was on screen is opened again afterwards.

## Limitations

- **Ads built into the video stream can't be removed.** Live sports and channels that insert ads server-side send them as part of the stream itself.
- **App updates can break it.** If Amazon renames the config options or changes its playback data, Prime Video ads come back (playback keeps working). Check `ctl.sh logs` and open an issue.
- **After a Prime Video update,** run `ctl.sh restart` (or reboot) so the proxy setting is applied to the new version.
- Older Prime Video apps that are not Ignition-based are detected and skipped.
- The Google blocklist applies to the whole TV, like a Pi-hole would.

## Development

```sh
npm test        # runs test/pvproxy.test.js against fake Amazon servers (needs openssl)
npm run sums    # updates SHA256SUMS after changing any installed file
```

The tests cover the edits, Brotli and gzip responses, plain and secure connections, WebSocket upgrades, plain HTTP pass-through, that servers with an untrusted certificate are refused, and that `SHA256SUMS` is up to date. The proxy and tests run on Node.js 8 and newer and use no dependencies.

### Releasing

The one-line install downloads a fixed release, so a half-finished change on `main` can never break someone's install:

1. Run `npm run sums` and `npm test`.
2. Set `RELEASE` in `install.sh` to the new tag (for example `v1.2.0`) and bump `version` in `package.json`.
3. Commit, push, then create and push the tag: `git tag v1.2.0 && git push origin v1.2.0`.

`npm test` fails if `RELEASE` and `version` don't match. Until the tag is pushed, the one-line install says the version was not found.

To try what is on `main` before tagging: `curl -fsSL .../main/install.sh | OTV_REF=main sh`.

## Disclaimer

This project is not affiliated with LG, Amazon, Sony or Google. Use it at your own risk and in line with the terms of the services you use.
