#!/usr/bin/env bash
# Prepare a photo or figure for the site.
# Usage: tools/add-image.sh <source-image> <project-folder> <name>
#   e.g. tools/add-image.sh ~/Desktop/IMG_1234.jpg fsae-valvetrain 43-camshaft-installed
# Writes assets/img/<project-folder>/<name>.webp (max 2000 px) and <name>-sm.webp (max 960 px),
# with all metadata (including phone GPS) removed. Requires ImageMagick.
set -euo pipefail
src="$1"; folder="$2"; name="$3"
out="$(dirname "$0")/../assets/img/$folder"
mkdir -p "$out"
convert "$src" -auto-orient -strip -resize '2000x2000>' -quality 82 -define webp:method=6 "$out/$name.webp"
convert "$src" -auto-orient -strip -resize '960x960>' -quality 82 -define webp:method=6 "$out/$name-sm.webp"
identify -format "Wrote $out/$name.webp  (%w x %h — use these as width/height in the <img> tag)\n" "$out/$name.webp"
