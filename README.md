# tubeclean-rules

The blocking script for the [TubeClean](../tubeclean) iPad app. It removes ads and Shorts from YouTube's desktop site.

The build produces one file, `dist/tubeclean.js`. The app ships with a copy of it and checks this repo's raw GitHub URL every 6 hours. It installs a newer version without needing an app rebuild.

## How it works

`dist/tubeclean.js` is two parts joined together. Each is wrapped so a failure in one doesn't stop the other:

| Part | Source | What it does |
|---|---|---|
| Core | `src/core.js` (hand-written) | Removes ad and Shorts entries from YouTube's data before the page uses it. Also redirects Shorts links, hides leftover ad and Shorts elements with CSS, mutes any ad that still plays and presses Skip, and asks YouTube for H.264 video |
| uBlock | `generated/youtube-ublock.js` (built by `gen/generate.mjs`) | uBlock Origin's own YouTube fixes. The generator takes uBlock Origin's scriptlet code and the uAssets filter lists, and keeps only the rules for `www.youtube.com` |

The first line of the file is its version, for example `/* tubeclean-rules version=202610121501 */`. The version is a UTC timestamp in the form yyyyMMddHHmm. The app installs a download only if:
- the header is exact,
- the version is higher than the one it has,
- and the version is not more than a day in the future.

## Requirements

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22 or later | `brew install node` |
| git | any | The generator clones uBlock Origin into `.cache/` |
| Playwright with WebKit | latest | Only for the tests: `npm i --no-save playwright && npx playwright install webkit` |

These run the same way on macOS and Linux.

## Build

```sh
cd tubeclean-rules
node gen/generate.mjs     # fetch the latest uBlock Origin YouTube rules -> generated/
node build.mjs            # join the parts -> dist/tubeclean.js
node --check dist/tubeclean.js
```

- `gen/generate.mjs` uses uBlock Origin's latest `master` by default. Set `UBO_REF=<commit>` to pin a commit, since it runs that code. It fails rather than writes a file if the key YouTube scriptlets are missing.
- `build.mjs` keeps the old version number if nothing changed. It fails if a part is missing, or if the new version isn't higher than the last one; if that happens, wait a minute and run it again.

## Test

```sh
npm i --no-save playwright && npx playwright install webkit     # once
node test/playback.mjs dist/tubeclean.js dQw4w9WgXcQ kJQP7kiw5Fk
node test/check.mjs dist/tubeclean.js https://www.youtube.com/results?search_query=lego
```

- **`test/playback.mjs`** loads each video in headless WebKit with the script injected. It checks that the script ran, that no ad data appears on load or after moving to another video, and that the video plays. It prints `PASS` or `FAIL` and exits non-zero on failure.
- **`test/check.mjs`** loads any pages and reports visible ads and Shorts, plus what the script removed.

Headless tests run signed out. Seeing whether ads appear while signed in still needs the app on a real iPad.

## Ship a new version

1. Build and test as above.
2. Copy it into the app: in `../tubeclean`, run `scripts/sync-rules.sh`.
3. Commit both repos. Once this repo is public on GitHub, pushing `dist/tubeclean.js` is enough for installed apps to update themselves.

`gen/github-workflow-draft.yml` is a draft job that regenerates, tests and commits every day. It hasn't been run on GitHub yet.

## Licence

`generated/` and `dist/` contain code from uBlock Origin and filters from uAssets and EasyList:

- uBlock Origin and uAssets: GPL-3.0-or-later, Copyright Raymond Hill and contributors
- EasyList: GPL-3.0 or CC BY-SA 3.0

Publishing this repo counts as distribution, so license it GPL-3.0 when it goes public.
