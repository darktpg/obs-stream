# OBS Server

Self-hosted receiver for OBS streams on a Plesk server. OBS sends via its normal stream output (RTMP),
a second person embeds the stream in their OBS as a browser or media source. Nothing is transcoded.

- `server/`: PHP app (dashboard API, license, updater, password-checking HLS proxy). This is what ships.
- `web/`: dashboard and player (React, shadcn/ui), built into `server/ui/`.
- MediaMTX is bundled in the release zip and does the RTMP ingest and the remux to HLS.

```
OBS --RTMP :1935--> MediaMTX --HLS on localhost--> hls.php (password) --HTTPS--> browser / OBS source
                       |
                       +-- mtx-auth.php decides every publish and read
```

Installation is described in [server/INSTALL.txt](server/INSTALL.txt).

## Development

```sh
php tests/license-sample.php   # verifies a real signed License Manager response
php tests/e2e.php              # full flow against fake License Manager and MediaMTX
scripts/build-release.sh       # builds build/obs-stream-<version>.zip
```

The version lives in `server/VERSION`. Updates reach installations only through the License Manager:
upload the release zip there.
