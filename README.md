# 🛡️ opentv-adblock-webos

Ad blocking for **rooted LG webOS TVs**. It runs entirely on the TV, needs no other device, and turns itself on every time the TV starts.

---

## ✨ What you get

| | What it does | How |
|---|---|---|
| 🎬 **Prime Video** | Removes ad breaks, the ad markers on the progress bar, and pause ads | A small proxy on the TV edits the app's playback data before the player reads it |
| 🌐 **Google ads, TV-wide** | Blocks Google's ad servers for every app and the browser (SonyLIV, ZEE5, Hotstar, banner ads, ...) | Adds Google's ad-serving domains to the TV's hosts file |

- 🔒 **Certificates stay checked:** every secure connection Prime Video makes is still verified, by the proxy.
- 🛟 **Safe by design:** if anything goes wrong, Prime Video goes back to its normal settings instead of breaking.
- 🔁 **On and off with one command,** kept across reboots.
- 🧹 **Leaves no trace:** system files and apps are never edited, and uninstalling puts everything back.
- 🤝 **Works alongside [OpenTV Launcher](https://github.com/c0d3-ninja/opentv-launcher-LG).**

---

## 🧰 Before you start (prerequisites)

1. 🔓 **A rooted TV with the [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel).** Its root status must show *ok*.
   - 🔎 Not rooted yet? Check [CanI.RootMy.TV](https://cani.rootmy.tv) for your model and firmware.
2. 🖥️ **Root shell access:** in **Homebrew Channel → Settings**, turn on **Telnet** (or **SSH**), then from a computer on the same network:
   ```sh
   telnet <TV IP address>
   ```
   A `#` prompt means you are root.
3. 🟢 **For Prime Video ad removal:** Node.js 8 or newer and `openssl` on the TV. Both come with webOS 4 and later. Without them, only the Google ad blocking is installed.

---

## 🚀 Install (one command on the TV)

1. 📋 In the TV's root shell, paste this line and press Enter:
   ```sh
   curl -fsSL https://raw.githubusercontent.com/c0d3-ninja/opentv-adblock-webos/main/install.sh | sh
   ```
2. ⏳ Wait up to a minute. It downloads the current release, checks every file, sets everything up and turns it on:
   ```
     [ OK ] All files match their checksums
     [ OK ] Certificate created
     [ OK ] Starts automatically every time the TV turns on
     [ OK ] Google ad blocklist is on
     [ OK ] Prime Video ad removal is on

     Done! opentv-adblock is installed.
   ```
3. 🎉 That's it. Open Prime Video and play something.

If something didn't turn on, the installer says so and tells you what to run next.

🛟 **No internet on the TV?** Copy this project folder to the TV (for example with `scp`) and run `sh install.sh` inside it.

---

## 🎮 Using it

| Command | What it does |
|---|---|
| `sh /home/root/opentv-adblock/ctl.sh off` | ⏸️ Turn off, and keep it off after a reboot |
| `sh /home/root/opentv-adblock/ctl.sh on` | ▶️ Turn on, and keep it on after a reboot |
| `sh /home/root/opentv-adblock/ctl.sh status` | 📊 Show what is active, and how many ad breaks were removed |
| `sh /home/root/opentv-adblock/ctl.sh logs` | 📝 Recent activity, for example `[pv] removed: ... Remote ad break x2` |
| `sh /home/root/opentv-adblock/ctl.sh restart` | 🔄 Turn off and on again (after changing settings) |

`start` and `stop` do the same as `on` and `off`, but only until the next reboot. `state` prints the status as `key=value` lines for scripts and apps.

### ⚙️ Settings

Settings are in `/home/root/opentv-adblock/config`. Run `ctl.sh restart` after changing them.

| Setting | Default | What it does |
|---|---|---|
| `ENABLED` | `1` | Turn on at every boot. `ctl.sh on` and `ctl.sh off` change it. |
| `ENABLE_PRIME` | `1` | Prime Video ad removal |
| `ENABLE_HOSTS` | `1` | Block Google ad servers for the whole TV |
| `PROXY_PORT` | `8888` | Local port for the Prime Video proxy |
| `REMOVE_REMOTE` | `1` | `0` only hides the ad markers and pause ads (like uBlock Origin) and keeps the ad breaks |
| `RESTART_WAM` | `0` | `1` restarts LG's web-app engine when blocking switches on or off (see [Good to know](#-good-to-know-small-trade-offs)) |

➕ **Block more domains:** add them to `/home/root/opentv-adblock/hosts.custom`, one per line (`ads.example.com` is enough). Every blocked domain is blocked for both IPv4 and IPv6.

---

## 🔄 Updating

Run the same install command again. It replaces the old version and keeps your settings, your extra domains and the TV's certificate.

---

## 🗑️ Uninstall

1. 📺 In the TV's root shell:
   ```sh
   sh /home/root/opentv-adblock/uninstall.sh
   ```
   Folder already gone? Use:
   ```sh
   curl -fsSL https://raw.githubusercontent.com/c0d3-ninja/opentv-adblock-webos/main/uninstall.sh | sh
   ```
2. ✅ It ends with **"Done! opentv-adblock is turned off and removed."** The Homebrew Channel and root access are not touched.

💡 Want to keep your settings? `uninstall.sh --keep` turns everything off and removes the boot script, but keeps the files.

### 🧾 What it changes on the TV

- 📁 **Its own files** in `/home/root/opentv-adblock`, and a **boot script** in `/var/lib/webosbrew/init.d`.
- 🫥 **Nothing else is edited.** `/etc/hosts` and Prime Video's `default_config.json` are only *covered* by modified copies while blocking is on. The originals stay untouched underneath. Turning it off, uninstalling or rebooting removes the covers.

---

## 🩺 Troubleshooting

- 📊 **First, check the status:** `sh /home/root/opentv-adblock/ctl.sh status`
- 🎬 **Prime Video still shows ads:** run `ctl.sh logs`. Lines starting with `[pv]` show what was removed. If you see `nothing to remove`, Amazon may have changed its data; please open an issue with the log.
- 🎬 **Status shows the Prime Video proxy OFF:** run `ctl.sh logs` to see why, then `ctl.sh restart`.
- 🔄 **Prime Video was just updated:** run `ctl.sh restart`, so the new version picks up the proxy setting.
- 🌐 **A web app still shows Google ads right after switching on:** close and reopen that app.
- 🔌 **"port 8888 is used by another program":** set another `PROXY_PORT` in the settings and run `ctl.sh restart`.
- 🔒 **"Amazon's certificates could not be verified":** Prime Video was set back to normal to keep working. Please open an issue with `ctl.sh logs` and your webOS version.
- 📦 **Install says "Version ... was not found":** the release was just published or is missing. Wait a minute, or install the development version as the message shows.
- 📝 **Anything else:** include the output of `ctl.sh status` and `ctl.sh logs` when you report it.

---

## 🐢 Good to know (small trade-offs)

- 🎬 **Prime Video closes** when Prime ad removal switches on or off, because it only reads its settings when it opens. Just open it again.
- ⏱️ **Web apps pick up the blocklist shortly after** it switches on, not instantly. `RESTART_WAM=1` makes it instant, but it closes every web app, including home-screen launchers like OpenTV Launcher, so it is off by default. When it is on, the app on screen is opened again afterwards.
- 🧮 **Prime Video's secure traffic passes through the proxy,** so the proxy can check the real certificates. Connections are reused, so the extra work is small.
- 🧱 **Ads built into the video stream can't be removed.** Live sports and channels that insert ads on the server send them as part of the stream itself.
- 🔄 **Amazon can change things.** If it renames the config options or changes its playback data, Prime Video ads come back. Playback keeps working.
- 🕰️ Older Prime Video apps that are not Ignition-based are detected and skipped.
- 🌍 The Google blocklist applies to the whole TV, like a Pi-hole would.

---

## 🔍 How it works

### 🎬 Prime Video

The webOS Prime Video app is a native app (Amazon's *Ignition* engine) that reads launch options from its `default_config.json`. Two of those options are `http-proxy-server` and `disable-ssl-cert`. opentv-adblock:

1. Runs `pvproxy.js` on the TV at `127.0.0.1:8888`.
2. Covers the app's `default_config.json` (and the copy inside the app's jail) with one that adds those two options, keeping the app's own settings.
3. Edits the `GetVodPlaybackResources` response, the same way the [uBlock Origin](https://github.com/uBlockOrigin/uAssets) and [AdGuard](https://github.com/AdguardTeam/AdguardFilters) filter lists do in a browser:
   - removes `shouldShowOnScrubBar` (the ad markers), `pauseBehavior` / `pauseAdsResolution` (pause ads) and the ad cue points
   - removes the `Remote` playlist entries, which are the ad breaks themselves (only when the programme itself is still in the playlist)
   - blocks `getVideoAds` requests, and drops the `deviceAdInsertionTypeOverride` and `CuepointPlaylist` request options
4. Passes everything else through unchanged, including the video stream. If a response can't be read, it is passed on unchanged, so a format change at Amazon means ads come back rather than playback breaking.

🔒 **Certificates stay checked.** `disable-ssl-cert` stops the app from checking certificates itself, for every server it talks to. So the proxy handles **all** of the app's secure connections: it answers the app with a certificate created on your TV during install, then makes its own connection to the real server and checks that server's certificate, exactly as the app would. It trusts Node.js's own list of certificate authorities plus the TV's list (`/etc/ssl/certs/ca-certificates.crt`), so older TVs with an old Node.js still know newer authorities. A server with an invalid certificate is refused.

🛟 **Safety net.** If the proxy stops, it is restarted within seconds. Prime Video is set back to its normal settings, and the reason logged, if the proxy stops three times in a row, if its port is used by another program, or if Amazon's certificates keep being refused while none is accepted. The app is never left unable to connect, and with its normal settings it checks certificates itself again.

### 🌐 Google ads

Google's ad servers (`doubleclick.net`, `googlesyndication.com`, `googleadservices.com`, `2mdn.net` and others; see [`src/hosts.blocklist`](src/hosts.blocklist)) are pointed at `0.0.0.0` (and `::` for IPv6) by covering `/etc/hosts`. Apps using Google's IMA video ads, like SonyLIV, then fail to load the ad and continue with the content.

Two domains are deliberately **not** blocked: `imasdk.googleapis.com` (the video player SDK, which apps need to play anything) and `dai.google.com` (some live streams are delivered entirely through it).

---

## 🧩 What's inside

| Path | What it is |
|---|---|
| 🚀 `install.sh` | The installer (runs on the TV) |
| 🗑️ `uninstall.sh` | The uninstaller (runs on the TV) |
| 🎛️ `src/ctl.sh` | Turns blocking on and off, starts it at boot, shows status and logs |
| 🎬 `src/pvproxy.js` | The Prime Video proxy |
| 🧾 `src/primeconfig.js` | Builds Prime Video's config with the proxy options |
| 🌐 `src/hosts.blocklist` | Google's ad-serving domains |
| 🔐 `SHA256SUMS` | Checksums the installer checks downloads against |
| 🧪 `test/` | Tests against fake Amazon servers |

---

## 🛠️ Development

```sh
npm test        # runs the tests against fake Amazon servers (needs openssl)
npm run sums    # updates SHA256SUMS after changing any installed file
```

The tests cover the edits, Brotli and gzip responses, plain and secure connections, WebSocket upgrades, plain HTTP pass-through, that servers with an untrusted certificate are refused, the certificate safety net, and that `SHA256SUMS` and the release number are up to date. The proxy and tests run on Node.js 8 and newer and use no dependencies.

### 📦 Releasing

The one-line install downloads a fixed release, so a half-finished change on `main` can never break someone's install:

1. Run `npm run sums` and `npm test`.
2. Set `RELEASE` in `install.sh` to the new tag (for example `v1.2.0`) and bump `version` in `package.json`.
3. Commit, push, then create and push the tag: `git tag v1.2.0 && git push origin v1.2.0`.

`npm test` fails if `RELEASE` and `version` don't match. Until the tag is pushed, the one-line install says the version was not found.

To try what is on `main` before tagging: `curl -fsSL .../main/install.sh | OTV_REF=main sh`.

---

## ⚠️ Disclaimer

- 🔓 Rooting your TV **may void its warranty** and can, in rare cases, damage it. **You do this at your own risk.**
- 🤝 This is an **unofficial, community project.** It is **not affiliated with, endorsed by or supported by LG, Amazon, Sony or Google.** All trademarks belong to their owners.
- 📜 Use it in line with the terms of the services you use.
- 🔄 LG software updates may remove root access, and app updates may stop the ad blocking from working.
- 🧯 The software is provided **"as is", without warranty of any kind.** The authors are not responsible for any damage, data loss or other problems.
