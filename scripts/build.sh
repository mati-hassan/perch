#!/bin/bash
# Zips the extension for sharing: build/perch-extension.zip, which unzips to a
# "perch" folder you can load with chrome://extensions → Load unpacked.
# (For your own use, just load the extension/ folder directly.)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$ROOT/build/perch"
rm -rf "$STAGE" "$ROOT/build/perch-extension.zip"
mkdir -p "$ROOT/build"
cp -R "$ROOT/extension" "$STAGE"
find "$STAGE" -name .DS_Store -delete
(cd "$ROOT/build" && zip -qr perch-extension.zip perch)
rm -rf "$STAGE"
echo "Built $ROOT/build/perch-extension.zip"
