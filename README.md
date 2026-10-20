# opentv-adblock-webos

Ad blocking for **rooted LG webOS TVs**. It runs entirely on the TV, needs no other device, and turns itself on at every boot.

| | What it does | How |
|---|---|---|
| **Prime Video** | Removes ad breaks, the ad markers on the progress bar, and pause ads | A small on-device proxy edits the app's playback data before the player reads it |
| **Google ads, TV-wide** | Blocks Google's ad servers for every app and the browser (SonyLIV, ZEE5, Hotstar, banner ads, ...) | Adds Google's ad-serving domains to the TV's hosts file |

## Requirements

- An LG webOS TV **rooted** with [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) (root status must show *ok*)
- SSH or telnet access to the TV as root
- For Prime Video: Node.js 8 or newer and `openssl` on the TV. Both are included in webOS 4 and later. Without them, only the Google ad blocking is installed.

## Install

On the TV, as root:

```sh
cd /tmp
curl -fsSL https://github.com/c0d3-ninja/opentv-adblock-webos/archive/refs/heads/main.tar.gz -o otv.tgz
tar xzf otv.tgz
sh opentv-adblock-webos-main/install.sh
```

No `curl` on your TV? Copy the project folder over with `scp` and run `sh install.sh` inside it.

The installer checks your TV, generates a certificate for it, installs to `/home/root/opentv-adblock`, adds a boot script to Homebrew Channel, and turns everything on. When it switches on, the TV's home screen may reload once.

## Use

```sh
sh /home/root/opentv-adblock/ctl.sh status    # what is active
sh /home/root/opentv-adblock/ctl.sh stop      # turn off now (stock behaviour)
sh /home/root/opentv-adblock/ctl.sh start     # turn on again
sh /home/root/opentv-adblock/ctl.sh logs      # recent activity, e.g. "[pv] removed: ... Remote ad break x2"
```

Settings are in `/home/root/opentv-adblock/config` (Prime Video on/off, Google blocking on/off, proxy port, and more). Run `ctl.sh restart` after changing them. Add your own domains to block in `/home/root/opentv-adblock/hosts.custom`.

## Uninstall

```sh
sh /home/root/opentv-adblock/uninstall.sh
```

This turns everything off and removes it. Nothing on the TV is permanently changed: the app files and system files are never edited, only overlaid until the next reboot. A reboot alone also returns everything to normal once the boot script is removed.

## How it works

### Prime Video

The webOS Prime Video app is a native app (Amazon's *Ignition* engine) that reads launch options from its `default_config.json`. Two of those options are `http-proxy-server` and `disable-ssl-cert`. opentv-adblock:

1. Runs `pvproxy.js` on the TV at `127.0.0.1:8888`.
2. Overlays the app's `default_config.json` (and the copy inside the app's jail) with one that adds those two options, keeping the app's own settings.
3. In the proxy, decrypts only Amazon's API hosts (`*.primevideo.com`, `*.amazonvideo.com`, `*.amazon.dev`) and edits the `GetVodPlaybackResources` response, the same way the [uBlock Origin](https://github.com/uBlockOrigin/uAssets) and [AdGuard](https://github.com/AdguardTeam/AdguardFilters) filter lists do in a browser:
   - removes `shouldShowOnScrubBar` (the ad markers), `pauseBehavior` / `pauseAdsResolution` (pause ads) and the ad cue points
   - removes the `Remote` playlist entries, which are the ad breaks themselves
   - blocks `getVideoAds` requests, and drops the `deviceAdInsertionTypeOverride` and `CuepointPlaylist` request options
4. Passes everything else through untouched, including the video stream. If a response can't be parsed, it is passed on unchanged, so a format change at Amazon means ads come back rather than playback breaking.

The proxy's certificate is generated on each TV during install and only covers the connection between the app and the proxy inside the TV. The proxy verifies Amazon's real certificates as usual.

### Google ads

Google's ad servers (`doubleclick.net`, `googlesyndication.com`, `googleadservices.com`, `2mdn.net` and others; see [`src/hosts.blocklist`](src/hosts.blocklist)) are pointed at `0.0.0.0` by overlaying `/etc/hosts`. Apps using Google's IMA video ads, like SonyLIV, then fail to load the ad and continue with the content.

Two domains are deliberately **not** blocked: `imasdk.googleapis.com` (the video player SDK, which apps need to play anything) and `dai.google.com` (some live streams are delivered entirely through it).

Web apps run inside the TV's web-app engine, which caches addresses, and that engine starts before Homebrew Channel's boot scripts. So after applying the block at boot, opentv-adblock restarts the engine once (after `WAM_DELAY` seconds). Turn this off with `RESTART_WAM=0` if you prefer.

## Limitations

- **Ads built into the video stream can't be removed.** Live sports and channels that insert ads server-side send them as part of the stream itself.
- **App updates can break it.** If Amazon renames the config options or changes its playback data, Prime Video ads come back (playback keeps working). Check `ctl.sh logs` and open an issue.
- Older Prime Video apps that are not Ignition-based are detected and skipped.
- The Google blocklist applies to the whole TV, like a Pi-hole would.

## Development

```sh
npm test        # runs test/pvproxy.test.js against a fake Amazon server (needs openssl)
```

The proxy and tests run on Node.js 8 and newer and use no dependencies.

## Disclaimer

This project is not affiliated with LG, Amazon, Sony or Google. Use it at your own risk and in line with the terms of the services you use.
