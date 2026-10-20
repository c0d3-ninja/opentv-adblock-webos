#!/bin/sh
# opentv-adblock uninstaller. Turns everything off and removes it.
#   sh uninstall.sh            remove everything
#   sh uninstall.sh --keep     turn off and remove the boot script, keep settings and logs

DEST=${INSTALL_DIR:-/home/root/opentv-adblock}
BOOT_SCRIPT=/var/lib/webosbrew/init.d/70opentv-adblock

[ "$(id -u)" = 0 ] || { echo "error: run this as root on the TV" >&2; exit 1; }

rm -f "$BOOT_SCRIPT"
if [ -f "$DEST/ctl.sh" ]; then
  sh "$DEST/ctl.sh" stop >/dev/null 2>&1
fi

if [ "$1" = "--keep" ]; then
  echo "opentv-adblock turned off; files kept in $DEST"
else
  rm -rf "$DEST"
  echo "opentv-adblock removed"
fi
echo "Everything is back to normal. A reboot also clears any leftover mounts."
