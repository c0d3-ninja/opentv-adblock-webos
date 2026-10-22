# 🛡️ opentv-adblock-webos

> ⚠️ **Rooting your TV may void its warranty.** Proceed at your own risk.

Ad blocking for **rooted LG webOS TVs**. It runs entirely on the TV and turns itself on every time the TV starts.

✅ Tested on an LG OLED42C2PSA (2022) with **webOS 25** (webOS TV 10.3.1, software version 33.31.68), Node.js 16 and Prime Video 9.2.10.

---

## ✨ What you get

| | What it does | How |
|---|---|---|
| 🎬 **Prime Video** | Removes ad breaks, the ad markers on the progress bar, and pause ads | A small proxy on the TV edits the app's playback data before the player reads it |
| 🌐 **Google ads, TV-wide** | Blocks Google's ad servers for every app and the browser (SonyLIV, ZEE5, Hotstar, banner ads, ...) | Adds Google's ad-serving domains to the TV's hosts file |

- 🔒 **Certificates stay checked:** the proxy verifies every secure connection Prime Video makes.
- 🛟 **Safe by design:** if anything goes wrong, Prime Video goes back to its normal settings instead of breaking.
- 🔄 **Prime Video updates are handled by themselves.**
- 🧹 **Leaves no trace:** system files and apps are never edited, and uninstalling puts everything back.
- 🤝 **Built into [OpenTV Launcher](https://github.com/c0d3-ninja/opentv-launcher-LG)** as its **Block ads** switch, or install it on its own.

---

## 🧰 Before you start (prerequisites)

1. 🔓 **Root your TV.** I used [slopbro](https://github.com/throwaway96/slopbro):
   - 🔎 Your TV not supported by slopbro? Check [CanI.RootMy.TV](https://cani.rootmy.tv) for other options.
   - 🐍 Get the slopbro repo on a computer that has Python 3.
   - 📶 Put the computer and the TV on the same network.
   - ▶️ Run slopbro, following its README. Accept the pairing prompt on the TV when it appears.
   - 🍺 When it finishes, the **Homebrew Channel** is installed on your TV. Its root status must show *ok*.
2. 🖥️ **Turn on root shell access.** On the TV, open **Homebrew Channel → Settings** and turn on **Telnet** (or **SSH**).
3. 🔢 **Find your TV's IP address.** On the TV, go to **Settings → Network → Wi-Fi (or Wired) → Advanced Settings**.
4. 💻 **A computer on the same network,** to log in to the TV.
5. 🧪 **Check you can log in to the TV:**
   ```sh
   telnet <TV IP address>
   ```
   You should get a `#` prompt, which means you are root. On a Mac without telnet, run `brew install telnet` first.
6. 🟢 **For Prime Video ad removal:** Node.js 8 or newer and `openssl` on the TV. Both come with webOS 4 and later. Without them, only the Google ad blocking is installed.

---

## 🚀 Install (one command on the TV)

1. 🔌 Log in to the TV's root shell from your computer:
   ```sh
   telnet <TV IP address>
   ```
2. 📋 Paste this one line and press Enter:
   ```sh
   curl -fsSL https://raw.githubusercontent.com/c0d3-ninja/opentv-adblock-webos/main/install.sh | sh
   ```
3. ⏳ Wait up to a minute. It downloads the current release, checks every file, sets everything up and turns it on:
   ```
     [ OK ] All files match their checksums
     [ OK ] Certificate created
     [ OK ] Starts automatically every time the TV turns on
     [ OK ] Google ad blocklist is on
     [ OK ] Prime Video ad removal is on

     Done! opentv-adblock is installed.
   ```
4. 🎉 That's it. Open Prime Video and play something.

If something didn't turn on, the installer says so and tells you what to run next.

### 🛟 Backup: TV can't reach GitHub?

Share the files from your computer instead:

1. 💻 On your computer, get the project, either with git:
   ```sh
   git clone https://github.com/c0d3-ninja/opentv-adblock-webos.git
   ```
   or by downloading the ZIP from GitHub (**Code → Download ZIP**) and unzipping it.
2. 💻 In the folder that contains `opentv-adblock-webos`, pack it and share it (needs Python 3):
   ```sh
   tar czf otv.tgz opentv-adblock-webos
   python3 -m http.server 8000
   ```
   Keep the window open. If your computer asks whether to allow incoming connections, click **Allow**.
3. 📺 On the TV's root shell, download, unpack and install it (put in your computer's IP address):
   ```sh
   cd /tmp && curl -fsS http://<computer IP>:8000/otv.tgz -o otv.tgz && tar xzf otv.tgz && sh opentv-adblock-webos/install.sh
   ```
4. ✅ When the TV says **"Done!"**, press **Ctrl+C** on your computer to stop sharing.

🔄 **Updating:** run the same install command again. Your settings, extra domains and the TV's certificate are kept.

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

- 📊 **Start with** `ctl.sh status` and `ctl.sh logs`.
- 🎬 **Prime Video still shows ads:** `[pv]` lines in the logs show what was removed. `nothing to remove` means Amazon may have changed its data; please open an issue with the log.
- 🎬 **Prime Video proxy OFF:** it retries by itself after 5 minutes. To restart it now: `ctl.sh restart`.
- 🔄 **"Paused while Prime Video updates":** normal. It comes back by itself when the update is done (30 minutes at the latest).
- 🌐 **A web app still shows Google ads right after switching on:** close and reopen it.
- 🔌 **"Port 8888 is used by another program":** set another `PROXY_PORT` and `ctl.sh restart`.
- 🔒 **"Amazon's certificates could not be verified":** Prime Video was set back to normal to keep working. It retries after 5 minutes. If it keeps happening, please open an issue with the logs and your webOS version.
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
