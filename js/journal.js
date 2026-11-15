/*
 * Private journal.
 *
 * The window opens only after the fallen star on the dock is dragged into
 * the farmer's hands. Entries live in ONE json file inside a PRIVATE GitHub
 * repo. The page reads and writes it through the GitHub API with a
 * fine-grained token that is stored only in this browser. The repo name and
 * token never appear in this site's source, so the star is the hidden door
 * and the token is the lock.
 *
 * File format (journal.json):
 *   { version, tags: [{name, created}], tagsDeleted: {name: ts},
 *     entries: [{id, kind, title, date, tags, html, created, updated}],
 *     deleted: {id: ts} }
 * The tombstones let two devices merge cleanly when both pushed.
 */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

  // --------------------------------------------------------------- storage
  const CFG = 'journal.cfg', DRAFT = 'journal.draft';
  const ls = {
    get(k) {
      for (const s of [localStorage, sessionStorage]) {
        try { const v = s.getItem(k); if (v) return JSON.parse(v); } catch { /* unavailable */ }
      }
      return null;
    },
    set(k, v, persist = true) {
      try { (persist ? localStorage : sessionStorage).setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ }
      try { (persist ? sessionStorage : localStorage).removeItem(k); } catch { /* ignore */ }
    },
    del(k) { for (const s of [localStorage, sessionStorage]) { try { s.removeItem(k); } catch { /* ignore */ } } },
  };

  // ---------------------------------------------------------------- github
  const API = 'https://api.github.com';
  let cfg = null;      // { repo: 'owner/name', branch, path, token }
  let sha = null;      // blob sha of journal.json as last seen on GitHub

  function gh(path, opts = {}) {
    return fetch(`${API}/repos/${cfg.repo}${path}`, {
      ...opts,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  }
  async function ghError(r, what) {
    let msg = '';
    try { msg = (await r.json()).message || ''; } catch { /* no body */ }
    if (r.status === 401) return new Error('token rejected (expired or revoked?)');
    if (r.status === 403) return new Error(`${what}: forbidden. The token needs Contents: read & write on this repo.${msg ? ` (${msg})` : ''}`);
    if (r.status === 404) return new Error(`${what}: not found. Check owner/repo and that the token can see it.`);
    return new Error(`${what}: HTTP ${r.status}${msg ? `: ${msg}` : ''}`);
  }
  const filePath = () => cfg.path.split('/').map(encodeURIComponent).join('/');

  function toB64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function fromB64(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function checkRepo() {
    const r = await gh('');
    if (!r.ok) throw await ghError(r, 'repo');
    const j = await r.json();
    if (!j.private) throw new Error(`${cfg.repo} is public. The journal only lives in a private repo.`);
  }

  async function pull() {
    const r = await gh(`/contents/${filePath()}?ref=${encodeURIComponent(cfg.branch)}`);
    if (r.status === 404) return { data: emptyJournal(), sha: null };    // first push creates it
    if (!r.ok) throw await ghError(r, 'read');
    const j = await r.json();
    let b64 = j.content;
    if (!b64 || j.encoding === 'none') {             // over 1 MB the contents API leaves the body out
      const b = await gh(`/git/blobs/${j.sha}`);
      if (!b.ok) throw await ghError(b, 'read');
      b64 = (await b.json()).content;
    }
    let data;
    try { data = JSON.parse(fromB64(b64)); } catch { throw new Error(`${cfg.path} in the repo is not valid JSON`); }
    return { data: normalize(data), sha: j.sha };
  }

  async function put(data, prevSha) {
    const body = {
      message: `journal: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      content: toB64(JSON.stringify(data, null, 1)),
      branch: cfg.branch,
    };
    if (prevSha) body.sha = prevSha;
    const r = await gh(`/contents/${filePath()}`, { method: 'PUT', body: JSON.stringify(body) });
    if (r.status === 409) return { conflict: true };
    if (r.status === 422) {
      const msg = await r.clone().json().then((j) => j.message || '', () => '');
      if (/sha/i.test(msg)) return { conflict: true };
    }
    if (!r.ok) throw await ghError(r, 'push');
    return { sha: (await r.json()).content.sha };
  }

  // ------------------------------------------------------------------ data
  const emptyJournal = () => ({ version: 1, tags: [], tagsDeleted: {}, entries: [], deleted: {} });

  function normalize(d) {
    const o = emptyJournal();
    if (!isObj(d)) return o;
    o.tags = (Array.isArray(d.tags) ? d.tags : []).filter((t) => t && typeof t.name === 'string')
      .map((t) => ({ name: t.name, created: +t.created || 0 }));
    o.tagsDeleted = isObj(d.tagsDeleted) ? { ...d.tagsDeleted } : {};
    o.deleted = isObj(d.deleted) ? { ...d.deleted } : {};
    o.entries = (Array.isArray(d.entries) ? d.entries : []).filter((e) => e && typeof e.id === 'string').map((e) => ({
      id: e.id,
      kind: e.kind === 'blog' ? 'blog' : 'diary',
      title: String(e.title ?? ''),
      date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : today(),
      tags: Array.isArray(e.tags) ? e.tags.filter((t) => typeof t === 'string') : [],
      html: String(e.html ?? ''),
      created: +e.created || 0,
      updated: +e.updated || 0,
    }));
    return o;
  }

  // newest edit of each entry wins; tombstones beat anything older than them
  function merge(a, b) {
    const out = emptyJournal();
    for (const k of ['deleted', 'tagsDeleted']) {
      out[k] = { ...b[k] };
      for (const [id, ts] of Object.entries(a[k])) out[k][id] = Math.max(ts, out[k][id] || 0);
    }
    const byId = new Map();
    for (const e of [...b.entries, ...a.entries]) {
      const o = byId.get(e.id);
      if (!o || e.updated >= o.updated) byId.set(e.id, e);
    }
    out.entries = [...byId.values()].filter((e) => !(out.deleted[e.id] >= e.updated));
    const tags = new Map();
    for (const t of [...b.tags, ...a.tags]) if (!tags.has(t.name) || t.created > tags.get(t.name).created) tags.set(t.name, t);
    out.tags = [...tags.values()].filter((t) => !(out.tagsDeleted[t.name] >= t.created));
    return out;
  }

  // ------------------------------------------------------------- sanitizer
  // Everything shown in the editor goes through this allowlist, so a
  // tampered journal.json or a paste can't inject script or styles.
  const BLOCK = { P: 'p', DIV: 'div', UL: 'ul', OL: 'ol', LI: 'li', BLOCKQUOTE: 'blockquote', H1: 'h3', H2: 'h3', H3: 'h3', H4: 'h3' };
  const INLINE = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', MARK: 'mark', BR: 'br' };
  const DROP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'HEAD', 'TITLE', 'META',
    'LINK', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'CANVAS']);

  function safeHref(u, lenient = false) {
    u = String(u || '').trim();
    if (/^(https?:\/\/|mailto:)/i.test(u)) return u;
    if (lenient && /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/.test(u)) return `https://${u}`;
    return '';
  }

  function clean(html, paste = false) {
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    const out = document.createElement('div');
    copy(doc.body, out, paste);
    return out.innerHTML;
  }
  function copy(src, dst, paste) {
    for (const n of src.childNodes) {
      if (n.nodeType === 3) { dst.append(n.data); continue; }
      if (n.nodeType !== 1 || DROP.has(n.tagName)) continue;
      const tag = n.tagName, st = (n.getAttribute('style') || '').toLowerCase();
      const name = BLOCK[tag] || INLINE[tag];
      let el = null;
      if (tag === 'A') {
        const h = safeHref(n.getAttribute('href'));
        if (h) { el = document.createElement('a'); el.setAttribute('href', h); }
      } else if (tag === 'B' && /font-weight:\s*(normal|[1-5]00)/.test(st)) {
        el = null;                                        // google docs wraps everything in <b style=normal>
      } else if (name) {
        el = document.createElement(name);
      }
      if (name === 'br') { dst.append(el); continue; }
      let into = dst;
      if (el) { dst.append(el); into = el; }
      if (!BLOCK[tag]) {                                  // inline styles (spans) -> real tags
        const wraps = [];
        if (/font-weight:\s*(bold|[6-9]00)/.test(st) && name !== 'b') wraps.push('b');
        if (/font-style:\s*italic/.test(st) && name !== 'i') wraps.push('i');
        if (/text-decoration[^;]*underline/.test(st) && name !== 'u') wraps.push('u');
        if (!paste && name !== 'mark' && /background(-color)?:\s*(?!transparent|initial|inherit|none|rgba\([^)]*,\s*0\))/.test(st)) wraps.push('mark');
        for (const w of wraps) { const x = document.createElement(w); into.append(x); into = x; }
      }
      copy(n, into, paste);
    }
  }

  const textCache = new Map();
  function textOf(e) {
    const c = textCache.get(e.id);
    if (c && c.html === e.html) return c.text;
    const spaced = e.html.replace(/<\/(p|div|li|h3|blockquote)>|<br\s*\/?>/gi, '$& ');
    const text = new DOMParser().parseFromString(spaced, 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
    textCache.set(e.id, { html: e.html, text });
    return text;
  }

  // ----------------------------------------------------------------- state
  let state = null;                 // the whole journal, in memory
  let dirty = false, rev = 0, busy = false, lastPushed = 0;
  let view = 'lock', current = null;
  const fresh = new Set();          // entries created this session (empty ones get discarded)
  const filters = { q: '', kind: 'all', tags: new Set(), sort: 'desc' };

  function saveDraft() { if (cfg && state) ls.set(DRAFT, { repo: cfg.repo, data: state }); }
  function loadDraft() { const d = ls.get(DRAFT); return d && cfg && d.repo === cfg.repo ? normalize(d.data) : null; }

  function markDirty() { rev++; dirty = true; saveDraft(); paint(); }
  function touch() { if (current) current.updated = Date.now(); markDirty(); }

  // ---------------------------------------------------------------- window
  const root = document.createElement('section');
  root.id = 'journal';
  root.className = 'jr';
  root.hidden = true;
  root.setAttribute('aria-label', 'Journal');
  root.innerHTML = `
    <header class="jr-bar">
      <div class="dots">
        <button type="button" class="dot red" data-act="close" aria-label="Close journal" title="close"></button>
        <button type="button" class="dot yellow" data-act="min" aria-label="Minimize journal" title="minimize"></button>
        <button type="button" class="dot green" data-act="max" aria-label="Maximize journal" title="maximize (or double-click the title bar)"></button>
      </div>
      <span class="jr-name">journal</span>
      <span class="jr-status" role="status"></span>
      <button type="button" class="jr-btn jr-push" data-act="push" hidden title="commit to GitHub (⌘S)">push</button>
    </header>
    <div class="jr-body"></div>
    ${['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((d) => `<div class="jr-rz jr-rz-${d}" data-edge="${d}" aria-hidden="true"></div>`).join('')}`;
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.id = 'jr-tab';
  tab.hidden = true;
  tab.textContent = '* journal';
  tab.setAttribute('aria-label', 'Restore journal');
  document.body.append(root, tab);

  const body = $('.jr-body', root), statusEl = $('.jr-status', root), pushBtn = $('.jr-push', root);

  function paint(msg, cls = '') {
    statusEl.className = `jr-status ${cls}`;
    statusEl.textContent = msg ?? (!state ? '' : dirty ? '● unpushed' : lastPushed ? `pushed ${hhmm(lastPushed)}` : 'in sync');
    pushBtn.classList.toggle('hot', dirty);
  }

  let hideTimer = 0;
  function show() {
    clearTimeout(hideTimer);
    root.hidden = false;
    tab.hidden = true;
    void root.offsetWidth;                         // let the slide-in transition start from off-screen
    root.classList.add('open');
  }
  function slideOut() {
    root.classList.remove('open');
    hideTimer = setTimeout(() => { root.hidden = true; }, 450);
  }

  function open() {
    if (root.classList.contains('open')) return;
    show();
    if (state) return;
    const saved = ls.get(CFG);
    if (saved?.token) connect(saved);
    else renderLock();
  }
  function minimize() { flushEditor(); slideOut(); tab.hidden = false; }
  async function close() {
    flushEditor();
    if (dirty && state && confirm('Push your unpushed changes before closing?')) await push();
    slideOut();
    tab.hidden = true;
    window.Scene?.star.fall();
  }

  // ------------------------------------------------------------ lock / sync
  function renderLock(error = '', prefill = ls.get(CFG) || {}) {
    view = 'lock';
    pushBtn.hidden = true;
    paint('locked');
    body.innerHTML = `
      <form class="jr-lock">
        <p class="jr-lead">This window reads and writes a <b>private</b> GitHub repo. The token stays in this browser.</p>
        <label>repo<input name="repo" class="jr-input" placeholder="owner/private-repo" required autocomplete="off" spellcheck="false" value="${esc(prefill.repo || '')}"></label>
        <div class="jr-row2">
          <label>branch<input name="branch" class="jr-input" value="${esc(prefill.branch || 'main')}" spellcheck="false"></label>
          <label>file<input name="path" class="jr-input" value="${esc(prefill.path || 'journal.json')}" spellcheck="false"></label>
        </div>
        <label>token<input name="token" class="jr-input" type="password" required placeholder="github_pat_…" autocomplete="off"></label>
        <label class="jr-check"><input type="checkbox" name="remember" checked> remember on this device</label>
        <button class="jr-btn jr-primary">unlock</button>
        <p class="jr-err" role="alert">${esc(error)}</p>
        <details>
          <summary>first time?</summary>
          <ol>
            <li>Create a <b>private</b> repo on GitHub (e.g. <code>notes</code>), initialized with a README.</li>
            <li>GitHub → Settings → Developer settings → Fine-grained tokens → Generate. Repository access: <i>only</i> that repo. Permissions: <b>Contents: Read and write</b>.</li>
            <li>Paste it here. Nothing is written until you press push.</li>
          </ol>
        </details>
      </form>`;
    $('[name="token"]', body).focus();
  }

  async function connect(c, remember) {
    cfg = c;
    body.innerHTML = '<div class="jr-empty">opening…</div>';
    paint('connecting…');
    try {
      await checkRepo();
      const remote = await pull();
      sha = remote.sha;
      const draft = loadDraft();
      state = draft ? merge(draft, remote.data) : remote.data;
      dirty = !!draft && JSON.stringify(state) !== JSON.stringify(remote.data);
      if (!dirty) ls.del(DRAFT);
      if (remember !== undefined) ls.set(CFG, c, remember);
      pushBtn.hidden = false;
      paint();
      renderList();
    } catch (e) {
      const prefill = { ...c, token: '' };
      cfg = null;
      renderLock(e.message, prefill);
    }
  }

  async function push() {
    if (busy || !state || !cfg) return false;
    flushEditor();
    busy = true;
    const startRev = rev;
    paint('pushing…');
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await put(state, sha);
        if (!res.conflict) {
          sha = res.sha;
          lastPushed = Date.now();
          dirty = rev !== startRev;                // typed while pushing? still dirty
          if (!dirty) ls.del(DRAFT);
          fresh.clear();
          paint();
          return true;
        }
        // another device pushed first: fold its changes in and retry
        const remote = await pull();
        state = merge(state, remote.data);
        sha = remote.sha;
        if (current) current = state.entries.find((e) => e.id === current.id) || current;
        if (view === 'list') renderRows();
      }
      throw new Error('push kept conflicting with GitHub, try again');
    } catch (e) {
      paint(e.message, 'err');
      return false;
    } finally {
      busy = false;
    }
  }

  function lock() {
    if (dirty && !confirm('You have unpushed changes. Lock anyway and lose them?')) return;
    ls.del(CFG); ls.del(DRAFT);
    cfg = null; state = null; sha = null; dirty = false; current = null;
    renderLock();
  }

  // ------------------------------------------------------------------ list
  function renderList() {
    leaveEntry();
    view = 'list';
    body.innerHTML = `
      <div class="jr-tools">
        <button type="button" class="jr-btn jr-primary" data-act="new" data-kind="diary">+ diary</button>
        <button type="button" class="jr-btn" data-act="new" data-kind="blog">+ blog</button>
        <input type="search" class="jr-input jr-search" placeholder="search" value="${esc(filters.q)}" aria-label="Search entries">
        <button type="button" class="jr-btn" data-act="sort" title="sort by date">${filters.sort === 'desc' ? 'newest ↓' : 'oldest ↑'}</button>
      </div>
      <div class="jr-filters">
        <div class="jr-seg" role="group" aria-label="Kind">${['all', 'diary', 'blog'].map((k) =>
          `<button type="button" class="${filters.kind === k ? 'on' : ''}" data-act="kind" data-kind="${k}">${k}</button>`).join('')}</div>
        ${state.tags.map((t) => `<button type="button" class="jr-chip ${filters.tags.has(t.name) ? 'on' : ''}" data-act="ftag" data-tag="${esc(t.name)}">#${esc(t.name)}</button>`).join('')}
        <button type="button" class="jr-link" data-act="tags">manage tags</button>
      </div>
      <ol class="jr-rows"></ol>
      <div class="jr-foot"><button type="button" class="jr-link" data-act="lock">lock &amp; forget token</button></div>`;
    renderRows();
  }

  function visible() {
    const q = filters.q.trim().toLowerCase();
    const dir = filters.sort === 'desc' ? -1 : 1;
    return state.entries
      .filter((e) => filters.kind === 'all' || e.kind === filters.kind)
      .filter((e) => [...filters.tags].every((t) => e.tags.includes(t)))
      .filter((e) => !q || `${e.title} ${textOf(e)} ${e.tags.join(' ')}`.toLowerCase().includes(q))
      .sort((a, b) => dir * (a.date === b.date ? a.created - b.created : a.date < b.date ? -1 : 1));
  }

  function renderRows() {
    const ol = $('.jr-rows', root);
    if (!ol) return;
    const list = visible();
    if (!list.length) {
      ol.innerHTML = `<li class="jr-empty">${state.entries.length ? 'nothing matches.' : 'nothing yet. Start with <b>+ diary</b>.'}</li>`;
      return;
    }
    let month = '';
    ol.innerHTML = list.map((e) => {
      const d = parseDate(e.date);
      const m = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      const head = m !== month ? `<li class="jr-month">${esc((month = m))}</li>` : '';
      const snip = textOf(e).slice(0, 160);
      return `${head}<li><button type="button" class="jr-entry" data-act="open" data-id="${esc(e.id)}">
        <span class="jr-day"><b>${d.getDate()}</b>${esc(d.toLocaleDateString(undefined, { weekday: 'short' }).toLowerCase())}</span>
        <span class="jr-main">
          <span class="jr-t">${esc(e.title || 'untitled')}${e.kind === 'blog' ? ' <span class="jr-kind">blog</span>' : ''}</span>
          ${snip ? `<span class="jr-snip">${esc(snip)}</span>` : ''}
          ${e.tags.length ? `<span class="jr-tagline">${e.tags.map((t) => `#${esc(t)}`).join(' ')}</span>` : ''}
        </span></button></li>`;
    }).join('');
  }

  // ----------------------------------------------------------------- entry
  const FMT = [
    ['bold', 'B', 'bold (⌘B)'], ['italic', 'I', 'italic (⌘I)'], ['underline', 'U', 'underline (⌘U)'],
    ['hl', 'H', 'highlight (⌘⇧H)'], ['link', 'link', 'link (⌘K)'], '|',
    ['insertUnorderedList', '•', 'bullets'], ['insertOrderedList', '1.', 'numbered list'],
    ['outdent', '⇤', 'outdent (⇧Tab)'], ['indent', '⇥', 'indent (Tab)'], '|',
    ['removeFormat', 'clear', 'clear formatting'],
  ];

  function newEntry(kind) {
    const now = Date.now();
    const e = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), kind, title: '', date: today(),
      tags: [...filters.tags], html: '', created: now, updated: now };
    state.entries.push(e);
    fresh.add(e.id);
    renderEntry(e);
    $('.jr-title', root).focus();
  }

  function renderEntry(e) {
    leaveEntry();
    view = 'entry';
    current = e;
    body.innerHTML = `
      <div class="jr-entrybar">
        <button type="button" class="jr-link" data-act="back">← entries</button>
        <span class="jr-spacer"></span>
        <button type="button" class="jr-link jr-danger" data-act="delete">delete</button>
      </div>
      <div class="jr-fmt" role="toolbar" aria-label="Formatting">
        ${FMT.map((f) => (f === '|' ? '<span class="jr-sep"></span>'
          : `<button type="button" class="f-${f[0]}" data-fmt="${f[0]}" title="${f[2]}" aria-label="${f[2]}">${f[1]}</button>`)).join('')}
        <span class="jr-linkbar" hidden><input type="text" class="jr-input" placeholder="https://… (empty removes the link)" aria-label="Link URL"></span>
      </div>
      <article class="jr-doc">
        <div class="jr-meta">
          <input type="date" class="jr-input jr-date" value="${esc(e.date)}" aria-label="Date">
          <div class="jr-seg" role="group" aria-label="Kind">${['diary', 'blog'].map((k) =>
            `<button type="button" class="${e.kind === k ? 'on' : ''}" data-act="ekind" data-kind="${k}">${k}</button>`).join('')}</div>
        </div>
        <input class="jr-title" placeholder="untitled" value="${esc(e.title)}" aria-label="Title">
        <div class="jr-etags"></div>
        <div class="jr-ed" contenteditable="true" spellcheck="true" aria-label="Entry text" aria-multiline="true"></div>
      </article>`;
    const ed = $('.jr-ed', root);
    ed.innerHTML = clean(e.html) || '<p><br></p>';
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* old browser */ }
    renderEntryTags();
    body.scrollTop = 0;
  }

  function renderEntryTags() {
    const box = $('.jr-etags', root);
    if (!box || !current) return;
    box.innerHTML = current.tags.map((t) =>
      `<span class="jr-chip on">#${esc(t)}<button type="button" data-act="untag" data-tag="${esc(t)}" aria-label="Remove tag ${esc(t)}">×</button></span>`).join('') +
      `<input class="jr-tagin" list="jr-taglist" placeholder="+ tag" aria-label="Add tag" autocomplete="off">
       <datalist id="jr-taglist">${state.tags.filter((t) => !current.tags.includes(t.name)).map((t) => `<option value="${esc(t.name)}">`).join('')}</datalist>`;
  }

  let flushTimer = 0;
  function scheduleFlush() { clearTimeout(flushTimer); flushTimer = setTimeout(flushEditor, 400); }
  function flushEditor() {
    clearTimeout(flushTimer);
    const ed = view === 'entry' && $('.jr-ed', root);
    if (!ed || !current) return;
    const html = clean(ed.innerHTML);
    if (html !== current.html) { current.html = html; touch(); }
  }

  function leaveEntry() {
    if (view !== 'entry' || !current) return;
    flushEditor();
    if (fresh.has(current.id) && !current.title.trim() && !textOf(current)) {
      state.entries = state.entries.filter((x) => x !== current);       // never-used blank entry
    }
    current = null;
  }

  // ---------------------------------------------------------------- format
  function selRange(ed) {
    const s = getSelection();
    return s.rangeCount && ed.contains(s.getRangeAt(0).commonAncestorContainer) ? s.getRangeAt(0) : null;
  }
  function closestFromSel(q) {
    const ed = $('.jr-ed', root), r = ed && selRange(ed);
    if (!r) return null;
    let n = r.commonAncestorContainer;
    if (n.nodeType !== 1) n = n.parentElement;
    const hit = n?.closest(q);
    return hit && ed.contains(hit) ? hit : null;
  }
  function unwrap(el) { el.replaceWith(...el.childNodes); }

  const HL = 'mark, span[style*="background"]';
  function toggleHighlight(ed, forceOff = false) {
    const r = selRange(ed);
    if (!r) return;
    const hits = [...ed.querySelectorAll(HL)].filter((m) => r.intersectsNode(m));
    const anc = closestFromSel(HL);
    if (anc && !hits.includes(anc)) hits.push(anc);
    if (hits.length) { hits.forEach(unwrap); return; }
    if (forceOff || r.collapsed) return;
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('hiliteColor', false, '#f2cc60');
    document.execCommand('styleWithCSS', false, false);
    // swap the browser's inline background styles for <mark>, then reselect.
    // Chrome uses a span, or styles an existing <b>/<i> when the selection fills one.
    const made = [...ed.querySelectorAll('[style*="background"]')].map((el) => {
      const m = document.createElement('mark');
      m.append(...el.childNodes);
      el.style.removeProperty('background-color');
      el.style.removeProperty('background');
      if (el.tagName === 'SPAN' && !el.getAttribute('style')?.trim()) el.replaceWith(m);
      else el.append(m);
      return m;
    });
    if (made.length) {
      const nr = document.createRange();
      nr.setStartBefore(made[0]);
      nr.setEndAfter(made[made.length - 1]);
      getSelection().removeAllRanges();
      getSelection().addRange(nr);
    }
  }

  let savedRange = null;
  function showLinkBar() {
    const ed = $('.jr-ed', root), r = selRange(ed);
    if (!r) return;
    savedRange = r.cloneRange();
    const a = closestFromSel('a');
    const bar = $('.jr-linkbar', root), inp = $('input', bar);
    bar.hidden = false;
    inp.value = a ? a.getAttribute('href') : '';
    inp.focus();
    inp.select();
  }
  function hideLinkBar(restore = true) {
    $('.jr-linkbar', root).hidden = true;
    const ed = $('.jr-ed', root);
    ed.focus();
    if (restore && savedRange) { getSelection().removeAllRanges(); getSelection().addRange(savedRange); }
  }
  function applyLink(raw) {
    hideLinkBar();
    const url = raw.trim();
    const a = closestFromSel('a');
    if (!url) {
      if (a) unwrap(a);
      else document.execCommand('unlink');
    } else {
      const href = safeHref(url, true);
      if (!href) { paint('links must be http(s):// or mailto:', 'err'); return; }
      if (a) a.setAttribute('href', href);
      else if (getSelection().isCollapsed) document.execCommand('insertHTML', false, `<a href="${esc(href)}">${esc(url)}</a>&nbsp;`);
      else document.execCommand('createLink', false, href);
    }
    scheduleFlush();
  }

  function fmt(c) {
    const ed = $('.jr-ed', root);
    if (!ed) return;
    if (!selRange(ed)) ed.focus();
    if (c === 'hl') toggleHighlight(ed);
    else if (c === 'link') { showLinkBar(); return; }
    else {
      document.execCommand(c, false, null);
      if (c === 'removeFormat') toggleHighlight(ed, true);   // removeFormat leaves <mark> alone
    }
    scheduleFlush();
    paintToolbar();
  }

  function paintToolbar() {
    if (view !== 'entry') return;
    for (const b of root.querySelectorAll('[data-fmt]')) {
      const c = b.dataset.fmt;
      let on = false;
      if (c === 'hl') on = !!closestFromSel(HL);
      else if (c === 'link') on = !!closestFromSel('a');
      else if (/^(bold|italic|underline|insert\w+List)$/.test(c)) { try { on = document.queryCommandState(c); } catch { /* ignore */ } }
      b.classList.toggle('on', on);
    }
  }

  // ------------------------------------------------------------------ tags
  const tagName = (s) => String(s).trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 32);

  function ensureTag(n) {
    if (!state.tags.some((t) => t.name === n)) { state.tags.push({ name: n, created: Date.now() }); markDirty(); }
  }
  function addTagToEntry(raw) {
    const n = tagName(raw);
    if (!n || !current) return;
    ensureTag(n);
    if (!current.tags.includes(n)) { current.tags.push(n); touch(); }
    renderEntryTags();
    $('.jr-tagin', root).focus();
  }
  function retag(from, to) {
    const now = Date.now();
    for (const e of state.entries) {
      if (!e.tags.includes(from)) continue;
      e.tags = [...new Set(e.tags.map((t) => (t === from ? to : t)).filter(Boolean))];
      e.updated = now;
    }
  }
  function deleteTag(n) {
    if (!confirm(`Delete #${n}? It will be removed from every entry.`)) return;
    retag(n, '');
    state.tags = state.tags.filter((t) => t.name !== n);
    state.tagsDeleted[n] = Date.now();
    filters.tags.delete(n);
    markDirty();
    renderTags();
  }
  function renameTag(n) {
    const to = tagName(prompt(`Rename #${n} to:`, n) || '');
    if (!to || to === n) return;
    ensureTag(to);
    retag(n, to);
    state.tags = state.tags.filter((t) => t.name !== n);
    state.tagsDeleted[n] = Date.now();
    if (filters.tags.delete(n)) filters.tags.add(to);
    markDirty();
    renderTags();
  }

  function renderTags() {
    leaveEntry();
    view = 'tags';
    const count = (n) => state.entries.filter((e) => e.tags.includes(n)).length;
    const tags = state.tags.slice().sort((a, b) => a.name.localeCompare(b.name));
    body.innerHTML = `
      <div class="jr-entrybar"><button type="button" class="jr-link" data-act="back">← entries</button></div>
      <div class="jr-doc">
        <h2 class="jr-h2">tags</h2>
        <input class="jr-input jr-newtag" placeholder="new tag, then enter" aria-label="New tag" autocomplete="off">
        <ul class="jr-taglist">${tags.map((t) => `<li>
          <span class="jr-chip">#${esc(t.name)}</span><span class="jr-count">${count(t.name)}</span><span class="jr-spacer"></span>
          <button type="button" class="jr-link" data-act="renametag" data-tag="${esc(t.name)}">rename</button>
          <button type="button" class="jr-link jr-danger" data-act="deltag" data-tag="${esc(t.name)}">delete</button></li>`).join('') ||
          '<li class="jr-empty">no tags yet.</li>'}</ul>
      </div>`;
    $('.jr-newtag', root).focus();
  }

  // ---------------------------------------------------------------- events
  const ACT = {
    close, min: minimize, push,
    max: () => toggleMax(),
    lock,
    new: (b) => newEntry(b.dataset.kind),
    open: (b) => { const e = state.entries.find((x) => x.id === b.dataset.id); if (e) renderEntry(e); },
    back: () => renderList(),
    tags: () => renderTags(),
    sort: () => { filters.sort = filters.sort === 'desc' ? 'asc' : 'desc'; renderList(); },
    kind: (b) => { filters.kind = b.dataset.kind; renderList(); },
    ftag: (b) => { const t = b.dataset.tag; filters.tags.has(t) ? filters.tags.delete(t) : filters.tags.add(t); renderList(); },
    ekind: (b) => {
      current.kind = b.dataset.kind;
      touch();
      for (const x of root.querySelectorAll('[data-act="ekind"]')) x.classList.toggle('on', x === b);
    },
    untag: (b) => { current.tags = current.tags.filter((t) => t !== b.dataset.tag); touch(); renderEntryTags(); },
    delete: () => {
      if (!confirm(`Delete "${current.title || 'untitled'}"? This takes effect on the next push.`)) return;
      state.deleted[current.id] = Date.now();
      state.entries = state.entries.filter((x) => x !== current);
      current = null;
      view = 'list';
      markDirty();
      renderList();
    },
    deltag: (b) => deleteTag(b.dataset.tag),
    renametag: (b) => renameTag(b.dataset.tag),
  };

  root.addEventListener('click', (e) => {
    const a = e.target.closest('.jr-ed a');
    if (a && (e.metaKey || e.ctrlKey)) {                 // ⌘/ctrl-click follows a link
      e.preventDefault();
      const h = safeHref(a.getAttribute('href'));
      if (h) window.open(h, '_blank', 'noopener');
      return;
    }
    const f = e.target.closest('[data-fmt]');
    if (f) { fmt(f.dataset.fmt); return; }
    const b = e.target.closest('[data-act]');
    if (b && root.contains(b)) ACT[b.dataset.act]?.(b, e);
  });
  // keep the editor's selection when pressing toolbar buttons
  root.addEventListener('mousedown', (e) => {
    if (e.target.closest('.jr-fmt') && !e.target.closest('.jr-linkbar')) e.preventDefault();
  });
  tab.addEventListener('click', show);

  root.addEventListener('submit', (e) => {
    if (!e.target.matches('.jr-lock')) return;
    e.preventDefault();
    const f = new FormData(e.target);
    const repo = String(f.get('repo')).trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { $('.jr-err', root).textContent = 'repo should look like owner/name'; return; }
    connect({
      repo,
      branch: String(f.get('branch')).trim() || 'main',
      path: String(f.get('path')).trim().replace(/^\/+/, '') || 'journal.json',
      token: String(f.get('token')).trim(),
    }, !!f.get('remember'));
  });

  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('.jr-search')) { filters.q = t.value; renderRows(); }
    else if (t.matches('.jr-title')) { current.title = t.value; touch(); }
    else if (t.matches('.jr-date')) { if (t.value) { current.date = t.value; touch(); } }
    else if (t.matches('.jr-ed')) scheduleFlush();
  });

  root.addEventListener('keydown', (e) => {
    const t = e.target, mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (mod && k === 's') { e.preventDefault(); push(); return; }
    if (t.matches('.jr-ed')) {
      if (e.key === 'Tab') { e.preventDefault(); fmt(e.shiftKey ? 'outdent' : 'indent'); }
      else if (mod && k === 'k') { e.preventDefault(); fmt('link'); }
      else if (mod && e.shiftKey && k === 'h') { e.preventDefault(); fmt('hl'); }
    } else if (t.matches('.jr-linkbar input')) {
      if (e.key === 'Enter') { e.preventDefault(); applyLink(t.value); }
      else if (e.key === 'Escape') { e.preventDefault(); hideLinkBar(); }
    } else if (t.matches('.jr-title') && e.key === 'Enter') {
      e.preventDefault();
      $('.jr-ed', root).focus();
    } else if (t.matches('.jr-tagin')) {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTagToEntry(t.value); }
      else if (e.key === 'Backspace' && !t.value && current.tags.length) { current.tags.pop(); touch(); renderEntryTags(); $('.jr-tagin', root).focus(); }
    } else if (t.matches('.jr-newtag') && e.key === 'Enter') {
      e.preventDefault();
      const n = tagName(t.value);
      if (n) { ensureTag(n); renderTags(); }
    }
  });
  // picking from the tag datalist fires `change` without Enter
  root.addEventListener('change', (e) => {
    if (e.target.matches('.jr-tagin') && state.tags.some((x) => x.name === tagName(e.target.value))) addTagToEntry(e.target.value);
  });

  root.addEventListener('paste', (e) => {
    if (!e.target.closest?.('.jr-ed')) return;
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertHTML', false, html ? clean(html, true) : esc(text).replace(/\n/g, '<br>'));
  });

  document.addEventListener('selectionchange', paintToolbar);
  window.addEventListener('beforeunload', (e) => {
    flushEditor();
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  // -------------------------------------------------- move / resize / max
  // Docked to the right edge by default. Dragging the title bar or an edge
  // makes it a floating window; dropping it against the right edge re-docks.
  const GEOM = 'journal.geom';
  const MIN_W = 320, MIN_H = 260, PAD = 12;
  const savedGeom = ls.get(GEOM) || {};
  let geom = savedGeom.geom || null;    // {x, y, w, h} when floating, null when docked
  let maxed = !!savedGeom.maxed;
  const small = () => innerWidth <= 640;
  const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function applyGeom() {
    const st = root.style;
    if (small() || (!geom && !maxed)) {
      st.left = st.top = st.width = st.height = '';
      root.classList.remove('float');
    } else {
      let g;
      if (maxed) g = { x: PAD, y: PAD, w: innerWidth - 2 * PAD, h: innerHeight - 2 * PAD };
      else {
        geom.w = clampN(geom.w, MIN_W, innerWidth - 2 * PAD);
        geom.h = clampN(geom.h, MIN_H, innerHeight - 2 * PAD);
        geom.x = clampN(geom.x, 80 - geom.w, innerWidth - 80);    // keep a grabbable strip on screen
        geom.y = clampN(geom.y, 0, innerHeight - geom.h);           // top and bottom edges stay reachable
        g = geom;
      }
      root.classList.add('float');
      Object.assign(st, { left: `${g.x}px`, top: `${g.y}px`, width: `${g.w}px`, height: `${g.h}px` });
    }
    root.classList.toggle('max', maxed && !small());
    $('.dot.green', root).setAttribute('aria-label', maxed ? 'Restore journal size' : 'Maximize journal');
  }
  function saveGeom() { ls.set(GEOM, { geom, maxed }); }
  function toggleMax() { maxed = !maxed; applyGeom(); saveGeom(); }
  const rectNow = () => { const r = root.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };

  const bar = $('.jr-bar', root);
  bar.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) toggleMax(); });
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button') || small()) return;
    e.preventDefault();
    const r = rectNow();
    let ox = e.clientX - r.x;
    const oy = e.clientY - r.y;
    if (maxed) {                                     // pulling a maximized window restores its size
      maxed = false;
      geom = geom || { w: Math.min(540, r.w), h: r.h };
      ox = Math.min(ox, geom.w - 60);
    } else if (!geom) {                              // leaving the dock: become a floating window
      geom = { ...r, h: Math.round(Math.min(r.h, innerHeight * 0.8)) };
    } else geom = r;
    const sx = e.clientX, sy = e.clientY;
    root.classList.add('moving');
    bar.setPointerCapture(e.pointerId);
    const move = (ev) => { geom.x = ev.clientX - ox; geom.y = ev.clientY - oy; applyGeom(); };
    const up = (ev) => {
      root.classList.remove('moving');
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 30 && ev.clientX >= innerWidth - 16) geom = null;   // re-dock
      applyGeom();
      saveGeom();
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });

  for (const h of root.querySelectorAll('.jr-rz')) {
    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || small()) return;
      e.preventDefault();
      const d = h.dataset.edge, r0 = rectNow(), sx = e.clientX, sy = e.clientY;
      maxed = false;
      geom = { ...r0 };
      root.classList.add('moving');
      h.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy, g = { ...r0 };
        if (d.includes('e')) g.w = Math.max(MIN_W, r0.w + dx);
        if (d.includes('s')) g.h = Math.max(MIN_H, r0.h + dy);
        if (d.includes('w')) { g.w = Math.max(MIN_W, r0.w - dx); g.x = r0.x + r0.w - g.w; }
        if (d.includes('n')) { g.h = Math.max(MIN_H, r0.h - dy); g.y = r0.y + r0.h - g.h; }
        geom = g;
        applyGeom();
      };
      const up = () => {
        root.classList.remove('moving');
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', up);
        h.removeEventListener('pointercancel', up);
        saveGeom();
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
      h.addEventListener('pointercancel', up);
    });
  }
  window.addEventListener('resize', applyGeom);
  applyGeom();

  // ------------------------------------------------------------ the star
  // While resting, the star is a real element: it twinkles, wakes up as the
  // cursor comes near, follows the pointer when dragged, and stays wherever
  // it's dropped. Drop it on the farmer and the scene takes over (ritual).
  const ember = document.getElementById('ember');
  const POS = 'star.pos';
  const S = () => window.Scene?.star;

  function placeEmber() {
    const st = S();
    if (!ember || !st) return;
    if (!ember.classList.contains('held')) {
      const c = st.cell();
      ember.style.left = `${c.x}px`;
      ember.style.top = `${c.y}px`;
    }
    ember.hidden = !(st.state === 'ground' || st.state === 'drag');
  }

  // brighten as the cursor approaches (0 far .. 1 on top of it)
  let nearRaf = 0, lastPt = null;
  document.addEventListener('pointermove', (e) => {
    lastPt = e;
    if (nearRaf || !ember || ember.hidden) return;
    nearRaf = requestAnimationFrame(() => {
      nearRaf = 0;
      const r = ember.getBoundingClientRect();
      const d = Math.hypot(lastPt.clientX - (r.left + r.width / 2), lastPt.clientY - (r.top + r.height / 2));
      ember.style.setProperty('--near', Math.max(0, 1 - d / 140).toFixed(3));
    });
  }, { passive: true });

  let lastTrail = 0;
  function trail(x, y) {
    const now = performance.now();
    if (now - lastTrail < 28) return;
    lastTrail = now;
    const p = document.createElement('span');
    p.className = 'ember-trail';
    p.textContent = ['.', '·', '*', '+', '`'][(Math.random() * 5) | 0];
    p.style.left = `${x + (Math.random() - 0.5) * 10}px`;
    p.style.top = `${y + (Math.random() - 0.5) * 10}px`;
    p.addEventListener('animationend', () => p.remove());
    document.body.append(p);
  }

  ember?.addEventListener('pointerdown', (e) => {
    const st = S();
    if (!st || e.button !== 0 || st.state !== 'ground') return;
    e.preventDefault();
    ember.setPointerCapture(e.pointerId);
    const c = st.cell();
    const ox = e.clientX - c.x, oy = e.clientY - c.y, sx = e.clientX, sy = e.clientY;
    let moved = false, x = c.x, y = c.y;
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
      if (!moved) { moved = true; st.grab(); ember.classList.add('held'); }
      x = clampN(ev.clientX - ox, 6, innerWidth - 6);
      y = clampN(ev.clientY - oy, 6, innerHeight - 6);
      ember.style.left = `${x}px`;
      ember.style.top = `${y}px`;
      ember.classList.toggle('near', st.overFarmer(x, y));
      trail(x, y);
    };
    const up = (ev) => {
      ember.removeEventListener('pointermove', move);
      ember.removeEventListener('pointerup', up);
      ember.removeEventListener('pointercancel', up);
      ember.classList.remove('held', 'near');
      if (!moved) {                                  // a tap: it flickers
        ember.classList.remove('poke');
        void ember.offsetWidth;
        ember.classList.add('poke');
        return;
      }
      if (ev.type === 'pointerup' && st.overFarmer(x, y)) {
        ember.hidden = true;
        st.ritual(open);
      } else {                                       // it rests wherever it was let go
        st.place(x, y);
        ls.set(POS, st.frac);
        st.release();
      }
    };
    ember.addEventListener('pointermove', move);
    ember.addEventListener('pointerup', up);
    ember.addEventListener('pointercancel', up);
  });
  ember?.addEventListener('animationend', (e) => { if (e.animationName === 'ember-poke') ember.classList.remove('poke'); });

  const savedPos = ls.get(POS);
  if (savedPos) S()?.setFrac(savedPos);
  window.addEventListener('scene:layout', placeEmber);
  window.addEventListener('scene:star', placeEmber);
  placeEmber();

  window.Journal = { open, close, push };
})();
