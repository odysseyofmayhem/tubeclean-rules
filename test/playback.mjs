// node tc-test.mjs <init-script|none> <videoId...>
import { webkit } from 'playwright';
const inject = process.argv[2] && process.argv[2] !== 'none' ? process.argv[2] : null;
const ids = process.argv.slice(3);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15';
const b = await webkit.launch();
const results = [];
for ( const id of ids ) {
  const ctx = await b.newContext({ userAgent: UA, locale: 'en-GB', viewport: { width: 1180, height: 820 } });
  await ctx.addCookies([{ name: 'SOCS', value: 'CAI', domain: '.youtube.com', path: '/' }]);
  if ( inject ) await ctx.addInitScript({ path: inject });
  const p = await ctx.newPage();
  const errors = [], tcLogs = [];
  let rawPlayerApiAds = 0, playerApiCalls = 0;
  p.on('pageerror', e => errors.push(String(e).slice(0, 160)));
  p.on('console', m => { const t = m.text(); if ( /tubeclean|uBO/.test(t) ) tcLogs.push(t.slice(0, 160)); });
  p.on('response', async r => {
    if ( /\/youtubei\/v1\/player\?/.test(r.url()) ) {
      playerApiCalls++;
      try { if ( /"adPlacements"|"adSlots"/.test(await r.text()) ) rawPlayerApiAds++; } catch {}
    }
  });
  await p.goto(`https://www.youtube.com/watch?v=${id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  let adShow = 0, t0 = null, t1 = null;
  for ( let i = 0; i < 25; i++ ) {
    await p.waitForTimeout(1000);
    const s = await p.evaluate(() => {
      const mp = document.getElementById('movie_player'); const v = document.querySelector('video');
      if ( v && v.paused && v.readyState >= 2 ) { v.muted = true; v.play().catch(() => {}); }
      return { ad: !!mp && mp.classList.contains('ad-showing'), t: v ? v.currentTime : null };
    });
    if ( s.ad ) adShow++;
    if ( i === 5 ) t0 = s.t;
    t1 = s.t;
  }
  const r = await p.evaluate(() => {
    const pr = window.ytInitialPlayerResponse; const mp = document.getElementById('movie_player');
    let live; try { live = mp?.getPlayerResponse?.(); } catch {}
    const keys = o => o ? ['adPlacements', 'adSlots', 'playerAds'].filter(k => o[k] !== undefined) : null;
    return { title: document.title.slice(0, 50), initAdKeys: keys(pr), liveAdKeys: keys(live),
             hasLive: !!live, injected: window.__tubecleanUbo || null, core: !!window.__tubecleanCore,
             playability: live?.playabilityStatus?.status ?? pr?.playabilityStatus?.status,
             cssPresent: !!document.getElementById('tubeclean-ubo-css') };
  });
  // SPA navigation to a related video exercises /youtubei/v1/player via fetch
  let spa = null;
  try {
    const href = await p.evaluate(() => [...document.querySelectorAll('a[href^="/watch?v="]')].map(a => a.getAttribute('href')).find(h => !h.includes(location.search.slice(3, 14))));
    if ( href ) {
      await p.evaluate(h => { const a = [...document.querySelectorAll(`a[href="${h}"]`)][0]; a.click(); }, href);
      await p.waitForTimeout(8000);
      spa = await p.evaluate(() => {
        const mp = document.getElementById('movie_player'); let live; try { live = mp?.getPlayerResponse?.(); } catch {}
        const v = document.querySelector('video');
        return { url: location.pathname + location.search.slice(0, 14), liveAdKeys: live ? ['adPlacements', 'adSlots', 'playerAds'].filter(k => live[k] !== undefined) : null, t: v?.currentTime };
      });
    }
  } catch (e) { spa = { err: String(e).slice(0, 100) }; }
  const out = { id, inject: !!inject, ...r, adShowSeconds: adShow, timeAt5s: t0, timeAt25s: t1,
    playing: t1 !== null && t0 !== null && t1 > t0, playerApiCalls, rawPlayerApiWithAds: rawPlayerApiAds,
    spa, pageErrors: errors.slice(0, 5), pageErrorCount: errors.length, tcLogs: tcLogs.slice(0, 5) };
  console.log('RESULT', JSON.stringify(out));
  results.push(out);
  await ctx.close();
}
await b.close();

// Gate for publishing: every video must have both parts injected, no ad
// keys on first load, live or after in-page navigation, and must play.
// playerAds after in-page navigation is a known uBO gap and is allowed.
if ( inject ) {
  const bad = [];
  for ( const r of results ) {
    if ( !r.core || !r.injected ) bad.push(`${r.id}: script not injected`);
    if ( r.initAdKeys?.length ) bad.push(`${r.id}: initial ad keys ${r.initAdKeys}`);
    if ( r.liveAdKeys?.length ) bad.push(`${r.id}: live ad keys ${r.liveAdKeys}`);
    const spaAds = (r.spa?.liveAdKeys || []).filter(k => k !== 'playerAds');
    if ( spaAds.length ) bad.push(`${r.id}: ad keys after navigation ${spaAds}`);
    if ( !r.playing ) bad.push(`${r.id}: not playing`);
  }
  if ( bad.length ) { console.error('FAIL\n' + bad.join('\n')); process.exit(1); }
  console.log('PASS');
}
