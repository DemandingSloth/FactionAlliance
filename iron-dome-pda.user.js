// ==UserScript==
// @name         Torn PDA: Iron Dome Checker (Robust PDA Build)
// @namespace    WetNightmare
// @version      1.3.0
// @description  PDA-safe: fetch+cache live JSON, robustly extract faction name from "Faction | role of/in faction" row, and insert banner+tag near that row.
// @match        https://www.torn.com/profiles.php*
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = {
    // ✅ Live JSON hosted in your repo (friendliest CORS for WebView)
    sourceUrl: 'https://raw.githubusercontent.com/WetNightmare/FactionAlliance/main/iron-dome-factions.json',

    // ✅ Hosted banner image (your GitHub file with ?raw=true)
    bannerUrl: 'https://github.com/WetNightmare/FactionAlliance/blob/f373bfec9fd256ca995895a19c64141c05c685a0/iron-dome-banner-750x140.png?raw=true',

    cacheTtlMs: 12 * 60 * 60 * 1000, // 12 hours
    badgeText: 'MEMBER OF THE IRON DOME',
    bannerId: 'iron-dome-banner',
    badgeId: 'iron-dome-tag',

    // Debug/diagnostics
    debug: false,                // <-- set true to show on-screen debug panel
    debugPanelId: 'iron-dome-debug-panel',
    forceShow: false,            // <-- set true to show banner/tag even if not matched (for insertion testing)
  };

  const STORAGE_KEYS = { factions: 'ironDome.factions.cache.v2' };

  const norm  = (s) => (s || '').trim().toLowerCase();
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
    // Try cache first
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.factions);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.list) && Date.now() - parsed.ts < CONFIG.cacheTtlMs) {
          return { set: new Set(parsed.list.map(norm)), source: 'cache', count: parsed.list.length };
        }
      }
    } catch {/* ignore cache read errors */}

    // Fetch fresh
    try {
      const res = await fetch(CONFIG.sourceUrl, { cache: 'no-store', mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      if (!Array.isArray(list)) throw new Error('JSON not array');

      localStorage.setItem(STORAGE_KEYS.factions, JSON.stringify({ ts: Date.now(), list }));
      return { set: new Set(list.map(norm)), source: 'network', count: list.length };
    } catch (e) {
      // Fallback to stale cache
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

  /* ------------------- Faction extraction (robust) ------------------- */
  function getFactionName() {
    // A) Preferred: scrape the “Faction | …” row explicitly
    const rowSelectors = [
      'tr',                  // generic tables
      '.info-row',           // common info rows
      'li',                  // list implementations
      '.profile-section div' // generic container blocks
    ];

    for (const rs of rowSelectors) {
      const rows = document.querySelectorAll(rs);
      for (const row of rows) {
        // left/label cell
        const labelEl =
          row.querySelector('th, .label, .title, .left, .key') ||
          (row.children[0] && row.children[0].matches('td,div,span') ? row.children[0] : null);

        if (!labelEl) continue;
        const label = (labelEl.textContent || '').trim().toLowerCase();
        if (label !== 'faction') continue;

        // right/value cell
        const valueEl =
          row.querySelector('td:last-child, .value, .right, .val') ||
          (row.children[1] && row.children[1].matches('td,div,span') ? row.children[1] : null) ||
          row;

        // 1) If there’s a factions link, that text is authoritative
        const link = valueEl.querySelector('a[href*="/factions.php"]');
        if (link && link.textContent) {
          const txt = link.textContent.trim();
          if (txt && !/^faction$/i.test(txt)) return txt;
        }

        // 2) Parse phrases like: "Enforcer of Stage Fright" or "Enforcer in Stage Fright"
        const raw = (valueEl.textContent || '').replace(/\s+/g, ' ').trim();
        const m = raw.match(/\b(?:of|in)\s+(.+?)\s*$/i);
        if (m && m[1]) return m[1].trim();

        // 3) Fallback: pick the longest chunk of text
        const chunks = raw.split(/[|–—\-•·]/).map(s => s.trim()).filter(Boolean);
        const guess = chunks.sort((a,b)=>b.length-a.length)[0];
        if (guess) return guess;
      }
    }

    // B) Secondary: scan any factions link elsewhere, prefer longest non-generic text
    const anchors = Array.from(document.querySelectorAll('a[href*="/factions.php"]'));
    let best = '';
    for (const a of anchors) {
      const t = (a.textContent || a.getAttribute('title') || a.getAttribute('aria-label') || '').trim();
      if (t && !/^faction$/i.test(t) && t.length > best.length) best = t;
    }
    if (best) return best;

    return null;
  }

  /* ------------------- Insertion points (prefers faction row) ------------------- */
  function findInsertionPoint() {
    // 1) Directly after the Faction row (cleanest)
    const factionRow = (() => {
      // Table rows
      const trs = document.querySelectorAll('tr');
      for (const tr of trs) {
        const first = tr.querySelector('th, td');
        if (first && (first.textContent || '').trim().toLowerCase() === 'faction') return tr;
      }
      // General rows
      const rows = document.querySelectorAll('.info-row, li, .profile-section div');
      for (const r of rows) {
        const label =
          r.querySelector('.label, .title, .left, .key') ||
          (r.children[0] && r.children[0].matches('div,span') ? r.children[0] : null);
        if (label && (label.textContent || '').trim().toLowerCase() === 'faction') return r;
      }
      return null;
    })();
    if (factionRow) return { el: factionRow, sel: 'faction-row' };

    // 2) Familiar UI anchors
    const candidates = [
      '.buttons-list',
      '.profile-actions',
      '.profile-container',
      '#profileroot',
      '#content',
      '#mainContainer',
      'main',
      'body'
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) return { el, sel };
    }
    return { el: document.body, sel: 'body' };
  }

  function removeExisting() {
    document.getElementById(CONFIG.bannerId)?.remove();
    document.getElementById(CONFIG.badgeId)?.remove();
  }

  function insertUI() {
    const { el: host, sel } = findInsertionPoint();

    // Banner (Torn-friendly size)
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

    // Text tag
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

    if (sel === 'faction-row') {
      host.insertAdjacentElement('afterend', img);
      img.insertAdjacentElement('afterend', tag);
    } else if (host.classList?.contains('buttons-list') || host.classList?.contains('profile-actions')) {
      host.insertAdjacentElement('afterend', img);
      img.insertAdjacentElement('afterend', tag);
    } else {
      host.appendChild(img);
      host.appendChild(tag);
    }
    return sel;
  }

  /* ------------------- Main loop ------------------- */
  let factionsSet = new Set();
  let factionsMeta = { source: 'none', count: 0 };
  let busy = false;
  let lastInsertSel = '';

  async function evaluate() {
    if (busy) return;
    busy = true;
    try {
      // Wait for profile UI bits to land
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
      if (inAlliance) lastInsertSel = insertUI();

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

  // PDA console helpers:
  // localStorage.removeItem('ironDome.factions.cache.v2'); // clear cache then reload
})();
