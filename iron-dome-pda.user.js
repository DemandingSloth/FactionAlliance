// ==UserScript==
// @name         Torn PDA: Iron Dome Checker (Original DOM + Debug)
// @namespace    WetNightmare
// @version      1.4.1
// @description  PDA-safe: original selectors, banner inserted under .buttons-list, robust debug panel, debounced evaluator, fetch+cache live JSON.
// @match        https://www.torn.com/profiles.php*
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = {
    // ✅ Live JSON (canonical raw form on your repo)
    sourceUrl: 'https://cdn.jsdelivr.net/gh/WetNightmare/FactionAlliance@main/iron-dome-factions.json?v=1',
    // ✅ Hosted banner
    bannerUrl: 'https://github.com/WetNightmare/FactionAlliance/blob/f373bfec9fd256ca995895a19c64141c05c685a0/iron-dome-banner-750x140.png?raw=true',

    cacheTtlMs: 12 * 60 * 60 * 1000, // 12 hours
    badgeText: 'MEMBER OF THE IRON DOME',
    bannerId: 'iron-dome-banner',
    badgeId: 'iron-dome-tag',

    // Diagnostics & behavior
    debug: true,                       // show panel + logs
    debugPanelId: 'iron-dome-debug-panel',
    forceShow: false,                  // if true: bypasses match check (still waits for DOM readiness)
    maxWaitMs: 12000,                  // hard cap for waiting on DOM bits
    evalDebounceMs: 250,               // debounce for SPA updates
  };

  const STORAGE_KEYS = { factions: 'ironDome.factions.cache.v3' };

  // ---------- Utilities ----------
  const norm  = (s) => (s || '').trim().toLowerCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Debug panel
  function ensureDebugPanel() {
    if (!CONFIG.debug) return null;
    let p = document.getElementById(CONFIG.debugPanelId);
    if (!p) {
      p = document.createElement('div');
      p.id = CONFIG.debugPanelId;
      p.style.cssText = [
        'position:fixed','right:8px','bottom:8px','z-index:999999',
        'max-width:320px','font:12px/1.35 system-ui,Arial,sans-serif',
        'background:#111b','color:#d7e0ea','border:1px solid #2b3440',
        'padding:8px','border-radius:8px','backdrop-filter:blur(2px)',
        'box-shadow:0 2px 8px rgba(0,0,0,.35)'
      ].join(';');
      document.documentElement.appendChild(p);
    }
    return p;
  }
  function report(lines) {
    if (!CONFIG.debug) return;
    const p = ensureDebugPanel();
    if (p) p.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
  }
  function log(...a) { if (CONFIG.debug) console.log('[IronDome]', ...a); }

  // keep panel alive across re-renders
  setInterval(() => { if (CONFIG.debug) ensureDebugPanel(); }, 1000);

  // surface errors to the panel
  window.addEventListener('error', (e) => {
    report([`<b>Error</b>: ${e.message || e.error || e}`]);
  });
  window.addEventListener('unhandledrejection', (e) => {
    report([`<b>Promise Rejection</b>: ${e.reason || e}`]);
  });

  report(['<b>IronDome</b> booting…']);

  // ---------- JSON fetch + cache ----------
async function loadFactionSet() {
  const debugMsg = (msg) => report([`<span style="color:#ff7373">${msg}</span>`]);

  // 1️⃣ Try cache first
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.factions);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.list) && Date.now() - parsed.ts < CONFIG.cacheTtlMs) {
        report([`<b>IronDome</b>: using cached list (${parsed.list.length})`]);
        return { set: new Set(parsed.list.map(norm)), source: 'cache', count: parsed.list.length };
      }
    }
  } catch (e) {
    debugMsg(`Cache read error: ${e.message || e}`);
  }

  // 2️⃣ Try fetching JSON (multiple mirrors)
  let lastError = '';
  for (const url of CONFIG.mirrors || [CONFIG.sourceUrl]) {
    try {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout (8s)')), 8000));
      const res = await Promise.race([fetch(url, { cache: 'no-store' }), timeout]);

      // Handle "ghost" opaque responses
      if (!res || !res.ok || !res.body) throw new Error(`Fetch failed or blocked (${res && res.type})`);

      const text = await res.text();
      if (!text || text.length < 5) throw new Error('Empty response body (CORS?)');

      let list;
      try {
        list = JSON.parse(text);
      } catch (e) {
        throw new Error('Invalid JSON: ' + e.message);
      }
      if (!Array.isArray(list)) throw new Error('JSON not array');

      localStorage.setItem(STORAGE_KEYS.factions, JSON.stringify({ ts: Date.now(), list }));
      report([`<b>IronDome</b>: network (${list.length}) from <code>${url}</code>`]);
      return { set: new Set(list.map(norm)), source: url, count: list.length };
    } catch (err) {
      lastError = err.message || String(err);
      debugMsg(`Fetch failed for ${url}: ${lastError}`);
    }
  }

  // 3️⃣ Try stale cache
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.factions);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.list)) {
        report([
          `<b>Network error</b>: ${lastError || 'unknown'}`,
          `Using <b>stale cache</b>: ${parsed.list.length} factions`
        ]);
        return { set: new Set(parsed.list.map(norm)), source: 'stale-cache', count: parsed.list.length };
      }
    }
  } catch (e) {
    debugMsg(`Cache recovery error: ${e.message || e}`);
  }

  // 4️⃣ Nothing worked → explicit debug output
  debugMsg(`❌ JSON fetch failed: ${lastError || 'unknown (blocked or empty response)'}`);
  return { set: new Set(), source: 'none', count: 0, error: lastError || 'fetch failed' };
}



  // ---------- ORIGINAL DOM LOGIC ----------
  function extractFactionName() {
    // from your original: look for span[title*=" of "] that contains a factions link
    const span = Array.from(document.querySelectorAll('span[title*=" of "]'))
      .find(el => el.querySelector('a[href*="/factions.php"]'));
    if (!span) return null;
    const link = span.querySelector('a[href*="/factions.php"]');
    const name = link ? link.textContent.trim() : null;
    return name || null;
  }

  function findButtonsList() {
    return document.querySelector('.buttons-list');
  }

  function removeExisting() {
    document.getElementById(CONFIG.bannerId)?.remove();
    document.getElementById(CONFIG.badgeId)?.remove();
  }

  function insertBannerAndTag() {
    const buttonsList = findButtonsList();
    let placed = false;

    // Preferred: exactly after .buttons-list
    if (buttonsList) {
      const img = buildBannerImg();
      const tag = buildBadgeTag();
      buttonsList.insertAdjacentElement('afterend', img);
      img.insertAdjacentElement('afterend', tag);
      placed = true;
      return { placed, where: '.buttons-list(afterend)' };
    }

    // Fallbacks if .buttons-list is missing for some reason
    // Try placing after the span’s container (near faction area)
    const factionSpan = Array.from(document.querySelectorAll('span[title*=" of "]'))
      .find(el => el.querySelector('a[href*="/factions.php"]'));
    if (factionSpan && factionSpan.parentElement) {
      const img = buildBannerImg();
      const tag = buildBadgeTag();
      factionSpan.parentElement.insertAdjacentElement('afterend', img);
      img.insertAdjacentElement('afterend', tag);
      placed = true;
      return { placed, where: 'factionSpan.parent(afterend)' };
    }

    // Final fallback: append to main/content/body so it’s at least visible for testing
    const host = document.querySelector('#mainContainer, main, #content, body');
    if (host) {
      const img = buildBannerImg();
      const tag = buildBadgeTag();
      host.appendChild(img);
      host.appendChild(tag);
      placed = true;
      return { placed, where: 'main/content/body(append)' };
    }

    return { placed: false, where: '(no host found)' };
  }

  function buildBannerImg() {
    const img = document.createElement('img');
    img.id = CONFIG.bannerId;
    img.src = CONFIG.bannerUrl;
    img.alt = 'Iron Dome Alliance';
    img.referrerPolicy = 'no-referrer';
    img.style.width = '750px';
    img.style.height = '140px';
    img.style.border = '1px solid rgba(255,255,255,0.12)';
    img.style.borderRadius = '8px';
    img.style.display = 'block';
    img.style.margin = '10px auto 4px auto';
    img.decoding = 'async';
    img.loading = 'lazy';
    return img;
  }

  function buildBadgeTag() {
    const tag = document.createElement('div');
    tag.id = CONFIG.badgeId;
    tag.textContent = CONFIG.badgeText;
    tag.style.color = '#ff4444';
    tag.style.fontWeight = 'bold';
    tag.style.textAlign = 'center';
    tag.style.marginTop = '6px';
    return tag;
  }

  async function waitForProfileLoad() {
    const start = Date.now();
    while (Date.now() - start < CONFIG.maxWaitMs) {
      const haveButtons = !!document.querySelector('.buttons-list');
      const haveSpan    = !!document.querySelector('span[title*=" of "] a[href*="/factions.php"]');
      if (haveButtons && haveSpan) return 'both';
      if (haveSpan) return 'span-only';
      if (haveButtons) return 'buttons-only';
      await sleep(200);
    }
    return 'timeout';
  }

  // ---------- Main flow (debounced) ----------
  let factionsSet      = new Set();
  let factionsMeta     = { source: 'none', count: 0 };
  let evalTimer        = null;
  let evaluating       = false;
  let lastInsertWhere  = '';

  function scheduleEvaluate(reason = 'mutation') {
    if (evalTimer) clearTimeout(evalTimer);
    evalTimer = setTimeout(() => { void evaluateProfile(reason); }, CONFIG.evalDebounceMs);
  }

  async function evaluateProfile(reason = 'manual') {
    if (evaluating) return;
    evaluating = true;
    try {
      const phase = await waitForProfileLoad(); // respects maxWaitMs
      const faction = extractFactionName();
      const matched = CONFIG.forceShow || (faction && factionsSet.has(norm(faction)));

      removeExisting();

      let placedInfo = { placed: false, where: '(skipped)' };
      if (matched) {
        placedInfo = insertBannerAndTag();
      }

      lastInsertWhere = placedInfo.where;

      report([
        `<b>IronDome Diagnostic</b>`,
        `Reason: ${reason}`,
        `Wait phase: ${phase}`,
        `Faction: <b>${faction || '(not found)'}</b>`,
        `List source: ${factionsMeta.source} (${factionsMeta.count})`,
        `In alliance (match | force): <b>${!!(faction && factionsSet.has(norm(faction)))} | ${CONFIG.forceShow}</b>`,
        `Inserted: ${placedInfo.placed} @ ${placedInfo.where}`
      ]);

      log(`phase=${phase} faction="${faction}" match=${matched} placed=${placedInfo.placed} where=${placedInfo.where}`);
    } catch (e) {
      report([`<b>Error</b>: ${e.message || e}`]);
      log('evaluateProfile error:', e);
    } finally {
      evaluating = false;
    }
  }

  async function init() {
    const meta = await loadFactionSet();
    factionsSet  = meta.set;
    factionsMeta = { source: meta.source, count: meta.count };
    report([`<b>IronDome</b> loaded. Factions: ${factionsMeta.count} (${factionsMeta.source})`]);

    await evaluateProfile('init');

    // Observe SPA DOM updates (debounced)
    const obs = new MutationObserver(() => scheduleEvaluate('mutation'));
    obs.observe(document.documentElement, { childList: true, subtree: true });

    // Observe URL changes (SPA navigation)
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        scheduleEvaluate('url-change');
      }
    }, 400);
  }

  void init();

  // PDA console helpers:
  // localStorage.removeItem('ironDome.factions.cache.v3'); // clear cached list then reload
})();
