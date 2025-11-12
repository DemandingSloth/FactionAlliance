// ==UserScript==
// @name         Torn PDA: Iron Dome Checker (With Fetch Tester)
// @namespace    WetNightmare
// @version      1.6.0
// @description  Original selectors + banner under .buttons-list; multi-mirror JSON loader with visible errors, manual paste, and a Test Fetch button.
// @match        https://www.torn.com/profiles.php*
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = {
    // Try these in order (first that works wins)
    mirrors: [
      'https://raw.githubusercontent.com/WetNightmare/FactionAlliance/refs/heads/main/iron-dome-factions.json'
    ],

    bannerUrl: 'https://github.com/WetNightmare/FactionAlliance/blob/f373bfec9fd256ca995895a19c64141c05c685a0/iron-dome-banner-750x140.png?raw=true',

    cacheTtlMs: 12 * 60 * 60 * 1000, // 12h
    badgeText: 'MEMBER OF THE IRON DOME',
    bannerId: 'iron-dome-banner',
    badgeId:   'iron-dome-tag',

    // Diagnostics & behavior
    debug: true,
    panelId: 'iron-dome-debug',
    forceShow: false,       // bypass membership check but still wait for DOM
    maxWaitMs: 12000,
    evalDebounceMs: 250
  };

  // Single, consistent storage keys
  const STORAGE = {
    cache:  'ironDome.factions.cache.v6',   // { ts, list[] }
    manual: 'ironDome.factions.manual.v1'   // list[]
  };

  // ---------- Debug panel ----------
  function ensurePanel() {
    let box = document.getElementById(CONFIG.panelId);
    if (!box) {
      box = document.createElement('div');
      box.id = CONFIG.panelId;
      box.style.cssText = [
        'position:fixed','right:8px','bottom:8px','z-index:2147483647',
        'max-width:360px','font:12px/1.4 system-ui,Arial,sans-serif',
        'background:#0b0f13cc','color:#d7e0ea','border:1px solid #2b3440',
        'padding:8px 10px 10px','border-radius:10px','backdrop-filter:blur(2px)',
        'box-shadow:0 6px 18px rgba(0,0,0,.45)'
      ].join(';');

      const controls = document.createElement('div');
      controls.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;align-items:center';

      const btnTest = document.createElement('button');
      btnTest.textContent = 'Test Fetch';
      styleBtn(btnTest);
      btnTest.onclick = testFetch;

      const btnPaste = document.createElement('button');
      btnPaste.textContent = 'Paste List';
      styleBtn(btnPaste);
      btnPaste.onclick = pasteManual;

      const btnClear = document.createElement('button');
      btnClear.textContent = 'Clear Cache';
      styleBtn(btnClear);
      btnClear.onclick = () => {
        localStorage.removeItem(STORAGE.cache);
        localStorage.removeItem(STORAGE.manual);
        logLines(['<b>Cache cleared.</b> Reload a profile.']);
      };

      const btnHide = document.createElement('button');
      btnHide.textContent = 'Hide';
      styleBtn(btnHide);
      btnHide.onclick = () => box.style.display = 'none';

      controls.appendChild(btnTest);
      controls.appendChild(btnPaste);
      controls.appendChild(btnClear);
      controls.appendChild(btnHide);

      const log = document.createElement('div');
      log.id = CONFIG.panelId + '-log';

      box.appendChild(controls);
      box.appendChild(log);
      document.documentElement.appendChild(box);
    }
    return box;
  }
  function styleBtn(b){ b.style.cssText='padding:3px 8px;border-radius:6px;border:1px solid #3a4756;background:#17202a;color:#d7e0ea;cursor:pointer'; }
  function logLines(lines){
    if (!CONFIG.debug) return;
    ensurePanel();
    const log = document.getElementById(CONFIG.panelId + '-log');
    if (log) log.innerHTML = lines.map(x => `<div>${x}</div>`).join('');
  }
  // keep panel alive if Torn re-renders
  setInterval(() => CONFIG.debug && ensurePanel(), 1000);
  logLines(['<b>IronDome</b> booting…']);

  // ---------- Helpers ----------
  const norm  = s => (s || '').trim().toLowerCase();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Manual paste
  function pasteManual() {
    const s = prompt('Paste JSON array of faction names (e.g., ["The Swarm","Stage Fright"])');
    if (!s) return;
    try {
      const list = JSON.parse(s);
      if (!Array.isArray(list)) throw new Error('Not an array');
      localStorage.setItem(STORAGE.manual, JSON.stringify(list));
      localStorage.setItem(STORAGE.cache, JSON.stringify({ ts: Date.now(), list }));
      logLines([`<b>Manual list saved</b>: ${list.length} factions. Re-evaluating…`]);
      setTimeout(() => scheduleEval('manual-paste'), 100);
    } catch(e) {
      logLines([`<span style="color:#ff7272"><b>Manual paste error:</b> ${e.message || e}</span>`]);
    }
  }

  // ---------- JSON loader with explicit error lines ----------
  async function loadFactionSet() {
    // Manual first
    try {
      const man = localStorage.getItem(STORAGE.manual);
      if (man) {
        const list = JSON.parse(man);
        if (Array.isArray(list) && list.length) {
          localStorage.setItem(STORAGE.cache, JSON.stringify({ ts: Date.now(), list }));
          logLines([`<b>List source:</b> manual (${list.length})`]);
          return { set: new Set(list.map(norm)), src: 'manual', count: list.length };
        }
      }
    } catch {}

    // Fresh cache
    try {
      const c = localStorage.getItem(STORAGE.cache);
      if (c) {
        const parsed = JSON.parse(c);
        if (parsed && Array.isArray(parsed.list) && Date.now() - parsed.ts < CONFIG.cacheTtlMs) {
          logLines([`<b>List source:</b> cache (${parsed.list.length})`]);
          return { set: new Set(parsed.list.map(norm)), src: 'cache', count: parsed.list.length };
        }
      }
    } catch (e) {
      logLines([`<span style="color:#ff7272"><b>Cache read error:</b> ${e.message || e}</span>`]);
    }

    // Mirrors with ghost/opaque detection
    let lastErr = '';
    for (const url of CONFIG.mirrors) {
      try {
        const timeout = new Promise((_,rej)=>setTimeout(()=>rej(new Error('Timeout (8s)')),8000));
        const res = await Promise.race([fetch(url, { cache: 'no-store' }), timeout]);
        if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 'no response'}`);
        const text = await res.text();
        if (!text || text.length < 5) throw new Error('Empty response (CORS/blocked?)');

        let list;
        try { list = JSON.parse(text); } catch(e){ throw new Error('Invalid JSON: ' + e.message); }
        if (!Array.isArray(list)) throw new Error('JSON not array');

        localStorage.setItem(STORAGE.cache, JSON.stringify({ ts: Date.now(), list }));
        logLines([`<b>List source:</b> network (${list.length}) from <code>${url}</code>`]);
        return { set: new Set(list.map(norm)), src: url, count: list.length };
      } catch (e) {
        lastErr = e && (e.message || String(e));
        // Visible red line per URL
        logLines([`<span style="color:#ff7272"><b>Fetch failed</b> ${url}: ${lastErr}</span>`]);
      }
    }

    // Stale cache fallback
    try {
      const raw = localStorage.getItem(STORAGE.cache);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.list)) {
          logLines([
            `<span style="color:#ffd166"><b>Network error:</b></span> ${lastErr || 'unknown'}`,
            `Using <b>stale cache</b>: ${parsed.list.length} factions`
          ]);
          return { set: new Set(parsed.list.map(norm)), src: 'stale-cache', count: parsed.list.length };
        }
      }
    } catch {}

    // Nothing worked
    logLines([
      `<span style="color:#ff7272"><b>JSON load failed:</b></span> ${lastErr || 'blocked/empty'}`,
      `Click <b>Paste List</b> to proceed offline.`
    ]);
    return { set: new Set(), src: 'none', count: 0 };
  }

  // Extra: active tester button logic
  async function testFetch() {
    ensurePanel();
    const out = [];
    for (const url of CONFIG.mirrors) {
      const start = performance.now();
      try {
        const timeout = new Promise((_,rej)=>setTimeout(()=>rej(new Error('Timeout (8s)')),8000));
        const res = await Promise.race([fetch(url, { cache: 'no-store' }), timeout]);
        const elapsed = Math.round(performance.now() - start);
        if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 'no response'}`);
        const text = await res.text();
        const bytes = text ? text.length : 0;
        let parsed; try { parsed = JSON.parse(text); } catch(e){ throw new Error('Invalid JSON: ' + e.message); }
        if (!Array.isArray(parsed)) throw new Error('JSON not array');
        out.push(`<span style="color:#9be7a9"><b>OK</b></span> ${elapsed}ms • ${bytes} bytes • <code>${url}</code>`);
      } catch (e) {
        const elapsed = Math.round(performance.now() - start);
        out.push(`<span style="color:#ff7272"><b>FAIL</b></span> ${elapsed}ms • ${e.message || e} • <code>${url}</code>`);
      }
    }
    logLines([`<b>Fetch test results</b>`, ...out]);
  }

  // ---------- Original DOM logic (your selectors/placement) ----------
  function extractFactionName() {
    const span = Array.from(document.querySelectorAll('span[title*=" of "]'))
      .find(el => el.querySelector('a[href*="/factions.php"]'));
    if (!span) return null;
    const link = span.querySelector('a[href*="/factions.php"]');
    return link ? link.textContent.trim() : null;
  }

  function findButtonsList() {
    return document.querySelector('.buttons-list');
  }

  function removeExisting() {
    document.getElementById(CONFIG.bannerId)?.remove();
    document.getElementById(CONFIG.badgeId)?.remove();
  }

  function buildBanner() {
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
  function buildTag() {
    const tag = document.createElement('div');
    tag.id = CONFIG.badgeId;
    tag.textContent = CONFIG.badgeText;
    tag.style.color = '#ff4444';
    tag.style.fontWeight = 'bold';
    tag.style.textAlign = 'center';
    tag.style.marginTop = '6px';
    return tag;
  }

  function insertUI() {
    const buttonsList = findButtonsList();
    if (buttonsList) {
      const img = buildBanner();
      const tag = buildTag();
      buttonsList.insertAdjacentElement('afterend', img);
      img.insertAdjacentElement('afterend', tag);
      return '.buttons-list(afterend)';
    }
    const host = document.querySelector('#mainContainer, main, #content, body') || document.body;
    const img = buildBanner();
    const tag = buildTag();
    host.appendChild(img);
    host.appendChild(tag);
    return 'main/content/body(append)';
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

  // ---------- Main (debounced) ----------
  let listSet = new Set();
  let listSrc = 'none';
  let listCount = 0;
  let evaluating = false;
  let timer = null;

  function scheduleEval(reason='mutation') {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void evaluate(reason), CONFIG.evalDebounceMs);
  }

  async function evaluate(reason='init') {
    if (evaluating) return;
    evaluating = true;
    try {
      const phase = await waitForProfileLoad();
      const faction = extractFactionName();
      const inAlliance = CONFIG.forceShow || (faction && listSet.has(norm(faction)));

      removeExisting();
      let where = '(skipped)';
      if (inAlliance) where = insertUI();

      logLines([
        `<b>IronDome</b> — ${reason}`,
        `Wait phase: ${phase}`,
        `Faction: <b>${faction || '(not found)'}</b>`,
        `List source: <b>${listSrc}</b> (${listCount})`,
        `In alliance (match | force): <b>${!!(faction && listSet.has(norm(faction)))} | ${CONFIG.forceShow}</b>`,
        `Inserted: ${inAlliance} @ ${where}`
      ]);
    } finally {
      evaluating = false;
    }
  }

  async function init() {
    const meta = await loadFactionSet();
    listSet = meta.set;
    listSrc = meta.src;
    listCount = meta.count;

    await evaluate('init');

    const obs = new MutationObserver(() => scheduleEval('mutation'));
    obs.observe(document.documentElement, { childList: true, subtree: true });

    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        scheduleEval('url-change');
      }
    }, 400);
  }

  void init();
})();
