// ==UserScript==
// @name         Torn PDA: Iron Dome Checker (Hardcoded, Robust DOM Logic)
// @namespace    WetNightmare
// @version      3.1.0
// @description  Inserts banner under .buttons-list when the profile's faction is in a hardcoded list. SPA-safe, debounced, original selectors.
// @match        https://www.torn.com/profiles.php*
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  // ---------------- Hardcoded Iron Dome factions ----------------
  const IRON_DOME_FACTIONS = [
    "Combat Ready HQ",
    "CR-ACK",
    "CRashpad",
    "Cosa-Nostra",
    "Desert Phoenix",
    "Desert Falcon",
    "Halos Pulse",
    "The Swarm",
    "Strict Union",
    "Rockstars",
    "Angels of Deception",
    "Angels of Domination",
    "Forbidden Realm",
    "MYTHIC MAYHEM",
    "Valor's Edge",
    "Strikeforce",
    "2nd Chance",
    "Academy of Strippers",
    "Echoes of Eden",
    "The Hallowed Order"
  ];

  // ---------------- Config ----------------
  const CONFIG = {
    bannerUrl: 'https://github.com/WetNightmare/FactionAlliance/blob/f373bfec9fd256ca995895a19c64141c05c685a0/iron-dome-banner-750x140.png?raw=true',
    bannerId:  'iron-dome-banner',
    badgeId:   'iron-dome-tag',
    badgeText: 'MEMBER OF THE IRON DOME',

    forceShow: false,   // set true to force banner on for testing
    maxWaitMs: 12000,   // wait up to 12s for profile DOM anchors
    evalDebounceMs: 250 // debounce for SPA updates
  };

  const norm = (s) => (s || '').trim().toLowerCase();
  const FACTION_SET = new Set(IRON_DOME_FACTIONS.map(norm));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ---------------- Original DOM logic (unchanged) ----------------
  function extractFactionName() {
    // Find span[title*=" of "] that contains a factions link; read the link text
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
    document.getElementById(CONFIG.bannerId)?.remove?.();
    document.getElementById(CONFIG.badgeId)?.remove?.();
  }

  function buildBanner() {
    const img = document.createElement('img');
    img.id = CONFIG.bannerId;
    img.src = CONFIG.bannerUrl;
    img.alt = 'Iron Dome Alliance';
    img.style.width = '750px';
    img.style.height = '140px';
    img.style.border = '1px solid rgba(255,255,255,0.12)';
    img.style.borderRadius = '8px';
    img.style.display = 'block';
    img.style.margin = '10px auto 4px auto';
    img.loading = 'lazy';
    return img;
  }

  function buildBadge() {
    const tag = document.createElement('div');
    tag.id = CONFIG.badgeId;
    tag.textContent = CONFIG.badgeText;
    tag.style.color = '#ff4444';
    tag.style.fontWeight = 'bold';
    tag.style.textAlign = 'center';
    tag.style.marginTop = '6px';
    return tag;
  }

  function insertBannerAndTag() {
    const buttonsList = findButtonsList();
    const img = buildBanner();
    const tag = buildBadge();

    if (buttonsList) {
      // Insert exactly after .buttons-list (same as the earlier working versions)
      buttonsList.insertAdjacentElement('afterend', img);
      img.insertAdjacentElement('afterend', tag);
    } else {
      // Final fallback: place somewhere visible so it still shows if buttons-list isn't present
      (document.querySelector('#mainContainer, main, #content, body') || document.body).append(img, tag);
    }
  }

  async function waitForProfileDom() {
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

  // ---------------- Main (debounced, SPA-safe) ----------------
  let evaluating = false;
  let timer = null;

  function scheduleEvaluate(reason = 'mutation') {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void evaluate(reason); }, CONFIG.evalDebounceMs);
  }

  async function evaluate(reason = 'init') {
    if (evaluating) return;
    evaluating = true;
    try {
      const phase = await waitForProfileDom(); // waits for anchors as in previous version
      if (phase === 'timeout') return;

      const faction = extractFactionName();
      if (!faction) return;

      const match = CONFIG.forceShow || FACTION_SET.has(norm(faction));
      removeExisting();
      if (match) insertBannerAndTag();
    } finally {
      evaluating = false;
    }
  }

  async function init() {
    await evaluate('init');

    // Observe SPA DOM updates
    const obs = new MutationObserver(() => scheduleEvaluate('mutation'));
    obs.observe(document.documentElement, { childList: true, subtree: true });

    // React to URL changes in SPA
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        scheduleEvaluate('url-change');
      }
    }, 400);
  }

  void init();
})();
