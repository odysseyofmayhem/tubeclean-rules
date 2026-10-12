#!/usr/bin/env node
// Builds dist/tubeclean.js: a version header followed by every part, each
// wrapped so one failing part cannot stop the others.
//
//   node build.mjs            -> dist/tubeclean.js
//
// Parts, in order:
//   src/core.js                    hand-written: data pruning, Shorts, CSS, fallback
//   generated/youtube-ublock.js    uBlock Origin's YouTube scriptlets (gen/generate.mjs)
//
// The version (UTC yyyyMMddHHmm) changes only when the content changes, so
// the app never re-downloads or re-installs an identical script.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const outPath = join(root, 'dist/tubeclean.js');
const parts = ['src/core.js', 'generated/youtube-ublock.js'];
const missing = parts.filter((p) => !existsSync(join(root, p)));
if (missing.length) throw new Error(`missing part(s): ${missing.join(', ')} (generated/ comes from gen/generate.mjs)`);

let body = '';
for (const p of parts) {
  const src = readFileSync(join(root, p), 'utf8');
  body += `\n/* ---- ${p} ---- */\ntry {\n${src}\n} catch (e) { console.error('[tubeclean] ${p} failed', e); }\n`;
}
const hash = createHash('sha256').update(body).digest('hex').slice(0, 16);

// Keep the previous version if nothing changed.
let prevVersion = '';
if (existsSync(outPath)) {
  const prev = readFileSync(outPath, 'utf8').split('\n', 2);
  prevVersion = /version=(\d{12})/.exec(prev[0] || '')?.[1] || '';
  const prevHash = /content=([0-9a-f]{16})/.exec(prev[1] || '')?.[1];
  if (prevHash === hash && !process.env.TC_VERSION) {
    console.log(`unchanged (${prev[0]})`);
    process.exit(0);
  }
}

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const version = process.env.TC_VERSION ||
  `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
if (!/^\d{12}$/.test(version)) throw new Error(`bad version ${version}: want yyyyMMddHHmm`);
// The app installs only strictly newer versions; equal would be ignored.
if (prevVersion && version <= prevVersion) {
  throw new Error(`version ${version} is not newer than ${prevVersion}; wait a minute and rebuild`);
}

const out = `/* tubeclean-rules version=${version} */\n` +
  `/* content=${hash} built ${now.toISOString()} from: ${parts.join(', ')} */\n` + body;

new Function(out); // refuse to write a file that does not parse
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(outPath, out);
console.log(`dist/tubeclean.js version=${version} bytes=${out.length} parts=${parts.join(',')}`);
