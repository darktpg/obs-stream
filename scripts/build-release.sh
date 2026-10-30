#!/usr/bin/env bash
# Builds build/obs-stream-<version>.zip, ready to unpack into a Plesk httpdocs folder.
set -euo pipefail

MTX_VERSION=v1.21.3
root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(tr -d '[:space:]' < "$root/server/VERSION")"
out="$root/build"
stage="$out/stage"
cache="$out/cache/$MTX_VERSION"

(cd "$root/web" && npm ci --ignore-scripts && npm run build)

mkdir -p "$cache"
for arch in amd64 arm64; do
  name="mediamtx_${MTX_VERSION}_linux_${arch}.tar.gz"
  [ -f "$cache/$name" ] || gh release download "$MTX_VERSION" -R bluenviron/mediamtx -p "$name" -D "$cache"
done
[ -f "$cache/checksums.sha256" ] || gh release download "$MTX_VERSION" -R bluenviron/mediamtx -p checksums.sha256 -D "$cache"
(cd "$cache" && grep -E 'linux_(amd64|arm64)\.tar\.gz' checksums.sha256 | shasum -a 256 -c -)

rm -rf "$stage"
mkdir -p "$stage"
rsync -a --exclude 'data-*' --exclude bin --exclude .DS_Store "$root/server/" "$stage/"
mkdir -p "$stage/bin"
for arch in amd64 arm64; do
  tar -xzf "$cache/mediamtx_${MTX_VERSION}_linux_${arch}.tar.gz" -C "$cache" mediamtx LICENSE
  mv "$cache/mediamtx" "$stage/bin/mediamtx-linux-$arch"
  chmod 755 "$stage/bin/mediamtx-linux-$arch"
done
{
  echo "OBS Server bundles MediaMTX $MTX_VERSION (https://github.com/bluenviron/mediamtx), MIT license:"
  echo
  cat "$cache/LICENSE"
} > "$stage/THIRD-PARTY-LICENSES.txt"

zipfile="$out/obs-stream-$version.zip"
rm -f "$zipfile"
(cd "$stage" && zip -qr9 "$zipfile" .)
shasum -a 256 "$zipfile"
du -h "$zipfile"
