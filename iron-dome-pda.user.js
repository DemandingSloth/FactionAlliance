// ==UserScript==
// @name         Torn PDA: Iron Dome Checker (Local List Manager)
// @namespace    WetNightmare
// @version      1.7.0
// @description  No network. Original selectors + banner under .buttons-list. Built-in List Manager (edit/paste/export), debug panel, debounced evaluator.
// @match        https://www.torn.com/profiles.php*
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = {
    // --- Banner (image is fine in PDA WebView) ---
    bannerUrl: 'https://github.com/WetNightmare/FactionAlliance/blob/f373bfec9fd256ca995895a19c64141c05c685a0/iron-dome-banner-750x140.png?raw=true',

    // --- Behavior & Diagnostics ---
    cacheTtlMs: 365 * 24 * 60 * 60 * 1000, // keep local list "fresh" for a year
    badgeText: 'MEMBER OF THE IRON DOME',
    bannerId:  'iron-dome-banner',
    badgeId:   'iron-dome-tag',

    debug: true,                 // show panel
    panelId: 'iron-dome-debug',
    forceShow: false,            // bypass membership check but still waits for DOM anchors
    maxWaitMs: 12000,
    evalDebounceMs: 250
  };

  // Single storage slot for your local list
  const STORAGE = {
    cache: 'ironDome.factions.local.v1'   // { ts, list[] }
  };

  // ================= Utilities & Debug Panel =================
  const norm  = s => (s || '').trim().toLowerCase();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function ensurePanel() {
    let box = document.getElementById(CONFIG.panelId);
    if (!box) {
      box = document.createElement('div');
      box.id = CONFIG.panelId;
      box.style.cssText = [
        'position:fixed','right:8px','bottom:8px','z-index:2147483647',
        'max-width:380px','font:12px/1.4 system-ui,Arial,sans-serif',
        'background:#0b0f13cc','color:#d7e0ea','border:1px solid #2b3440',
        'padding:8px 10px 10px','border-radius:10px','backdrop-filter:blur(2px)',
        'box-shadow:0 6px 18px rgba(0,0,0,.45)'
      ].join(';');

      const controls = document.createElement('div');
      controls.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;align-items:center';

      const btnEdit  = makeBtn('Edit List', openEditor);
      const btnPaste = makeBtn('Paste List', pasteList);
      const btnExport= makeBtn('Export', exportList);
      const btnClear = makeBtn('Clear', clearList);
      const btnHide  = makeBtn('Hide', () => box.style.display='none');

      controls.append(btnEdit, btnPaste, btnExport, btnClear, btnHide);

      const log = document.createElement('div');
      log.id = CONFIG.panelId + '-log';

      box.appendChild(controls);
      box.appendChild(log);
      document.documentElement.appendChild(box);
    }
    return box;
  }
  function makeBtn(text, onclick){
    const b = document.createElement('button');
    b.textContent = text;
    b.onclick = onclick;
    b.style.cssText = 'padding:3px 8px;border-radius:6px;border:1px solid #3a4756;background:#17202a;color:#d7e0ea;cursor:pointer';
    return b;
  }
  function logLines(lines){
    if (!CONFIG.debug) return;
    ensurePanel();
    const log = document.getElementById(CONFIG.panelId + '-log');
    if (log) log.innerHTML = lines.map(x => `<div>${x}</div>`).join('');
  }
  setInterval(() => CONFIG.debug && ensurePanel(), 1000); // keep panel alive
  logLines(['<b>IronDome</b> (Local List) booting…']);

  // ================= Local List Store =================
  function readLocalList() {
    try {
      const raw = localStorage.getItem(STORAGE.cache);
      if (!raw) return { list: [], ts: 0 };
      const obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.list)) return { list: [], ts: 0 };
      return { list: obj.list, ts: obj.ts || 0 };
    } catch {
      return { list: [], ts: 0 };
    }
  }
  function writeLocalList(list) {
    localStorage.setItem(STORAGE.cache, JSON.stringify({ ts: Date.now(), list }));
  }

  // ================= List Manager UI =================
  function openEditor() {
    const current = readLocalList().list;
    const text = current.join('\n');
    const area = document.createElement('textarea');
    area.value = text;
    area.rows = 12;
    area.style.cssText = 'width:100%;box-sizing:border-box;background:#0f1720;color:#d7e0ea;border:1px solid #2b3440;border-radius:6px;padding:8px;outline:none';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0008;display:flex;align-items:center;justify-content:center';
    const modal = document.createElement('div');
    modal.style.cssText = 'width:90%;max-width:520px;background:#0b0f13;color:#d7e0ea;border:1px solid #2b3440;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.6);padding:12px';
    modal.innerHTML = `
      <div style="font-weight:700;margin-bottom:8px">Iron Dome Factions (one per line)</div>
    `;
    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:8px';
    const btnCancel = makeBtn('Cancel', () => document.body.removeChild(wrapper));
    const btnSave   = makeBtn('Save', () => {
      const lines = area.value.split('\n').map(s => s.trim()).filter(Boolean);
      writeLocalList(lines);
      document.body.removeChild(wrapper);
      logLines([`<b>List saved</b>: ${lines.length} factions`]);
      setTimeout(() => scheduleEval('edit-save'), 50);
    });

    modal.appendChild(area);
    buttons.append(btnCancel, btnSave);
    modal.appendChild(buttons);
    wrapper.appendChild(modal);
    document.body.appendChild(wrapper);
  }

  function pasteList() {
    // Try clipboard; fall back to prompt
    const doPrompt = async () => {
      const s = prompt('Paste JSON array (["Faction A","Faction B",...]) OR plain text (one per line).');
      if (!s) return;
      applyPasted(s);
    };
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(text => {
        if (text && text.trim()) applyPasted(text);
        else doPrompt();
      }).catch(doPrompt);
    } else {
      doPrompt();
    }
  }
  function applyPasted(s) {
    try {
      let list;
      if (s.trim().startsWith('[')) {
        const arr = JSON.parse(s);
        if (!Array.isArray(arr)) throw new Error('Not an array');
        list = arr.map(x => String(x));
      } else {
        list = s.split('\n').map(t => t.trim()).filter(Boolean);
      }
      writeLocalList(list);
      logLines([`<b>List saved (pasted)</b>: ${list.length} factions`]);
      setTimeout(() => scheduleEval('paste'), 50);
    } catch (e) {
      logLines([`<span style="color:#ff7272"><b>Paste error:</b> ${e.message || e}</span>`]);
    }
  }

  function exportList() {
    const list = readLocalList().list;
    const json = JSON.stringify(list, null, 2);
    // Best-effort copy; also show in prompt for manual copy if needed
    let copied = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(() => {
        copied = true;
        logLines([`<b>Exported</b> ${list.length} factions to clipboard.`]);
      }).catch(() => {});
    }
    if (!copied) {
      prompt('Copy your JSON:', json);
      logLines([`<b>Exported</b> ${list.length} factions (shown in prompt).`]);
    }
  }
  function clearList() {
    localStorage.removeItem(STORAGE.cache);
    logLines(['<b>List cleared.</b> Add items via Edit/Paste.']);
    scheduleEval('clear');
  }

  // ================= Original DOM logic =================
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
  function removeExisting() {
    document.getElementById(CONFIG.bannerId)?.remove();
    document.getElementById(CONFIG.badgeId)?.remove();
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

  // ================= Main (debounced) =================
  let listSet = new Set();
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
        `List source: <b>local</b> (${listCount})`,
        `In alliance (match | force): <b>${!!(faction && listSet.has(norm(faction)))} | ${CONFIG.forceShow}</b>`,
        `Inserted: ${inAlliance} @ ${where}`
      ]);
    } finally {
      evaluating = false;
    }
  }

  async function init() {
    // Load local list
    const { list } = readLocalList();
    listSet = new Set(list.map(norm));
    listCount = list.length;

    if (!listCount) {
      logLines([
        `<span style="color:#ffd166"><b>No local list found.</b></span>`,
        `Use <b>Edit List</b> or <b>Paste List</b> to add factions (one per line or JSON array).`
      ]);
    } else {
      logLines([`<b>Loaded local list</b>: ${listCount} factions`]);
    }

    await evaluate('init');

    // Observe SPA DOM updates
    const obs = new MutationObserver(() => scheduleEval('mutation'));
    obs.observe(document.documentElement, { childList: true, subtree: true });

    // Observe URL changes
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

