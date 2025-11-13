// ==UserScript==
// @name         Torn PDA: Iron Dome Checker + List Manager (Single Script)
// @namespace    WetNightmare
// @version      2.0.0
// @description  Banner for Iron Dome members + a built-in faction list editor (edit/paste/import/export/clear). No network fetches needed.
// @match        https://www.torn.com/*
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  /* =========================
   *  Shared config & storage
   * ========================= */
  const STORAGE_KEY = 'ironDome.factions.local.v1'; // { ts:number, list:string[] }
  const CONFIG = {
    // Banner (image loads fine in PDA)
    bannerUrl: 'https://github.com/WetNightmare/FactionAlliance/blob/f373bfec9fd256ca995895a19c64141c05c685a0/iron-dome-banner-750x140.png?raw=true',
    bannerId: 'iron-dome-banner',
    badgeId: 'iron-dome-tag',
    badgeText: 'MEMBER OF THE IRON DOME',

    // Behavior
    forceShow: false,   // true = show banner on all profiles (handy for quick visual testing)
    maxWaitMs: 12000,   // wait up to 12s for profile DOM anchors to appear
    evalDebounceMs: 250 // debounce for SPA mutations/URL changes
  };

  const norm = (s) => (s || '').trim().toLowerCase();
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function readList() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const obj = JSON.parse(raw);
      return Array.isArray(obj.list) ? obj.list : [];
    } catch {
      return [];
    }
  }
  function writeList(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ts: Date.now(), list }));
  }

  /* =========================
   *  Part A — List Manager UI
   *  (available site-wide)
   * ========================= */
  function mountListButton() {
    if (document.getElementById('iron-dome-list-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'iron-dome-list-btn';
    btn.textContent = '🛡️ Iron Dome List';
    btn.title = 'Open Iron Dome faction list manager';
    btn.style.cssText = [
      'position:fixed','right:10px','bottom:10px','z-index:2147483647',
      'padding:6px 10px','border-radius:8px',
      'background:#17202a','color:#d7e0ea','border:1px solid #3a4756','cursor:pointer',
      'font:12px system-ui,Arial,sans-serif','box-shadow:0 4px 14px rgba(0,0,0,.35)'
    ].join(';');
    btn.addEventListener('click', openEditor);
    document.body.appendChild(btn);
  }

  function openEditor() {
    const current = readList();
    const area = document.createElement('textarea');
    area.rows = 14;
    area.value = current.join('\n');
    area.placeholder = 'One faction per line\nExample:\nStage Fright\nThe Swarm\nDesert Phoenix';
    area.style.cssText = 'width:100%;box-sizing:border-box;background:#0f1720;color:#d7e0ea;border:1px solid #2b3440;border-radius:8px;padding:10px;outline:none';

    const wrapper = document.createElement('div');
    wrapper.id = 'iron-dome-editor-wrapper';
    wrapper.style.cssText = 'position:fixed;inset:0;background:#000a;display:flex;align-items:center;justify-content:center;z-index:2147483647';

    const modal = document.createElement('div');
    modal.style.cssText = 'width:92%;max-width:560px;background:#0b0f13;color:#d7e0ea;border:1px solid #2b3440;border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.6);padding:14px;font:13px system-ui,Arial,sans-serif';

    const title = document.createElement('div');
    title.textContent = 'Iron Dome Faction List (local only)';
    title.style.cssText = 'font-weight:800;margin:2px 0 10px 0';

    const hint = document.createElement('div');
    hint.innerHTML = '• <b>Edit</b> below (one per line) or use <b>Paste</b>/<b>Import</b> for JSON.<br>• Use <b>Export</b>/<b>Copy JSON</b> to back up your list.';
    hint.style.cssText = 'opacity:.85;margin:-4px 0 10px 0';

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:10px';

    // Buttons
    const btnPaste = mkBtn('Paste', () => pasteIntoArea(area));
    const btnImport = mkBtn('Import JSON', () => importFromFile(area));
    const btnCopy = mkBtn('Copy JSON', () => copyJson(currentFromArea(area)));
    const btnExport = mkBtn('Export JSON', () => exportJson(currentFromArea(area)));
    const btnClear = mkBtn('Clear', () => { area.value=''; area.focus(); });
    const spacer = document.createElement('div'); spacer.style.flex='1 1 auto';
    const btnCancel = mkBtn('Cancel', () => document.body.removeChild(wrapper));
    const btnSave = mkBtnAccent('Save', () => {
      const lines = area.value.split('\n').map(s => s.trim()).filter(Boolean);
      writeList(lines);
      document.body.removeChild(wrapper);
      toast(`Saved ${lines.length} factions`);
      // trigger re-eval on profile if present
      try { scheduleEvaluate && scheduleEvaluate('list-save'); } catch {}
    });

    actions.append(btnPaste, btnImport, btnCopy, btnExport, btnClear, spacer, btnCancel, btnSave);

    modal.append(title, hint, area, actions);
    wrapper.appendChild(modal);
    document.body.appendChild(wrapper);
  }

  function mkBtn(text, onClick){
    const b = document.createElement('button');
    b.textContent = text;
    b.onclick = onClick;
    b.style.cssText = 'padding:6px 10px;border-radius:8px;border:1px solid #3a4756;background:#17202a;color:#d7e0ea;cursor:pointer';
    return b;
  }
  function mkBtnAccent(text, onClick){
    const b = mkBtn(text, onClick);
    b.style.background = '#1f2a36';
    b.style.borderColor = '#4a5a6e';
    b.style.fontWeight = '700';
    return b;
  }

  function currentFromArea(area) {
    return area.value.split('\n').map(s => s.trim()).filter(Boolean);
  }

  function pasteIntoArea(area) {
    const doPrompt = () => {
      const s = prompt('Paste JSON array (["Faction A","Faction B",...]) OR plain text (one per line):');
      if (!s) return;
      applyPastedText(s, area);
    };
    if (navigator.clipboard?.readText) {
      navigator.clipboard.readText().then(txt => {
        if (txt && txt.trim()) applyPastedText(txt, area); else doPrompt();
      }).catch(doPrompt);
    } else {
      doPrompt();
    }
  }

  function applyPastedText(s, area) {
    try {
      let items;
      if (s.trim().startsWith('[')) {
        const arr = JSON.parse(s);
        if (!Array.isArray(arr)) throw new Error('Not an array');
        items = arr.map(x => String(x));
      } else {
        items = s.split('\n').map(t => t.trim()).filter(Boolean);
      }
      const existing = area.value.split('\n').map(t => t.trim()).filter(Boolean);
      const merged = Array.from(new Set([...existing, ...items]));
      area.value = merged.join('\n');
      toast(`Pasted ${items.length} items (merged to ${merged.length})`);
    } catch (e) {
      alert(`Paste error: ${e.message || e}`);
    }
  }

  function exportJson(list) {
    try {
      const json = JSON.stringify(list, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `iron-dome-factions-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast(`Exported ${list.length} factions as JSON file`);
    } catch (e) {
      alert(`Export error: ${e.message || e}`);
    }
  }

  function copyJson(list) {
    const json = JSON.stringify(list, null, 2);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(json).then(() => {
        toast('JSON copied to clipboard');
      }).catch(() => prompt('Copy your JSON:', json));
    } else {
      prompt('Copy your JSON:', json);
    }
  }

  function importFromFile(area) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json,text/plain';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = String(reader.result || '');
          if (!text.trim()) return;
          applyPastedText(text, area);
        } catch (e) {
          alert(`Import error: ${e.message || e}`);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = [
      'position:fixed','left:50%','transform:translateX(-50%)',
      'bottom:56px','z-index:2147483647',
      'background:#0b0f13','color:#d7e0ea','border:1px solid #2b3440',
      'padding:6px 10px','border-radius:8px','font:12px system-ui,Arial,sans-serif',
      'box-shadow:0 6px 16px rgba(0,0,0,.45)','opacity:0','transition:opacity .15s ease'
    ].join(';');
    document.body.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; });
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 180); }, 1500);
  }

  /* =====================================
   *  Part B — Banner Checker (profiles)
   *  (uses the shared local list)
   * ===================================== */
  let evaluateTimer = null;
  let evaluating = false;

  function scheduleEvaluate(reason = 'mutation') {
    if (evaluateTimer) clearTimeout(evaluateTimer);
    evaluateTimer = setTimeout(() => { void runCheck(reason); }, CONFIG.evalDebounceMs);
  }

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

  function insertBanner() {
    const buttonsList = findButtonsList();
    const img = buildBanner();
    const tag = buildBadge();

    if (buttonsList) {
      buttonsList.insertAdjacentElement('afterend', img);
      img.insertAdjacentElement('afterend', tag);
    } else {
      // Fallback: at least make it visible somewhere predictable
      (document.querySelector('#mainContainer, main, #content, body') || document.body).append(img, tag);
    }
  }

  async function waitForProfile() {
    const start = Date.now();
    while (Date.now() - start < CONFIG.maxWaitMs) {
      const hasButtons = document.querySelector('.buttons-list');
      const hasFaction = document.querySelector('span[title*=" of "] a[href*="/factions.php"]');
      if (hasButtons && hasFaction) return true;
      await sleep(200);
    }
    return false;
  }

  async function runCheck(reason = 'init') {
    if (evaluating) return;
    evaluating = true;
    try {
      // Only act on profiles
      if (!/\/profiles\.php/.test(location.pathname)) return;

      const ok = await waitForProfile();
      if (!ok) return;

      const list = readList().map(norm);
      const faction = extractFactionName();
      if (!faction) return;

      const inAlliance = CONFIG.forceShow || list.includes(norm(faction));
      removeExisting();
      if (inAlliance) insertBanner();
    } finally {
      evaluating = false;
    }
  }

  /* =========================
   *  Boot
   * ========================= */
  function boot() {
    // Mount list manager on all pages
    mountListButton();

    // If on a profile, evaluate now + watch SPA changes
    if (/\/profiles\.php/.test(location.pathname)) {
      void runCheck('init');

      const obs = new MutationObserver(() => scheduleEvaluate('mutation'));
      obs.observe(document.documentElement, { childList: true, subtree: true });

      let lastHref = location.href;
      setInterval(() => {
        if (location.href !== lastHref) {
          lastHref = location.href;
          scheduleEvaluate('url-change');
        }
      }, 400);
    }
  }

  boot();
})();
