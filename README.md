# tubeclean-rules

The blocking script for the TubeClean iPad app. The app downloads `dist/tubeclean.js` from this repo's raw GitHub URL.

## Parts

| File | What it is |
|---|---|
| `src/core.js` | Hand-written. Removes ad and Shorts entries from YouTube's data, redirects Shorts, applies CSS hiding, skips any ad that still plays, and asks YouTube for H.264 |
| `gen/generate.mjs` | Builds `generated/youtube-ublock.js` from uBlock Origin's own scriptlets and the uAssets filter lists, keeping only the rules for www.youtube.com |
| `build.mjs` | Joins the parts into `dist/tubeclean.js`, each in its own try/catch. Writes the version header the app checks |
| `test/playback.mjs`, `test/check.mjs` | Playwright WebKit checks: ad data removed, video plays, no Shorts or ads visible |

## Update

```
node gen/generate.mjs     # needs git and network; caches uBlock in .cache/
node build.mjs
node --check dist/tubeclean.js
```

To test:

```
cd /root/work/pw          # where Playwright is installed in the sandbox
node tc-test.mjs /srv/repos/tubeclean-rules/dist/tubeclean.js dQw4w9WgXcQ
```

## Licence

`generated/` and `dist/` contain code from uBlock Origin and filters from uAssets and EasyList. Their licences:

- uBlock Origin and uAssets: GPL-3.0-or-later, Copyright Raymond Hill and contributors
- EasyList: GPL-3.0 or CC BY-SA 3.0

Publishing this repo counts as distribution, so license it GPL-3.0 when it goes public.
