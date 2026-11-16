#!/bin/bash
# Renders extension/icons/icon.svg to the PNG sizes Chrome wants, using
# headless Chrome (no other image tools needed). Rerun after editing the SVG.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DIR="$ROOT/extension/icons"
TMP="$(mktemp -d)"
for s in 16 32 48 128; do
  cat > "$TMP/i.html" <<HTML
<html><body style="margin:0;background:transparent"><img src="file://$DIR/icon.svg" width="$s" height="$s" style="display:block"></body></html>
HTML
  "$CHROME" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --allow-file-access-from-files --window-size="$s,$s" --screenshot="$DIR/icon-$s.png" "file://$TMP/i.html" >/dev/null 2>&1
  echo "icon-$s.png"
done
rm -rf "$TMP"
