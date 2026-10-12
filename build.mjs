#!/usr/bin/env node
// Builds dist/tubeclean.js: a version header followed by every part, each
// wrapped so one failing part cannot stop the others.
//
//   node build.mjs            -> dist/tubeclean.js
//
// Parts, in order:
//   src/core.js              hand-written: data pruning, Shorts, CSS, fallback
//   generated/ublock.js      optional: uBlock Origin's YouTube scriptlets
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const parts = ['src/core.js', 'generated/ublock.js'].filter((p) => existsSync(join(root, p)));

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const version = process.env.TC_VERSION ||
  `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;

let out = `/* tubeclean-rules version=${version} */\n`;
out += `/* built ${now.toISOString()} from: ${parts.join(', ')} */\n`;
for (const p of parts) {
  const src = readFileSync(join(root, p), 'utf8');
  out += `\n/* ---- ${p} ---- */\ntry {\n${src}\n} catch (e) { console.error('[tubeclean] ${p} failed', e); }\n`;
}

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/tubeclean.js'), out);
console.log(`dist/tubeclean.js version=${version} bytes=${out.length} parts=${parts.join(',')}`);
