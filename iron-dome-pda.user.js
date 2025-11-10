// ==UserScript==
// @name         Torn PDA: Iron Dome Checker (PDA-Optimized Robust)
// @namespace    WetNightmare
// @version      1.2.0
// @description  PDA-safe fetch+cache, robust faction detection, broad insert points, on-screen diagnostics togglable.
// @match        https://www.torn.com/profiles.php*
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = {
    sourceUrl: 'https://raw.githubusercontent.com/WetNightmare/FactionAlliance/refs/heads/main/iron-dome-factions.json',
    sourceUrl: 'https://gist.githubusercontent.com/WetNightmare/297cba005b3319118f31ebf146e90b0b/raw/199d410bcd3b00cbb252a8366d650123fd2229f5/iron-dome-factions.json',

    bannerUrl: 'https://github.com/WetNightmare/FactionAlliance/blob/f373bfec9fd256ca995895a19c64141c05c685a0/iron-dome-banner-750x140.png?raw=true',
    cacheTtlMs: 12 * 60 * 60 * 1000,
    badgeText: 'MEMBER OF THE IRON DOME',
    bannerId: 'iron-dome-banner',
    badgeId: 'iron-dome-tag',
    debugPanelId: 'iron-dome-debug-panel',
    debug: true,      // set to false to hide the debug panel
    forceShow: false, // set true to verify insertion even without JSON/faction match
  };

  const STORAGE_KEYS = { factions: 'ironDome.factions.cache.v2' };
  const norm = (s) => (s || '').trim().toLowerCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ------------------- Debug panel ------------------- */
  function ensureDebugPanel() {
    if (!CONFIG.debug) return null;
    let p = document.getElementById(CONFIG.debugPanelId);
    if (!p) {
      p = document.createElement('div');
      p.id = CONFIG.debugPanelId;
      p.style.cssText = [
        'position:fixed','right:8px','bottom:8px','z-index:99999',
        'max-width:300px','font:12px/1.35 system-ui,Arial,sans-serif',
        'background:#111b','color:#d7e0ea','border:1px solid #2b3440',
        'padding:8px','border-radius:8px','backdrop-filter:blur(2px)',
        'box-shadow:0 2px 8px rgba(0,0,0,.35)'
      ].join(';');
      document.body.appendChild(p);
    }
    return p;
  }
  function report(lines) {
    if (!CONFIG.debug) return;
    const p = ensureDebugPanel();
    if (p) p.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
  }

  /* ------------------- Fetch + cache ------------------- */
  async function loadFactionSet() {
    // cache
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.factions);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.list) && Date.now() - parsed.ts < CONFIG.cacheTtlMs) {
          return { set: new Set(parsed.list.map(norm)), source: 'cache', count: parsed.list.length };
        }
      }
    } catch {}

    // fetch fresh
    try {
      const res = await fetch(CONFIG.sourceUrl, { cache: 'no-store', mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      if (!Array.isArray(list)) throw new Error('JSON not array');
      localStorage.setItem(STORAGE_KEYS.factions, JSON.stringify({ ts: Date.now(), list }));
      return { set: new Set(list.map(norm)), source: 'network', count: list.length };
    } catch (e) {
      // stale cache fallback
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.factions);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.list)) {
            return { set: new Set(parsed.list.map(norm)), source: 'stale-cache', count: parsed.list.length, error: e.message };
          }
        }
      } catch {}
      return { set: new Set(), source: 'none', count: 0, error: e.message };
    }
  }

  /* ------------------- Faction detection (robust) ------------------- */
  function getFactionName() {
    // 1) Any anchor to /factions.php with meaningful text
    const candidates = Array.from(document.querySelectorAll('a[href*="/factions.php"]'));
    let best = '';
    for (const a of candidates) {
      const t = (a.textContent || '').trim();
      // Skip generic labels like 'Faction'
      if (t && t.length > best.length && !/^faction$/i.test(t)) best = t;
      // Check attributes that might hold the real name
      const title = (a.getAttribute('title') || '').trim();
      if (title && title.length > best.length && !/^faction$/i.test(title)) best = title;
      const aria = (a.getAttribute('aria-label') || '').trim();
      if (aria && aria.length > best.length && !/^faction$/i.test(aria)) best = aria;
    }
    if (best) return best;

    // 2) Look near the anchor for text (parent row, list item, etc.)
    for (const a of candidates) {
      const block = a.closest('li, tr, div, section, article');
      if (block) {
        const text = (block.textContent || '').trim();
        // Heuristic: pick the longest capitalized chunk
        const chunks = text.split(/[\n\r]+/).map(s => s.trim()).filter(Boolean);
        const guess = chunks.sort((x,y)=>y.length-x.length)[0] || '';
        if (guess && guess.length > 2 && !/^faction$/i.test(guess)) return guess;
      }
    }

    // 3) Fallback: scan known containers
    const containers = [
      '.profile-container',
      '#profileroot',
      'main',
      '#content',
      '#mainContainer'
    ];
    for (const sel of containers) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const txt = (el.textContent || '').trim();
      // Try to find a line that looks like a proper name (at least one space and mixed case)
      const lines = txt.split(/[\n\r]+/).map(s=>s.trim()).filter(Boolean);
      const likely = lines.find(s => s.length > 3 && /[A-Za-z]/.test(s) && !/^faction$/i.test(s));
      if (likely) return likely;
    }

    return null;
  }

  /* ------------------- Insertion points (broad) ------------------- */
  function findInsertionPoint() {
    const selectors = [
      '.buttons-list',
      '.profile-actions',
      '.profile-container',
      '#profileroot',
      '#content',
      '#mainContainer',
      'main'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return { el, sel };
    }
    return { el: document.body, sel: 'document.body' };
  }

  function removeExisting() {
    document.getElementById(CONFIG.bannerId)?.remove();
    document.getElementById(CONFIG.badgeId)?.remove();
  }

  function insertUI() {
    const { el: host, sel } = findInsertionPoint();

    const img = document.createElement('img');
    img.id = CONFIG.bannerId;
    img.src = CONFIG.bannerUrl;
    img.alt = 'Iron Dome Alliance';
    img.referrerPolicy = 'no-referrer';
    img.style.width = '750px';
    img.style.height = '140px';
    img.style.display = 'block';
    img.style.margin = '10px auto 4px auto';
    img.style.borderRadius = '8px';
    img.style.border = '1px solid rgba(255,255,255,0.12)';
    img.decoding = 'async';
    img.loading = 'lazy';

    const tag = document.createElement('div');
    tag.id = CONFIG.badgeId;
    tag.textContent = CONFIG.badgeText;
    tag.style.cssText = [
      'margin: 6px auto 0 auto',
      'text-align: center',
      'font-weight: 700',
      'color: #ff4444',
      'letter-spacing: .3px',
    ].join(';');

    if (host.classList?.contains('buttons-list') || host.classList?.contains('profile-actions')) {
      host.insertAdjacentElement('afterend', img);
      img.insertAdjacentElement('afterend', tag);
    } else {
      host.appendChild(img);
      host.appendChild(tag);
    }
    return sel;
  }

  /* ------------------- Main ------------------- */
  let factionsSet = new Set();
  let factionsMeta = { source: 'none', count: 0 };
  let busy = false;
  let lastInsertSel = '';

  async function evaluate() {
    if (busy) return;
    busy = true;
    try {
      // wait for profile UI bits to land
      for (let i = 0; i < 24; i++) {
        const hasButtons = document.querySelector('.buttons-list, .profile-actions');
        const hasFactionBit = document.querySelector('a[href*="/factions.php"]') ||
                              document.querySelector('span[title*=" of "]');
        if (hasButtons || hasFactionBit) break;
        await sleep(150);
      }

      const faction = getFactionName();
      const inAlliance = CONFIG.forceShow || (faction && factionsSet.has(norm(faction)));

      removeExisting();
      lastInsertSel = '';
      if (inAlliance) {
        lastInsertSel = insertUI();
      }

      if (CONFIG.debug) {
        report([
          `<b>IronDome Diagnostic</b>`,
          `Faction: <b>${faction || '(not found)'}</b>`,
          `List source: ${factionsMeta.source} (${factionsMeta.count})`,
          `In alliance: <b>${!!inAlliance}</b>`,
          `Insert point: ${lastInsertSel || '(none yet)'}`,
        ]);
      }
    } finally {
      busy = false;
    }
  }

  async function init() {
    const meta = await loadFactionSet();
    factionsSet = meta.set;
    factionsMeta = { source: meta.source, count: meta.count };

    await evaluate();

    // Watch DOM changes (SPA)
    const obs = new MutationObserver(() => evaluate());
    obs.observe(document.documentElement, { childList: true, subtree: true });

    // Watch URL changes
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        evaluate();
      }
    }, 400);
  }

  init();

  // Manual helpers in PDA console:
  // localStorage.removeItem('ironDome.factions.cache.v2'); // clear cache then reload
})();
