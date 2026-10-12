import { webkit } from 'playwright';
const inject = process.argv[2] || '';
const urls = process.argv.slice(3);
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15';
const b = await webkit.launch();
const ctx = await b.newContext({ userAgent: UA, locale: 'en-GB', viewport:{width:1180,height:820} });
await ctx.addCookies([{name:'SOCS',value:'CAI',domain:'.youtube.com',path:'/'}]);
if (inject) await ctx.addInitScript({ path: inject });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror', e => errs.push(String(e).slice(0,200)));
for (const url of urls) {
  await p.goto(url, { waitUntil: 'domcontentloaded' }).catch(e=>console.log('goto err',e.message));
  await p.waitForTimeout(8000);
  const r = await p.evaluate(() => {
    const pr = window.ytInitialPlayerResponse; const mp=document.getElementById('movie_player');
    const live = mp?.getPlayerResponse?.(); const v=document.querySelector('video');
    const vis = (sel) => [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null).length;
    return { url: location.href, initAd: !!(pr?.adPlacements||pr?.adSlots||pr?.playerAds), liveAd: !!(live?.adPlacements||live?.adSlots||live?.playerAds),
      t: v?.currentTime ?? null, adShowing: !!mp?.classList.contains('ad-showing'),
      shortsVisible: vis('ytd-reel-shelf-renderer, grid-shelf-view-model, ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, a[href^="/shorts/"]'),
      adsVisible: vis('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, #player-ads, #masthead-ad, ytd-search-pyv-renderer'),
      shortsInData: JSON.stringify(window.ytInitialData||{}).match(/shortsLockupViewModel|reelShelfRenderer|reelWatchEndpoint/g)?.length || 0,
      adsInData: JSON.stringify(window.ytInitialData||{}).match(/adSlotRenderer|promotedSparkles/g)?.length || 0,
      stats: window.__tubecleanStats || null, items: document.querySelectorAll('ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, yt-lockup-view-model').length };
  });
  console.log(JSON.stringify(r));
}
console.log('pageerrors', errs.length, errs.slice(0,5));
await b.close();
