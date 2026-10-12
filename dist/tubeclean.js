/* tubeclean-rules version=202610120255 */
/* built 2026-10-12T02:55:22.383Z from: src/core.js */

/* ---- src/core.js ---- */
try {
/*
 * tubeclean core: removes ads and Shorts from www.youtube.com.
 *
 * Injected by the TubeClean iPad app at document start, in the page's own
 * JavaScript world, main frame only. It must run before any YouTube script.
 *
 * Layers, cheapest and most robust first:
 *   1. Data: strip ad and Shorts entries from YouTube's JSON before the page
 *      renders it (JSON.parse, Response.json, and the ytInitial* globals).
 *   2. Navigation: never stay on a /shorts/ page.
 *   3. CSS: hide any ad or Shorts element that slipped through.
 *   4. Fallback: if an ad still plays, mute it, skip to its end, click Skip.
 */
(() => {
  'use strict';
  if (window.__tubecleanCore) return;
  Object.defineProperty(window, '__tubecleanCore', { value: true });
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;

  const stats = { adKeys: 0, removed: 0, shortsRedirects: 0, adSkips: 0, enforcement: 0 };

  // ---------------------------------------------------------------- 1. data

  // Keys that carry video ad schedules in player responses.
  const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];

  // List entries to drop wherever they appear in an array.
  const DROP = new Set([
    // ads
    'adSlotRenderer', 'displayAdRenderer', 'promotedSparklesWebRenderer',
    'promotedSparklesTextSearchRenderer', 'promotedVideoRenderer',
    'compactPromotedVideoRenderer', 'searchPyvRenderer', 'inFeedAdLayoutRenderer',
    'bannerPromoRenderer', 'statementBannerRenderer', 'brandVideoShelfRenderer',
    'brandVideoSingletonRenderer', 'merchandiseShelfRenderer',
    'actionCompanionAdRenderer', 'companionSlotRenderer', 'primetimePromoRenderer',
    'movieOfferModuleRenderer', 'tvfilmOfferModuleRenderer', 'mealbarPromoRenderer',
    // shorts
    'reelShelfRenderer', 'reelItemRenderer', 'shortsLockupViewModel',
    'shortsLockupViewModelV2',
  ]);

  // Video entries that may point at a Short instead of a normal video.
  const VIDEO_ENTRIES = new Set([
    'videoRenderer', 'compactVideoRenderer', 'gridVideoRenderer',
    'lockupViewModel', 'playlistVideoRenderer', 'playlistPanelVideoRenderer',
  ]);

  const SHORTS_URL = /^\/shorts\//;

  // Bounded search for a Shorts link inside one entry.
  const pointsAtShorts = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 7) return false;
    if (Array.isArray(o)) return false; // do not descend into lists of children
    for (const k in o) {
      if (k === 'reelWatchEndpoint') return true;
      const v = o[k];
      if (k === 'url' && typeof v === 'string' && SHORTS_URL.test(v)) return true;
      if (v && typeof v === 'object' && pointsAtShorts(v, depth + 1)) return true;
    }
    return false;
  };

  const isShortsBrowse = (v) =>
    v?.navigationEndpoint?.browseEndpoint?.browseId === 'FEshorts' ||
    v?.pivotIdentifier === 'FEshorts';

  const shouldDrop = (item, depth = 0) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || depth > 3) return false;
    for (const k in item) {
      if (DROP.has(k)) return true;
      const v = item[k];
      if (!v || typeof v !== 'object') continue;
      if (VIDEO_ENTRIES.has(k) && pointsAtShorts(v, 0)) return true;
      switch (k) {
        case 'richItemRenderer':
        case 'richSectionRenderer':
          if (shouldDrop(v.content, depth + 1)) return true;
          break;
        case 'richShelfRenderer':
          if (v.isShorts === true) return true;
          if (Array.isArray(v.contents) && v.contents.some((c) => shouldDrop(c, depth + 1))) return true;
          break;
        case 'gridShelfViewModel':
          if (Array.isArray(v.contents) &&
              v.contents.some((c) => c && (c.shortsLockupViewModel || c.shortsLockupViewModelV2))) return true;
          break;
        case 'guideEntryRenderer':
        case 'pivotBarItemRenderer':
        case 'miniGuideEntryRenderer':
          if (isShortsBrowse(v)) return true;
          break;
        case 'tabRenderer': {
          const url = v.endpoint?.commandMetadata?.webCommandMetadata?.url || '';
          if (/\/shorts\/?$/.test(url)) return true;
          break;
        }
      }
    }
    return false;
  };

  // Walk the whole object once, iteratively, editing it in place.
  const clean = (root) => {
    if (!root || typeof root !== 'object') return root;
    const stack = [root];
    let budget = 2000000;
    while (stack.length && budget-- > 0) {
      const o = stack.pop();
      if (Array.isArray(o)) {
        let w = 0;
        for (let i = 0; i < o.length; i++) {
          const it = o[i];
          if (shouldDrop(it)) { stats.removed++; continue; }
          o[w++] = it;
          if (it && typeof it === 'object') stack.push(it);
        }
        if (w !== o.length) o.length = w;
      } else {
        for (const k of AD_KEYS) {
          if (Object.prototype.hasOwnProperty.call(o, k)) { delete o[k]; stats.adKeys++; }
        }
        for (const k in o) {
          const v = o[k];
          if (v && typeof v === 'object') stack.push(v);
        }
      }
    }
    return root;
  };

  // Only spend time on payloads that look like YouTube's own responses.
  const looksLikeYouTube = (r) => {
    if (!r || typeof r !== 'object') return false;
    if (Array.isArray(r)) {
      const f = r[0];
      return !!f && typeof f === 'object' && ('playerResponse' in f || 'response' in f);
    }
    return 'responseContext' in r || 'playerResponse' in r ||
      'adPlacements' in r || 'onResponseReceivedActions' in r;
  };

  const safeClean = (r) => {
    try { if (looksLikeYouTube(r)) clean(r); } catch (_) { /* never break the page */ }
    return r;
  };

  // Proxies keep Function.prototype.toString looking native.
  JSON.parse = new Proxy(JSON.parse, {
    apply(target, thisArg, args) { return safeClean(Reflect.apply(target, thisArg, args)); },
  });

  Response.prototype.json = new Proxy(Response.prototype.json, {
    apply(target, thisArg, args) { return Reflect.apply(target, thisArg, args).then(safeClean); },
  });

  // `var ytInitialPlayerResponse = {...}` in an inline script calls this
  // setter, because the accessor already exists on window.
  for (const name of ['ytInitialPlayerResponse', 'ytInitialData']) {
    const d = Object.getOwnPropertyDescriptor(window, name);
    if (d && !d.configurable) continue;
    let value = d && 'value' in d ? safeClean(d.value) : undefined;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set(v) { value = safeClean(v); },
    });
  }

  // ---------------------------------------------------------- 2. navigation

  const CHANNEL_SHORTS = /^(\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+))\/shorts\/?$/;

  // Where to go instead of a Shorts URL, or null if the URL is fine.
  const shortsTarget = (href) => {
    let u;
    try { u = new URL(href, location.href); } catch (_) { return null; }
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    if (/^\/shorts(\/|$)/.test(u.pathname) || u.pathname === '/feed/shorts') return '/';
    const m = u.pathname.match(CHANNEL_SHORTS);
    return m ? m[1] : null;
  };

  const leaveShorts = () => {
    const t = shortsTarget(location.href);
    if (t) { stats.shortsRedirects++; location.replace(t); }
  };

  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (a && shortsTarget(a.href)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('yt-navigate-finish', leaveShorts);
  window.addEventListener('popstate', leaveShorts);
  leaveShorts();

  // ----------------------------------------------------------------- 3. css

  const CSS = `
#masthead-ad, #player-ads, ytd-ad-slot-renderer, ad-slot-renderer,
ytd-in-feed-ad-layout-renderer, ytd-banner-promo-renderer,
ytd-statement-banner-renderer, ytd-display-ad-renderer,
ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer,
ytd-compact-promoted-video-renderer, ytd-search-pyv-renderer,
ytd-companion-slot-renderer, ytd-action-companion-ad-renderer,
ytd-player-legacy-desktop-watch-ads-renderer, ytd-merch-shelf-renderer,
ytd-brand-video-shelf-renderer, ytd-brand-video-singleton-renderer,
ytd-mealbar-promo-renderer, ytd-primetime-promo-renderer,
ytd-tvfilm-offer-module-renderer,
ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
ytd-rich-section-renderer:has(ytd-statement-banner-renderer),
.ytp-ad-overlay-container, .ytp-ad-message-container, .ytp-ad-image-overlay,
ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts],
ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
grid-shelf-view-model:has(ytm-shorts-lockup-view-model),
grid-shelf-view-model:has(ytm-shorts-lockup-view-model-v2),
ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2,
ytd-guide-entry-renderer:has(a[title="Shorts"]),
ytd-guide-entry-renderer:has(a[href^="/shorts"]),
ytd-mini-guide-entry-renderer[aria-label="Shorts"],
ytd-mini-guide-entry-renderer:has(a[href^="/shorts"]),
ytd-video-renderer:has(a[href^="/shorts/"]),
ytd-grid-video-renderer:has(a[href^="/shorts/"]),
ytd-rich-item-renderer:has(a[href^="/shorts/"]),
ytd-compact-video-renderer:has(a[href^="/shorts/"]),
yt-lockup-view-model:has(a[href^="/shorts/"]),
yt-tab-shape[tab-title="Shorts"]
{ display: none !important; }`;

  const style = document.createElement('style');
  style.id = 'tubeclean-css';
  style.textContent = CSS;
  const addStyle = () => {
    const root = document.documentElement;
    if (!root) return false;
    if (!style.isConnected) root.appendChild(style);
    return true;
  };
  if (!addStyle()) {
    const mo = new MutationObserver(() => { if (addStyle()) mo.disconnect(); });
    mo.observe(document, { childList: true });
  }

  // ------------------------------------------------------------ 4. fallback

  let inAd = false;
  let mutedBefore = false;

  const tick = () => {
    leaveShorts();
    addStyle(); // YouTube can replace <head>; the style lives on <html>

    const mp = document.getElementById('movie_player');
    const v = mp && mp.querySelector('video');
    if (mp && v && mp.classList.contains('ad-showing')) {
      if (!inAd) { inAd = true; mutedBefore = v.muted; stats.adSkips++; }
      v.muted = true;
      if (Number.isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.2) {
        v.currentTime = v.duration - 0.1;
      }
      for (const b of document.querySelectorAll(
        '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern')) b.click();
    } else if (inAd) {
      inAd = false;
      if (v) v.muted = mutedBefore;
    }

    // "Ad blockers are not allowed" dialog: remove it and resume.
    const enf = document.querySelector('ytd-enforcement-message-view-model');
    if (enf) {
      stats.enforcement++;
      (enf.closest('tp-yt-paper-dialog') || enf).remove();
      for (const b of document.querySelectorAll('tp-yt-iron-overlay-backdrop')) b.remove();
      if (v && v.paused) v.play().catch(() => {});
    }
  };
  setInterval(tick, 250);

  // ---------------------------------------------------------------- report

  // The app logs these (debug builds); harmless if the handler is missing.
  let last = '';
  setInterval(() => {
    const mp = document.getElementById('movie_player');
    const v = mp && mp.querySelector('video');
    const report = {
      type: 'stats', host: location.hostname, path: location.pathname, ...stats,
      layout: document.querySelector('ytd-app') ? 'desktop' : (document.querySelector('ytm-app') ? 'mobile' : 'unknown'),
      video: v ? { t: Math.round(v.currentTime), paused: v.paused, ad: mp.classList.contains('ad-showing') } : null,
    };
    const s = JSON.stringify(report);
    if (s === last) return;
    last = s;
    try {
      window.webkit?.messageHandlers?.tubeclean?.postMessage(report);
    } catch (_) { /* no handler */ }
  }, 2000);

  window.__tubecleanStats = stats;
})();

} catch (e) { console.error('[tubeclean] src/core.js failed', e); }
