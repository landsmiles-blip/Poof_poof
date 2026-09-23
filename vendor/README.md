# vendor/

`playgama-bridge.js` — the Playgama Bridge SDK, v2.2.0, taken from the
published npm package `@playgama/bridge` (`dist/playgama-bridge.js`), LGPL-3.0.

Vendored rather than loaded from Playgama's CDN on purpose. The Playgama
archive can be distributed to YouTube Playables, and the Playables technical
requirements say the game "MUST NOT make external calls to any URLs or
services, except where explicitly required to comply with other Technical
Requirements (i.e., to call APIs owned by Google or YouTube)". A
`<script src="https://bridge.playgama.com/...">` tag is exactly such a call.

Only `tools/build-playables.js --playgama` copies this file. It is not part of
the Pages build or the direct Playables build, so neither of those routes
ships a byte of it.

To update: `npm pack @playgama/bridge`, unpack, copy `dist/playgama-bridge.js`
here, then re-run the build and the browser check in `tools/check-playgama.cjs`.
