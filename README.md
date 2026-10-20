# 🛡️ opentv-adblock-webos

Ad blocking for **rooted LG webOS TVs**. It runs entirely on the TV and turns itself on every time the TV starts.

✅ Tested on an LG OLED42C2PSA (2022) with **webOS 25** (webOS TV 10.3.1, software version 33.31.68), Node.js 16 and Prime Video 9.2.10.

---

## ✨ What you get

| | What it does | How |
|---|---|---|
| 🎬 **Prime Video** | Removes ad breaks, the ad markers on the progress bar, and pause ads | A small proxy on the TV edits the app's playback data before the player reads it |
| 🌐 **Google ads, TV-wide** | Blocks Google's ad servers for every app and the browser (SonyLIV, ZEE5, Hotstar, banner ads, ...) | Adds Google's ad-serving domains to the TV's hosts file |
| 📺 **YouTube** | Blocks some ads, not all | The Google blocklist stops some of them. Most come from YouTube's own servers, the same ones that send the videos, so they can't be blocked without blocking YouTube |

- 🔒 **Certificates stay checked:** the proxy verifies every secure connection Prime Video makes.
- 🛟 **Safe by design:** if anything goes wrong, Prime Video goes back to its normal settings instead of breaking.
- 🔄 **Prime Video updates are handled by themselves.**
- 🧹 **Leaves no trace:** system files and apps are never edited, and uninstalling puts everything back.
- 🤝 **Built into [OpenTV Launcher](https://github.com/c0d3-ninja/opentv-launcher-LG)** as its **Block ads** switch, or install it on its own.

---

## 🧰 Before you start

1. 🔓 **A rooted TV with the [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel)** (root status *ok*). Not rooted yet? Check [CanI.RootMy.TV](https://cani.rootmy.tv).
2. 🖥️ **Root shell:** turn on **Telnet** (or SSH) in **Homebrew Channel → Settings**, then `telnet <TV IP address>` from a computer on the same network. A `#` prompt means you're root.
3. 🟢 **For Prime Video:** Node.js 8+ and `openssl` on the TV (both come with webOS 4 and later). Without them, only the Google blocking is installed.

---

## 🚀 Install

In the TV's root shell, paste:

```sh
curl -fsSL https://raw.githubusercontent.com/c0d3-ninja/opentv-adblock-webos/main/install.sh | sh
```

It downloads the current release, checks every file against its checksum, sets everything up and turns it on, ending with **"Done! opentv-adblock is installed."** If something didn't turn on, it says so and what to run next.

🛟 **No internet on the TV?** Copy this folder to the TV (for example with `scp`) and run `sh install.sh` inside it.

🔄 **Updating:** run the install command again. Your settings, extra domains and the TV's certificate are kept.

---

## 🎮 Using it

| Command (`sh /home/root/opentv-adblock/ctl.sh …`) | What it does |
|---|---|
| `on` / `off` | ▶️ ⏸️ Turn on or off, and keep it that way after a reboot |
| `status` | 📊 What is active, and how many ad breaks were removed |
| `logs` | 📝 Recent activity, for example `[pv] removed: ... Remote ad break x2` |
| `restart` | 🔄 Off and on again (after changing settings) |

`start` / `stop` work until the next reboot only. `state` prints `key=value` lines for scripts and apps.

⚙️ **Settings** are in `/home/root/opentv-adblock/config` (run `ctl.sh restart` after changing them):

| Setting | Default | What it does |
|---|---|---|
| `ENABLED` | `1` | Turn on at every boot (`on` / `off` change it) |
| `ENABLE_PRIME` / `ENABLE_HOSTS` | `1` | Prime Video ad removal / Google blocklist |
| `PROXY_PORT` | `8888` | Local port for the Prime Video proxy |
| `REMOVE_REMOTE` | `1` | `0` only hides ad markers and pause ads, keeping the ad breaks |
| `RESTART_WAM` | `0` | `1` restarts LG's web-app engine on every switch, so web apps pick up the blocklist instantly (closes all web apps) |

➕ **Block more domains:** add them to `/home/root/opentv-adblock/hosts.custom`, one per line. Each is blocked for IPv4 and IPv6.

---

## 🗑️ Uninstall

```sh
sh /home/root/opentv-adblock/uninstall.sh
```

Folder already gone? `curl -fsSL https://raw.githubusercontent.com/c0d3-ninja/opentv-adblock-webos/main/uninstall.sh | sh`. Want to keep your settings? Add `--keep`.

It ends with **"Done! opentv-adblock is turned off and removed."** While installed, it keeps its own files in `/home/root/opentv-adblock` and a boot script in `/var/lib/webosbrew/init.d`. Nothing else is edited: `/etc/hosts` and Prime Video's `default_config.json` are only *covered* (a bind mount) by modified copies while blocking is on, and the originals stay untouched underneath.

---

## 🩺 Troubleshooting

- 📊 **Start with** `ctl.sh status` and `ctl.sh logs`.
- 🎬 **Prime Video still shows ads:** `[pv]` lines in the logs show what was removed. `nothing to remove` means Amazon may have changed its data; please open an issue with the log.
- 🎬 **Prime Video proxy OFF:** check `ctl.sh logs`, then `ctl.sh restart`.
- 🔄 **"Paused while Prime Video updates":** normal. It comes back by itself when the update is done (30 minutes at the latest).
- 🌐 **A web app still shows Google ads right after switching on:** close and reopen it.
- 🔌 **"Port 8888 is used by another program":** set another `PROXY_PORT` and `ctl.sh restart`.
- 🔒 **"Amazon's certificates could not be verified":** Prime Video was set back to normal to keep working. Please open an issue with the logs and your webOS version.
- 📦 **"Version ... was not found":** the release was just published or is missing. Wait a minute, or use the development version as the message shows.

---

## 🐢 Good to know

- 📋 **Switching on or off closes the apps in Recent Lists** (like *Close All*), so they open fresh with the new setting. OpenTV Launcher and LG's home stay open.
- ⏱️ **Web apps pick up the blocklist shortly after** switching on, not instantly.
- 🔄 **While Prime Video updates,** ads aren't removed for that moment.
- 🧱 **Ads built into the video stream** (live sports, server-side ads) can't be removed.
- 🔄 **Amazon can change things.** If it changes the config options or its playback data, Prime Video ads come back; playback keeps working.
- 🌍 The Google blocklist applies to the whole TV, like a Pi-hole would.

---

## 🔍 How it works

**🎬 Prime Video.** The webOS app (Amazon's *Ignition* engine) reads launch options from `default_config.json`, including `http-proxy-server` and `disable-ssl-cert`. opentv-adblock runs `pvproxy.js` at `127.0.0.1:8888` and covers that file (and the copy in the app's jail) with one that adds those two options. The proxy then edits the `GetVodPlaybackResources` response the way the [uBlock Origin](https://github.com/uBlockOrigin/uAssets) and [AdGuard](https://github.com/AdguardTeam/AdguardFilters) filters do in a browser: it removes the ad markers (`shouldShowOnScrubBar`), pause ads (`pauseBehavior`, `pauseAdsResolution`), ad cue points and the `Remote` playlist entries (the ad breaks themselves, only while the programme itself stays in the playlist), and blocks `getVideoAds`. Everything else passes through unchanged, including the video. Anything it can't read is passed on as is, so a change at Amazon means ads come back, not that playback breaks.

**🔒 Certificates.** `disable-ssl-cert` stops the app checking certificates itself. So the proxy handles all of the app's secure connections: it answers with a certificate created on your TV, then connects to the real server and checks its certificate against Node.js's list plus the TV's own (`/etc/ssl/certs/ca-certificates.crt`). Invalid certificates are refused.

**🔄 Updates.** A small listener (about 2 MB, no CPU while idle) follows the TV's app-install announcements. The moment a Prime Video update starts, the cover comes off (measured on the TV: 50 ms after the first announcement, about 300 ms before the installer replaces files), so the update can replace its files. When it's done, the setting is rebuilt from the new version and covered again.

**🛟 Safety net.** A stopped proxy restarts within seconds. Prime Video goes back to its normal settings (and checks certificates itself again) if the proxy stops three times in a row, its port is taken, or Amazon's certificates keep being refused.

**🌐 Google ads.** Google's ad servers (`doubleclick.net`, `googlesyndication.com`, `googleadservices.com`, `2mdn.net` and others, see [`src/hosts.blocklist`](src/hosts.blocklist)) point to `0.0.0.0` and `::` in a covered `/etc/hosts`. Apps using Google's IMA video ads, like SonyLIV, skip the ad and continue. `imasdk.googleapis.com` and `dai.google.com` are deliberately not blocked, because some apps need them to play anything.

---

## 🛠️ Development

| Path | What it is |
|---|---|
| 🚀 `install.sh`, 🗑️ `uninstall.sh` | Run on the TV |
| 🎛️ `src/ctl.sh` | On/off, start-up, status, logs, the Prime Video update listener |
| 🎬 `src/pvproxy.js`, 🧾 `src/primeconfig.js` | The proxy, and Prime Video's config with the proxy options |
| 🌐 `src/hosts.blocklist` | Google's ad-serving domains |
| 🔐 `SHA256SUMS` | Checksums the installer checks downloads against |

```sh
npm test        # tests against fake Amazon servers (needs openssl), Node.js 8 and newer
npm run sums    # updates SHA256SUMS after changing an installed file
```

📦 **Releasing:** the one-line install downloads a fixed release. Run `npm run sums` and `npm test`, set `RELEASE` in `install.sh` and `version` in `package.json` (the tests check they match), commit, push, then `git tag vX.Y.Z && git push origin vX.Y.Z`. To try `main` before tagging: `curl -fsSL .../main/install.sh | OTV_REF=main sh`.

---

## ⚠️ Disclaimer

- 🔓 Rooting your TV **may void its warranty** and can, in rare cases, damage it. **You do this at your own risk.**
- 🤝 An **unofficial, community project**, **not affiliated with, endorsed by or supported by LG, Amazon, Sony or Google.** All trademarks belong to their owners. Use it in line with the terms of the services you use.
- 🔄 LG software updates may remove root access, and app updates may stop the ad blocking from working.
- 🧯 Provided **"as is", without warranty of any kind.** The authors are not responsible for any damage, data loss or other problems.
