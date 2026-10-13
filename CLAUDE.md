# CLAUDE.md: tubeclean-rules

Read this before changing anything in this repo. `README.md` has the full commands.

## What this is

This repo builds the JavaScript that the TubeClean iPad app (`../tubeclean`) injects into YouTube's desktop site. The app shows that site in a `WKWebView` for one child, signed in to his Google account. The script removes ads and Shorts. Its output, `dist/tubeclean.js`, is the only thing the app consumes.

The script runs inside YouTube's page while a child's Google account is signed in. Treat every change as code running with his session.

## Build and test (macOS or Linux)

You need Node 22 or later and git. Playwright with WebKit is needed for the tests only.

```sh
node gen/generate.mjs                       # uBlock Origin YouTube rules -> generated/
node build.mjs                              # src/core.js + generated/ -> dist/tubeclean.js
node --check dist/tubeclean.js
npm i --no-save playwright && npx playwright install webkit     # once
node test/playback.mjs dist/tubeclean.js dQw4w9WgXcQ kJQP7kiw5Fk   # must print PASS
```

To get a new build into the app: in `../tubeclean`, run `scripts/sync-rules.sh`, then rebuild in Xcode (`xcodegen generate`, then ⌘R). See `../tubeclean/CLAUDE.md`.

## Layout

| Path | Notes |
|---|---|
| `src/core.js` | Hand-written. Wraps `JSON.parse` and `Response.json`, and the `ytInitialPlayerResponse` and `ytInitialData` setters. Removes ad keys and Shorts entries in place. Also: Shorts URL redirects, CSS hiding, the ad fallback (mute and Skip only, never seek), and the H.264 preference |
| `gen/generate.mjs` | Imports uBlock Origin's own parser and scriptlet library from a clone in `.cache/uBlock`, and keeps the `www.youtube.com` rules. Pin the commit with `UBO_REF` |
| `generated/` | Generator output. Committed, so a build works offline. `manifest.json` lists every rule included and skipped |
| `build.mjs` | Joins the parts, each in its own try/catch. Writes the version header and a content hash |
| `dist/tubeclean.js` | The shipped file. Committed |
| `test/` | Playwright WebKit harnesses |
| `gen/github-workflow-draft.yml` | Draft daily update job. Not run on GitHub yet |

## Rules for changes

- **The header must stay exactly** `/* tubeclean-rules version=yyyyMMddHHmm */` on line 1. The app rejects anything else.
- **Never hand-edit `dist/` or `generated/`.** Change `src/core.js` or the generator, then rebuild.
- **`playback.mjs` must print PASS** before you commit a new `dist/tubeclean.js`.
- **Never break YouTube for a signed-in user.** `core.js` swallows its own errors (`safeClean`), and removes only entries it can name. Never empty a whole shelf because one item in it was bad.
- **Don't seek in the ad fallback.** With ads stitched into the video stream, seeking skips the real video. Mute and press Skip only.
- **Keep it YouTube-only.** The app adds its own guard as well, but the script must never assume it runs anywhere else.
- **Bump `UBO_REF` on purpose.** The generator runs uBlock Origin's code at build time.

## Pitfalls

- **The "Shorts" chip and filter** are matched by their English label only.
- **`playerAds` can come back after moving between videos.** That's a known gap in uBlock Origin's rules, and the test allows it.
- **If the generator's skipped count rises sharply,** uAssets has probably moved YouTube fixes to a rule type we can't apply. Check `generated/manifest.json`.
- **Headless tests run signed out.** Ads that only appear while signed in show up on the iPad, not in these tests.
