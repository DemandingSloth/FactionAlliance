// ==UserScript==
// @name         Torn PDA: Iron Dome Checker (Diagnostic)
// @namespace    WetNightmare
// @version      1.1.0
// @description  Diagnostic build: shows a debug panel with faction, JSON status, and insertion steps to find why UI isn't appearing.
// @match        https://www.torn.com/profiles.php*
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = {
    sourceUrl: 'https://gist.githubusercontent.com/WetNightmare/297cba005b3319118f31ebf146e90b0b/raw/199d410bcd3b00cbb252a8366d650123fd2229f5/iron-dome-factions.json',
    bannerUrl: 'https://github.com/WetNightmare/FactionAlliance/blob/f373bfec9fd256ca995895a19c64141c05c685a0/iron-dome-banner-750x140.png?raw=true',
    cacheTtlMs: 12 * 60 * 60 * 1000,
    badgeText: 'MEMBER OF THE IRON DOME',
    bannerId: 'iron-dome-banner',
    badgeId: 'iron-dome-tag',
    debugPanelId: 'iron-dome-debug-panel',
    debug: true,
    // Set to true to show banner+tag even if JSON isn't loaded or faction isn't matched (for DOM insertion testing)
    forceShow: false
  };

  const STORAGE_KEYS = { factions: 'ironDome.factions.cache.v1' };
  const norm = (s) => (s || '').trim().toLowerCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function ensureDebugPanel() {
    let p = document.getElementById(CONFIG.debugPanelId);
    if (!p) {
      p = document.createElement('div');
      p.id = CONFIG.debugPanelId;
      p.style.cssText = [
        'position:fixed','right:8px','bottom:8px','z-index:99999',
        'max-width:280px','font:12px/1.35 system-ui,Arial,sans-serif',
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
    p.innerHTML = lines.map(line => `<div>${line}</div>`).join('');
  }

  // Load factions with cache
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
    } catch (e) {
      // ignore cache errors
    }

    // fetch fresh
    try {
      const res = await fetch(CONFIG.sourceUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      if (!Array.isArray(list)) throw new Error('JSON not array');
      localStorage.setItem(STORAGE_KEYS.factions, JSON.stringify({ ts: Date.now(), list }));
      return { set: new Set(list.map(norm)), source: 'network', count: list.length };
    } catch (e) {
      // fallback to stale cache
      const raw = localStorage.getItem(STORAGE_KEYS.factions);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.list)) {
            return { set: new Set(parsed.list.map(norm)), source: 'stale-cache', count: parsed.list.length, error: e.message };
          }
        } catch {}
      }
      return { set: new Set(), source: 'none', count: 0, error: e.message };
    }
  }

  function getFactionName() {
    const link = document.querySelector('a[href*="/factions.php"]');
    if (link?.textContent) return link.textContent.trim();

    const span = Array.from(document.querySelectorAll('span[title*=" of "]'))
      .find(el => el.querySelector('a[href*="/factions.php"]'));
    if (span) {
      const a = span.querySelector('a[href*="/factions.php"]');
      if (a?.textContent) return a.textContent.trim();
    }
    return null;
  }

  // Try multiple insertion spots (PDA layouts can differ)
  function findInsertionPoint() {
    const candidates = [
      '.buttons-list',
      '[class*="buttons"]',
      '#profileroot',
      '.profile-container',
      '#mainContainer',
      'main'
    ];
    for (const sel of candidates) {
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

    // Banner
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

    // Tag
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

    // Place after buttons if possible, else append
    if (host.classList?.contains('buttons-list')) {
      host.insertAdjacentElement('afterend', img);
      img.insertAdjacentElement('afterend', tag);
    } else {
      host.appendChild(img);
      host.appendChild(tag);
    }

    return sel;
  }

  let factionsSet = new Set();
  let lastError = '';
  let lastInsertSel = '';

  async function evaluate() {
    try {
      // Wait for profile UI
      for (let i = 0; i < 20; i++) {
        const hasButtons = document.querySelector('.buttons-list') || document.querySelector('[class*="buttons"]');
        const hasFactionBits = document.querySelector('a[href*="/factions.php"]') ||
                               document.querySelector('span[title*=" of "]');
        if (hasButtons || hasFactionBits) break;
        await sleep(150);
      }

      const faction = getFactionName();
      const inAlliance = CONFIG.forceShow || (faction && factionsSet.has(norm(faction)));
      removeExisting();
      if (inAlliance) {
        lastInsertSel = insertUI();
      }

      report([
        `<b>IronDome Diagnostic</b>`,
        `Faction: <b>${faction || '(not found)'}</b>`,
        `List source: ${factionsMeta.source} (${factionsMeta.count})`,
        `In alliance: <b>${inAlliance}</b>`,
        `Insert point: ${lastInsertSel || '(none yet)'}`,
        lastError ? `Error: <span style="color:#ff7373">${lastError}</span>` : 'Error: (none)',
        CONFIG.forceShow ? '<span style="color:#ffd166">forceShow = true</span>' : ''
      ]);
    } catch (e) {
      lastError = e.message || String(e);
      report([`Error: ${lastError}`]);
    }
  }

  let factionsMeta = { set: new Set(), source: 'none', count: 0 };

  async function init() {
    try {
      const meta = await loadFactionSet();
      factionsSet = meta.set;
      factionsMeta = meta;
    } catch (e) {
      lastError = e.message || String(e);
    }

    await evaluate();

    // Watch for SPA changes
    const obs = new MutationObserver(() => evaluate());
    obs.observe(document.documentElement, { childList: true, subtree: true });

    // Watch URL changes too
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        evaluate();
      }
    }, 400);
  }

  init();

  // Helper for manual reset in PDA console:
  // localStorage.removeItem('ironDome.factions.cache.v1');
})();
