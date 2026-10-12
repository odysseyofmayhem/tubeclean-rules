#!/usr/bin/env node
// tubeclean generator: builds a standalone, page-world, document-start
// injectable JS for www.youtube.com from uBlock Origin's own filter parser,
// scriptlet library (gorhill/uBlock src/js/resources) and uAssets lists.
//
// Usage:
//   node generate.mjs [--ubo=/path/to/uBlock] [--host=www.youtube.com]
//                     [--env=safari|native_css_has|mv3|ublock|ubol]
//                     [--lists=default|+annoyances] [--offline=/dir/with/*.txt]
//
// Output: out/youtube-ublock.js, out/youtube-ublock.css, out/manifest.json
//
// GPL-3.0: this file uses and embeds GPL-3.0 code from uBlock Origin.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = new Map(process.argv.slice(2).map(a => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [ m[1], m[2] ?? 'true' ] : [ a, 'true' ];
}));

const HOST = argv.get('host') || 'www.youtube.com';
const OUT_DIR = path.resolve(argv.get('out') || path.join(HERE, '..', 'generated'));
// Default env mimics uBO Lite for Safari (what uAssets maintainers target on
// WebKit). No `html_filtering` capability: we cannot rewrite responses.
const ENV = (argv.get('env') || 'safari|native_css_has|mv3|ublock|ubol').split('|');

const UASSETS = 'https://ublockorigin.github.io/uAssets';
// Same composition as uBOL's default-enabled rulesets (platform/mv3/rulesets.json)
const LISTS = [
    { id: 'quick-fixes',  url: `${UASSETS}/filters/quick-fixes.min.txt`, trusted: true },
    { id: 'unbreak',      url: `${UASSETS}/filters/unbreak.min.txt`,     trusted: true },
    { id: 'filters',      url: `${UASSETS}/filters/filters.min.txt`,     trusted: true },
    { id: 'privacy',      url: `${UASSETS}/filters/privacy.min.txt`,     trusted: true },
    { id: 'ubol-filters', url: `${UASSETS}/filters/ubol-filters.txt`,    trusted: true, env: 'ubol' },
    { id: 'easylist',     url: `${UASSETS}/thirdparties/easylist.txt`,   trusted: false },
    { id: 'easyprivacy',  url: `${UASSETS}/thirdparties/easyprivacy.txt`, trusted: false },
];
if ( (argv.get('lists') || '').includes('annoyances') ) {
    LISTS.push({ id: 'annoyances-others', url: `${UASSETS}/filters/annoyances-others.min.txt`, trusted: true });
}

/******************************************************************************/
// 1. Get uBO source (scriptlets + parser)

async function getUbo() {
    let dir = argv.get('ubo');
    if ( !dir ) {
        dir = path.join(HERE, '..', '.cache', 'uBlock');
        const exists = await fs.stat(path.join(dir, '.git')).then(() => true, () => false);
        if ( exists ) {
            execSync('git fetch --depth 1 origin master && git reset -q --hard FETCH_HEAD', { cwd: dir, stdio: 'ignore' });
        } else {
            await fs.mkdir(path.dirname(dir), { recursive: true });
            execSync(`git clone -q --depth 1 https://github.com/gorhill/uBlock.git "${dir}"`, { stdio: 'ignore' });
        }
    }
    const commit = execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();
    return { dir, commit };
}

const ubo = await getUbo();
const imp = p => import(pathToFileURL(path.join(ubo.dir, p)).href);
const sfp = await imp('src/js/static-filtering-parser.js');
const { builtinScriptlets } = await imp('src/js/resources/scriptlets.js');
const { getTrustedTokens } = await imp('src/js/trusted-tokens.js');

/******************************************************************************/
// 2. Fetch lists (with !#include expansion, same as uBOL's fetch-list.js)

async function fetchText(url) {
    const offline = argv.get('offline');
    if ( offline ) {
        const f = path.join(offline, path.basename(url).replace('.min.txt', '.txt'));
        return fs.readFile(f, 'utf8');
    }
    const r = await fetch(url);
    if ( !r.ok ) { throw new Error(`fetch failed ${r.status} ${url}`); }
    const t = await r.text();
    if ( /^\s*</.test(t) ) { throw new Error(`bad content ${url}`); }
    return t;
}

async function fetchList(list) {
    let parts = [ { url: list.url } ];
    const seen = new Set();
    while ( parts.every(p => typeof p === 'string') === false ) {
        parts = await Promise.all(parts.map(async p => {
            if ( typeof p === 'string' ) { return p; }
            if ( seen.has(p.url) ) { return ''; }
            seen.add(p.url);
            return { url: p.url, content: (await fetchText(p.url)).trim() };
        }));
        parts = sfp.utils.preparser.expandIncludes(parts, ENV);
    }
    return parts.join('\n');
}

/******************************************************************************/
// 3. Hostname matching (build-time equivalent of uBO's runtime lookup)

const hostCandidates = (( ) => {
    const hns = [];
    for ( let h = HOST; ; ) {
        hns.push(h);
        const pos = h.indexOf('.');
        if ( pos === -1 ) { break; }
        h = h.slice(pos + 1);
    }
    // entities: youtube.* , www.youtube.*
    const ens = [];
    for ( const h of hns ) {
        const pos = h.lastIndexOf('.');
        if ( pos !== -1 ) { ens.push(`${h.slice(0, pos)}.*`); }
    }
    return new Set([ ...hns, ...ens ]);
})();
const isRegexOrPath = hn => hn.startsWith('/') || hn.includes('/');
const hnMatches = hn => hostCandidates.has(hn);

/******************************************************************************/
// 4. Parse

const trustedTokens = getTrustedTokens();
const scriptletFilters = new Map(); // normalized args json -> { args, raw, list }
const scriptletExceptions = new Set();
let scriptletsDisabled = false;
const cosmetic = new Map();         // compiled selector -> { raw, list }
const cosmeticExceptions = new Set();
const skipped = [];                 // { list, raw, reason }

const aliasMap = new Map();
const scriptletByName = new Map();
for ( const s of builtinScriptlets ) {
    scriptletByName.set(s.name, s);
    for ( const a of s.aliases || [] ) { aliasMap.set(a, s.name); }
}
const normalizeToken = tok => {
    let t = tok.endsWith('.js') ? tok : `${tok}.js`;
    return aliasMap.get(t) || t;
};

const mentionsHost = line => /youtube/i.test(line);

const listStats = [];
for ( const list of LISTS ) {
    if ( list.env && ENV.includes(list.env) === false ) { continue; }
    const text = await fetchList(list);
    const sha = createHash('sha256').update(text).digest('hex').slice(0, 12);
    listStats.push({ id: list.id, url: list.url, bytes: text.length, sha256_12: sha });
    const pruned = sfp.utils.preparser.prune(text, ENV);
    const parser = new sfp.AstFilterParser({
        nativeCssHas: ENV.includes('native_css_has'),
        trustedSource: list.trusted,
        trustedTokens,
    });
    const lines = pruned.split(/\r?\n/);
    for ( let i = 0; i < lines.length; i++ ) {
        let line = lines[i];
        while ( line.endsWith(' \\') && i + 1 < lines.length && lines[i+1].startsWith('    ') ) {
            line = line.slice(0, -2).trim() + lines[++i].trim();
        }
        if ( line === '' || line.startsWith('!') ) { continue; }
        // Cheap prefilter: we only care about rules that name the host, plus
        // the generic `#@#+js()` kill-switch. Generic cosmetic filters are
        // intentionally out of scope (thousands, mostly irrelevant).
        if ( mentionsHost(line) === false ) { continue; }
        parser.parse(line);
        if ( parser.isFilter() === false ) { continue; }
        if ( parser.isNetworkFilter() ) {
            if ( /youtube\.com/.test(line) ) {
                skipped.push({ list: list.id, raw: line, reason: 'network filter (needs WKContentRuleList / not injectable)' });
            }
            continue;
        }
        if ( parser.isExtendedFilter() === false ) { continue; }
        // Which hostnames does this filter apply to?
        let hit = false, negHit = false, regexOrPath = false;
        for ( const { hn, not, bad } of parser.getExtFilterDomainIterator() ) {
            if ( bad ) { continue; }
            if ( isRegexOrPath(hn) ) { if ( /youtube/.test(hn) ) { regexOrPath = true; } continue; }
            if ( hnMatches(hn) ) { if ( not ) { negHit = true; } else { hit = true; } }
        }
        if ( regexOrPath && !hit ) {
            skipped.push({ list: list.id, raw: line, reason: 'regex/path hostname not supported' });
            continue;
        }
        if ( !hit || negHit ) { continue; }
        if ( parser.hasError() ) {
            const why = parser.astError === sfp.AST_ERROR_UNTRUSTED_SOURCE ? 'trusted-only scriptlet in untrusted list' : 'parse error / unsupported in this env';
            skipped.push({ list: list.id, raw: line, reason: why });
            continue;
        }
        const isException = parser.isException();
        if ( parser.isScriptletFilter() ) {
            const args = parser.getScriptletArgs() || [];
            if ( args.length === 0 ) {
                if ( isException ) { scriptletsDisabled = true; }
                continue;
            }
            args[0] = normalizeToken(args[0]);
            const key = JSON.stringify(args);
            if ( isException ) { scriptletExceptions.add(key); continue; }
            if ( !scriptletFilters.has(key) ) {
                scriptletFilters.set(key, { args, raw: line, list: list.id, trusted: list.trusted });
            }
            continue;
        }
        if ( (parser.flavorBits & parser.BITFlavorExtHTML) !== 0 ) {
            skipped.push({ list: list.id, raw: line, reason: 'HTML filter (##^) needs response rewriting' });
            continue;
        }
        if ( parser.isResponseheaderFilter() ) {
            skipped.push({ list: list.id, raw: line, reason: 'responseheader filter' });
            continue;
        }
        const { compiled } = parser.result;
        if ( compiled === undefined ) {
            skipped.push({ list: list.id, raw: line, reason: 'cosmetic filter failed to compile' });
            continue;
        }
        if ( isException ) { cosmeticExceptions.add(compiled); continue; }
        if ( !cosmetic.has(compiled) ) { cosmetic.set(compiled, { raw: line, list: list.id }); }
    }
}

/******************************************************************************/
// 5. Resolve scriptlets -> code

const included = [];
const allFunctions = new Map();
function addFn(entry) {
    if ( allFunctions.has(entry.name) ) { return; }
    allFunctions.set(entry.name, entry.fn.toString());
    for ( const dep of entry.dependencies || [] ) {
        const d = scriptletByName.get(dep);
        if ( d ) { addFn(d); }
    }
}
const calls = [];
if ( scriptletsDisabled ) {
    skipped.push({ list: '*', raw: '#@#+js()', reason: 'all scriptlets disabled for host' });
} else {
    for ( const [ key, f ] of scriptletFilters ) {
        if ( scriptletExceptions.has(key) ) {
            skipped.push({ list: f.list, raw: f.raw, reason: 'cancelled by #@#+js exception' });
            continue;
        }
        const entry = scriptletByName.get(f.args[0]);
        if ( entry === undefined ) {
            skipped.push({ list: f.list, raw: f.raw, reason: `scriptlet ${f.args[0]} not in builtinScriptlets (web_accessible_resources import not implemented)` });
            continue;
        }
        if ( entry.requiresTrust && !f.trusted ) {
            skipped.push({ list: f.list, raw: f.raw, reason: 'requires trust' });
            continue;
        }
        addFn(entry);
        calls.push({ fn: entry.fn.name, args: f.args.slice(1), name: entry.name, world: entry.world || 'MAIN' });
        included.push({ list: f.list, raw: f.raw, scriptlet: entry.name, world: entry.world || 'MAIN' });
    }
}

/******************************************************************************/
// 6. Cosmetics -> CSS (+ tiny runtime for :remove())

const cssRules = [];
const hideSelectors = [];
const removeSelectors = [];
const includedCss = [];
for ( const [ compiled, f ] of cosmetic ) {
    if ( cosmeticExceptions.has(compiled) ) {
        skipped.push({ list: f.list, raw: f.raw, reason: 'cancelled by #@# exception' });
        continue;
    }
    if ( compiled.startsWith('{') === false ) {
        hideSelectors.push(compiled);
        includedCss.push({ list: f.list, raw: f.raw });
        continue;
    }
    const p = JSON.parse(compiled);
    const tasks = p.tasks || [];
    if ( tasks.length === 0 && p.action?.[0] === 'style' ) {
        cssRules.push(`${p.selector} { ${p.action[1]} }`);
        includedCss.push({ list: f.list, raw: f.raw });
        continue;
    }
    if ( tasks.length === 0 && p.action?.[0] === 'remove' ) {
        removeSelectors.push(p.selector);
        hideSelectors.push(p.selector);
        includedCss.push({ list: f.list, raw: f.raw });
        continue;
    }
    if ( tasks.length === 0 && p.cssable ) {
        hideSelectors.push(p.selector);
        includedCss.push({ list: f.list, raw: f.raw });
        continue;
    }
    skipped.push({ list: f.list, raw: f.raw, reason: `procedural cosmetic (${tasks.map(t => t[0]).join(',') || p.action?.[0]}) not implemented` });
}
// Each selector in its own rule so one invalid selector cannot kill the rest.
const css = [
    ...hideSelectors.map(s => `${s} { display: none !important; }`),
    ...cssRules,
].join('\n');

/******************************************************************************/
// 7. Emit

const stamp = new Date().toISOString();
// Deterministic build id: changes only when emitted behaviour changes.
const buildId = createHash('sha256').update(JSON.stringify([ ubo.commit, calls, css, removeSelectors ])).digest('hex').slice(0, 12);
const header = `/*!
 * tubeclean youtube-ublock.js — build ${buildId}
 * host: ${HOST}   env: ${ENV.join('|')}
 * uBlock Origin commit: ${ubo.commit}
 * scriptlets: ${calls.length}  css rules: ${hideSelectors.length + cssRules.length}  skipped: ${skipped.length}
 *
 * Contains code from uBlock Origin (https://github.com/gorhill/uBlock) and
 * filters from uAssets (https://github.com/uBlockOrigin/uAssets),
 * Copyright (C) Raymond Hill and contributors, GPL-3.0-or-later.
 */`;

const js = `${header}
(function tubecleanUbo() {
'use strict';
if ( location.hostname !== ${JSON.stringify(HOST)} ) { return; }
if ( window.top !== window ) { return; }
if ( window.__tubecleanUbo ) { return; }
window.__tubecleanUbo = ${JSON.stringify({ build: buildId, ubo: ubo.commit.slice(0, 10), scriptlets: calls.length })};
const scriptletGlobals = {}; // eslint-disable-line

/* ---- uBO scriptlet functions (verbatim fn.toString()) ---- */
${Array.from(allFunctions.values()).join('\n\n')}

/* ---- scriptlet invocations ---- */
const $calls$ = ${JSON.stringify(calls.map(c => [ c.fn, c.args, c.name ]), null, 0)};
const $fns$ = { ${calls.map(c => c.fn).filter((v, i, a) => a.indexOf(v) === i).join(', ')} };
for ( const [ fn, args, name ] of $calls$ ) {
    try { $fns$[fn](...args); }
    catch (e) { try { console.debug('[tubeclean] scriptlet failed', name, e); } catch {} }
}

/* ---- cosmetic filtering ---- */
const $css$ = ${JSON.stringify(css)};
const $remove$ = ${JSON.stringify(removeSelectors)};
const injectCss = ( ) => {
    const root = document.head || document.documentElement;
    if ( !root ) { return false; }
    const style = document.createElement('style');
    style.id = 'tubeclean-ubo-css';
    style.textContent = $css$;
    root.appendChild(style);
    return true;
};
if ( $css$ && injectCss() === false ) {
    const mo = new MutationObserver(( ) => { if ( injectCss() ) { mo.disconnect(); } });
    mo.observe(document, { childList: true, subtree: true });
}
if ( $remove$.length ) {
    const sel = $remove$.join(',');
    const sweep = ( ) => { for ( const el of document.querySelectorAll(sel) ) { el.remove(); } };
    let timer;
    new MutationObserver(( ) => {
        if ( timer ) { return; }
        timer = requestAnimationFrame(( ) => { timer = undefined; sweep(); });
    }).observe(document, { childList: true, subtree: true });
}
})();
`;

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(path.join(OUT_DIR, 'youtube-ublock.js'), js);
await fs.writeFile(path.join(OUT_DIR, 'youtube-ublock.css'), css + '\n');
const manifest = {
    generated: stamp, build: buildId, host: HOST, env: ENV,
    ubo: { repo: 'https://github.com/gorhill/uBlock', commit: ubo.commit },
    lists: listStats,
    included: { scriptlets: included, cosmetic: includedCss },
    skipped,
    bytes: Buffer.byteLength(js),
    sha256: createHash('sha256').update(js).digest('hex'),
};
await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1));

// Sanity: the output must at least parse.
new Function(js); // throws on syntax error

console.log(`uBO ${ubo.commit.slice(0, 10)}  env=${ENV.join('|')}`);
console.log(`included scriptlets: ${included.length}`);
for ( const i of included ) { console.log(`  + [${i.list}] (${i.world}) ${i.raw.slice(0, 150)}`); }
console.log(`included cosmetic: ${includedCss.length}`);
console.log(`skipped: ${skipped.length}`);
for ( const s of skipped ) { console.log(`  - [${s.list}] ${s.reason}: ${s.raw.slice(0, 120)}`); }
console.log(`wrote ${path.join(OUT_DIR, 'youtube-ublock.js')} (${manifest.bytes} bytes)`);
if ( included.length === 0 ) { console.error('FATAL: no scriptlets matched — refusing to publish'); process.exit(2); }
