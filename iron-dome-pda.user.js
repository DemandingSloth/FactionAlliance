// Iron Dome Checker for Torn PDA (remote-load friendly, no GM_*)
// Loads live JSON from Gist, caches via localStorage, injects banner + tag
(() => {
  'use strict';

  const CONFIG = {
    sourceUrl: 'https://gist.githubusercontent.com/WetNightmare/297cba005b3319118f31ebf146e90b0b/raw/199d410bcd3b00cbb252a8366d650123fd2229f5/iron-dome-factions.json',
    bannerUrl: 'https://github.com/WetNightmare/FactionAlliance/blob/f373bfec9fd256ca995895a19c64141c05c685a0/iron-dome-banner-750x140.png?raw=true',
    cacheTtlMs: 12 * 60 * 60 * 1000, // 12 hours
    badgeText: 'MEMBER OF THE IRON DOME',
    bannerId: 'iron-dome-banner',
    badgeId: 'iron-dome-tag',
    debug: false
  };

  const STORAGE_KEYS = {
    factions: 'ironDome.factions.cache.v1'
  };

  const log = (...a) => CONFIG.debug && console.log('[IronDome]', ...a);
  const norm = (s) => (s || '').trim().toLowerCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function loadFactionSet() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.factions);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.list) && Date.now() - parsed.ts < CONFIG.cacheTtlMs) {
          log('Using cached faction list');
          return new Set(parsed.list.map(norm));
        }
      }
    } catch (e) {
      log('Cache read error', e);
    }

    try {
      const res = await fetch(CONFIG.sourceUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      if (!Array.isArray(list)) throw new Error('JSON not array');

      try {
        localStorage.setItem(STORAGE_KEYS.factions, JSON.stringify({ ts: Date.now(), list }));
      } catch (e) {
        log('Cache write error', e);
      }
      log('Fetched fresh faction list');
      return new Set(list.map(norm));
    } catch (e) {
      log('Fetch failed; trying stale cache', e);
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.factions);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.list)) return new Set(parsed.list.map(norm));
        }
      } catch {}
      return new Set();
    }
  }

  function getFactionName() {
    const link = document.querySelector('a[href*="/factions.php"]');
    if (link?.textContent) return link.textContent.trim();

    const span = Array.from(document.querySelectorAll('span[title*=" of "]'))
      .find((el) => el.querySelector('a[href*="/factions.php"]'));
    if (span) {
      const a = span.querySelector('a[href*="/factions.php"]');
      if (a?.textContent) return a.textContent.trim();
    }
    return null;
  }

  function findButtonsArea() {
    return (
      document.querySelector('.buttons-list') ||
      document.querySelector('[class*="buttons"]') ||
      document.body
    );
  }

  function removeExisting() {
    document.getElementById(CONFIG.bannerId)?.remove();
    document.getElementById(CONFIG.badgeId)?.remove();
  }

  function insertUI() {
    const host = findButtonsArea();
    if (!host) return;

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

    if (host.classList?.contains('buttons-list')) {
      host.insertAdjacentElement('afterend', img);
      img.insertAdjacentElement('afterend', tag);
    } else {
      host.appendChild(img);
      host.appendChild(tag);
    }
  }

  let factionsSet = new Set();
  let ticking = false;

  async function evaluate() {
    if (ticking) return;
    ticking = true;
    try {
      for (let i = 0; i < 12; i++) {
        const hasButtons = findButtonsArea();
        const hasFaction = document.querySelector('a[href*="/factions.php"]') ||
                           document.querySelector('span[title*=" of "]');
        if (hasButtons && hasFaction) break;
        await sleep(150);
      }

      const faction = getFactionName();
      log('Detected faction:', faction);
      if (!faction) {
        removeExisting();
        return;
      }

      if (factionsSet.has(norm(faction))) {
        removeExisting();
        insertUI();
      } else {
        removeExisting();
      }
    } finally {
      ticking = false;
    }
  }

  async function init() {
    factionsSet = await loadFactionSet();
    await evaluate();

    const obs = new MutationObserver(() => evaluate());
    obs.observe(document.documentElement, { childList: true, subtree: true });

    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        evaluate();
      }
    }, 400);
  }

  init();

  // Helper: In PDA console, you can run:
  // localStorage.removeItem('ironDome.factions.cache.v1')  // then reload
})();
