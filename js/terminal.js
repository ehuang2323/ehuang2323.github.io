/*
 * A tiny fake shell over the site's content.
 * Content lives in content/*.json — edit those, not this file.
 */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const out = $('#output'), form = $('#prompt'), input = $('#cmd');
  const cwdEl = $('#cwd'), userEl = $('#ps1-user'), term = $('#term'), hud = $('#hud');

  let site = {}, projects = [], papers = [];
  let cwd = '~';
  let resumeOk = true;
  const hist = [];
  let hIdx = 0;
  const DIRS = ['about', 'projects', 'papers', 'resume'];

  // --------------------------------------------------------------- helpers
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function safeUrl(u) {
    u = String(u ?? '').trim();
    if (/^(https?:|mailto:)/i.test(u)) return u;
    if (/^[\w][\w./#?=&%-]*$/.test(u)) return u;          // relative path like assets/resume.pdf
    return '#';
  }
  const link = (url, label) => `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener">${esc(label)}</a>`;
  const cmd = (c, label, cls = '') => `<button type="button" class="cmdlink ${cls}" data-cmd="${esc(c)}">${esc(label ?? c)}</button>`;
  const err = (m) => `<span class="err">${esc(m)}</span>`;
  const linksRow = (links = []) => (links.length ? `<div class="links">${links.map((l) => link(l.url, `[${l.label}]`)).join('')}</div>` : '');
  const ps1 = () => `${userEl.textContent}:${cwd === '~' ? '~' : '~/' + cwd}$`;
  const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');

  // ------------------------------------------------------------ filesystem
  // sections listed in site.json "under_construction" show a sign instead of their files
  const building = (d) => (site.under_construction || []).includes(d);

  function tree() {
    return {
      about: { 'readme.txt': { kind: 'about' }, 'contact.txt': { kind: 'contact' } },
      projects: building('projects') ? {} : Object.fromEntries(projects.map((p) => [`${p.slug}.md`, { kind: 'project', item: p }])),
      papers: building('papers') ? {} : Object.fromEntries(papers.map((p) => [`${p.slug}.txt`, { kind: 'paper', item: p }])),
      resume: building('resume') ? {} : { 'resume.pdf': { kind: 'resume' } },
    };
  }

  function normalize(path) {
    const abs = path.startsWith('~') || path.startsWith('/');
    const parts = abs || cwd === '~' ? [] : [cwd];
    for (const seg of path.replace(/^~\/?|^\/+/, '').split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    return parts;
  }

  // -> {type:'dir', name} | {type:'file', dir, name, node} | null
  function resolve(path = '.') {
    const parts = normalize(path);
    if (!parts.length) return { type: 'dir', name: '~' };
    const T = tree();
    const [d, f, ...rest] = parts;
    if (!T[d] || rest.length) return null;
    if (!f) return { type: 'dir', name: d };
    const key = [f, `${f}.md`, `${f}.txt`, `${f}.pdf`].find((k) => T[d][k]);
    return key ? { type: 'file', dir: d, name: key, node: T[d][key] } : null;
  }

  // fall back to searching every dir, so `cat raft-kv` works from anywhere
  function find(name) {
    const r = resolve(name) || resolve(`~/${name}`);
    if (r) return r;
    for (const d of DIRS) {
      const hit = resolve(`~/${d}/${name}`);
      if (hit && hit.type === 'file') return hit;
    }
    return null;
  }

  // ------------------------------------------------------------- renderers
  function aboutTable() {
    const edu = (site.education || []).map((e) =>
      esc(e.school) + (e.program ? `, ${esc(e.program)}` : '') + ` <span class="muted">(${esc(e.years)})</span>`).join('<br>');
    const major = (site.education || []).filter((e) => e.major).map((e) =>
      (e.degree ? esc(e.degree) + ' ' : '') + esc(e.major) + (e.minor ? ` <span class="muted">· minor ${esc(e.minor)}</span>` : '')).join('<br>');
    return `<dl class="kv">
      <dt>name</dt><dd class="acc2">${esc(site.name)}</dd>
      <dt>education</dt><dd>${edu || '—'}</dd>
      <dt>major</dt><dd>${major || '—'}</dd>
      <dt>email</dt><dd>${site.email ? link('mailto:' + site.email, site.email) : '—'}</dd>
      ${site.location ? `<dt>location</dt><dd>${esc(site.location)}</dd>` : ''}
      ${(site.links || []).length ? `<dt>links</dt><dd class="links">${site.links.map((l) => link(l.url, l.label)).join('')}</dd>` : ''}
    </dl>`;
  }

  function lsRow(names) {
    return `<div class="ls">${names.join('')}</div>`;
  }

  function renderHome() {
    return `<div class="h1">${esc(site.name)}</div>
      <div class="muted">${esc(site.tagline || '')}</div>
      ${aboutTable()}
      <div class="rule">${'─'.repeat(120)}</div>
      ${lsRow(DIRS.map((d) => cmd(`cd ${d}`, d + '/', 'dir')))}
      <div class="dim" style="margin-top:6px">type <span class="acc">help</span>, click a directory, or press tab to autocomplete.</div>`;
  }

  function renderAbout() {
    const bio = (site.bio || []).map((p) => `<p>${esc(p)}</p>`).join('');
    const interests = (site.interests || []).length
      ? `<div class="tags">interests: ${site.interests.map((i) => `[${esc(i)}]`).join(' ')}</div>` : '';
    return `<div class="h2"># about</div>${aboutTable()}${bio}${interests}`;
  }

  function projectItem(p, full) {
    const tags = (p.tags || []).map((t) => `[${esc(t)}]`).join(' ');
    const details = full && (p.details || []).length ? `<ul>${p.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '';
    return `<div class="item">
      <div>${full ? `<span class="acc2">${esc(p.title)}</span>` : cmd(`cat projects/${p.slug}`, p.title)} <span class="muted">${esc(p.year || '')}</span></div>
      <p>${esc(p.summary || '')}</p>${details}
      ${tags ? `<div class="tags">${tags}</div>` : ''}${linksRow(p.links)}
    </div>`;
  }

  // "Title of paper"  [pdf]   (pdf lives in the repo, e.g. assets/papers/x.pdf)
  function paperItem(p, full) {
    const pdf = p.pdf ? link(p.pdf, '[pdf]') : '<span class="muted">[no pdf]</span>';
    return `<div class="paper">
      <span class="acc2">"${esc(p.title)}"</span> ${pdf}
      ${full && p.abstract ? `<p>${esc(p.abstract)}</p>` : ''}
    </div>`;
  }

  function renderResume() {
    const url = site.resume || 'assets/resume.pdf';
    if (!resumeOk) return `<div class="h2"># resume</div>${err('resume.pdf not found')} <span class="muted">— drop your PDF at ${esc(url)}</span>`;
    return `<div class="h2"># resume</div>
      <div class="ls">${link(url, '[view resume.pdf]')}<a href="${esc(safeUrl(url))}" download>[download]</a></div>
      <div class="dim" style="margin-top:6px">or type <span class="acc">open resume.pdf</span></div>`;
  }

  const BARRIER = String.raw`
 _____________________________________
|/////////////////////////////////////|
|                                     |
|         UNDER  CONSTRUCTION         |
|                                     |
|/////////////////////////////////////|
'-------------------------------------'
    ||          /\               ||
    ||         /!!\              ||
  __||__      /____\           __||__`.slice(1);

  function renderConstruction(name) {
    const sign = name === 'resume' && site.email
      ? `<div class="sign">resume available on request<br>inquiries: ${link('mailto:' + site.email, site.email)}</div>` : '';
    return `<div class="h2"># ${esc(name)}</div>
      <pre class="uc" aria-label="Under construction">${esc(BARRIER)}</pre>
      ${sign || `<div class="muted">${name === 'papers' ? 'pardon the dust, curating my favorite thought projects.' : 'pardon the dust. check back soon.'}</div>`}`;
  }

  function renderDir(name) {
    if (building(name)) return renderConstruction(name);
    switch (name) {
      case '~': return renderHome();
      case 'about': return renderAbout();
      case 'projects':
        return `<div class="h2"># projects <span class="muted">(${projects.length})</span></div>` +
          (projects.length ? projects.map((p) => projectItem(p, false)).join('') : '<div class="muted">nothing here yet.</div>');
      case 'papers':
        return `<div class="h2"># papers <span class="muted">(${papers.length})</span></div>` +
          (papers.length ? papers.map((p) => paperItem(p, false)).join('') : '<div class="muted">nothing here yet.</div>');
      case 'resume': return renderResume();
    }
    return '';
  }

  function renderFile(r) {
    const n = r.node;
    switch (n.kind) {
      case 'about': return renderAbout();
      case 'contact':
        return `email: ${site.email ? link('mailto:' + site.email, site.email) : '—'}${linksRow(site.links)}`;
      case 'project': return projectItem(n.item, true);
      case 'paper': return paperItem(n.item, true);
      case 'resume': return `<span class="muted">resume.pdf: binary file. try</span> ${cmd('open resume.pdf')}`;
    }
    return '';
  }

  // -------------------------------------------------------------- commands
  const COMMANDS = {
    help: { desc: 'show this list', run: () =>
      `<div class="help">${Object.entries(COMMANDS).filter(([, c]) => c.desc)
        .map(([k, c]) => `<span>${cmd(c.usage ? k : k, c.usage || k)}</span><span class="muted">${esc(c.desc)}</span>`).join('')}</div>
       <div class="dim" style="margin-top:6px">↑/↓ history · tab completes · ctrl+L clears</div>` },
    ls: { usage: 'ls [-l] [dir]', desc: 'list directory contents', run(args) {
      const long = args.includes('-l') || args.includes('-la');
      const target = args.find((a) => !a.startsWith('-')) || '.';
      const r = resolve(target);
      if (!r) return err(`ls: ${target}: No such file or directory`);
      if (r.type === 'file') return esc(r.name);
      if (building(r.name)) return '<span class="muted">(under construction)</span>';
      const T = tree();
      const entries = r.name === '~'
        ? DIRS.map((d) => ({ name: d + '/', c: `cd ${d}`, dir: true }))
        : Object.keys(T[r.name]).map((f) => ({ name: f, c: f.endsWith('.pdf') ? 'open resume.pdf' : `cat ${r.name}/${f}` }));
      if (!entries.length) return '<span class="muted">(empty)</span>';
      if (!long) return lsRow(entries.map((e) => cmd(e.c, e.name, e.dir ? 'dir' : '')));
      return `<div class="pre">${entries.map((e) =>
        `<span class="muted">${e.dir ? 'drwxr-xr-x' : '-rw-r--r--'}  guest  staff</span>  ${cmd(e.c, e.name, e.dir ? 'dir' : '')}`).join('\n')}</div>`;
    } },
    cd: { usage: 'cd <dir>', desc: 'change directory (about, projects, papers, resume)', run([target = '~']) {
      const r = resolve(target) || resolve(`~/${target}`);
      if (!r) return err(`cd: no such file or directory: ${target}`);
      if (r.type !== 'dir') return err(`cd: not a directory: ${target}`) + ` <span class="muted">(try</span> ${cmd('cat ' + target)}<span class="muted">)</span>`;
      setCwd(r.name);
      return renderDir(r.name);
    } },
    cat: { usage: 'cat <file>', desc: 'print a file, e.g. cat projects/<name>', run(args) {
      if (!args.length) return err('cat: missing file operand');
      return args.map((a) => {
        const r = find(a);
        if (!r) return err(`cat: ${a}: No such file or directory`);
        if (r.type === 'dir') return err(`cat: ${a}: Is a directory`);
        return renderFile(r);
      }).join('');
    } },
    open: { usage: 'open <file>', desc: 'open a link: project, paper, or resume.pdf', run([a]) {
      if (!a) return err('open: missing operand');
      const r = find(a);
      let url = null;
      if (r?.type === 'file') {
        if (r.node.kind === 'resume') url = site.resume || 'assets/resume.pdf';
        else if (r.node.kind === 'paper') url = r.node.item.pdf;
        else if (r.node.item) url = r.node.item.links?.[0]?.url;
        else if (r.node.kind === 'contact') url = site.email && 'mailto:' + site.email;
      } else if (/^https?:\/\//.test(a)) url = a;
      if (!url) return err(`open: nothing to open for ${a}`);
      window.open(safeUrl(url), '_blank', 'noopener');
      return `<span class="muted">opening</span> ${link(url, url)}`;
    } },
    pwd: { desc: 'print working directory', run: () => esc(cwd === '~' ? '/home/guest' : `/home/guest/${cwd}`) },
    whoami: { desc: 'who is this', run: () => `${esc(site.name)} <span class="muted">— ${esc(site.tagline || '')}</span>` },
    email: { desc: 'say hi', run: () => (site.email ? `${link('mailto:' + site.email, site.email)}` : err('no email set')) },
    clear: { desc: 'clear the screen', run: () => CLEAR },
    history: { desc: 'command history', run: () => `<div class="pre">${hist.map((h, i) => `${String(i + 1).padStart(4)}  ${esc(h)}`).join('\n')}</div>` },
    echo: { run: (args) => esc(args.join(' ')) },
    date: { run: () => esc(new Date().toString()) },

    rain: { usage: 'rain [λ|auto|off]', desc: 'drops/sec — new drops per frame ~ Poisson(λ·dt)', run([v]) {
      if (!window.Scene) return err('scene not loaded');
      if (v === undefined) return `rain ~ Poisson(λ = ${Scene.rate}/s)${Scene.auto ? ' <span class="muted">(auto: scales with screen width)</span>' : ''}`;
      if (v === 'off') Scene.setRain(0);
      else if (v === 'auto') Scene.setRain('auto');
      else if (Number.isFinite(+v) && +v >= 0) Scene.setRain(+v);
      else return err('usage: rain [λ|auto|off]');
      return `rain ~ Poisson(λ = ${Scene.rate}/s)`;
    } },
    wind: { usage: 'wind [-1.5..1.5]', desc: 'blow the rain sideways', run([v]) {
      if (v !== undefined) { if (!Number.isFinite(+v)) return err('usage: wind <number>'); Scene.setWind(+v); }
      return `wind = ${Scene.wind}`;
    } },
    comets: { usage: 'comets [μ|off]', desc: 'arrivals/sec — Poisson process, gaps ~ Exp(μ)', run([v]) {
      if (v === 'off') Scene.setMu(0);
      else if (v !== undefined) { if (!(+v >= 0)) return err('usage: comets [μ|off]'); Scene.setMu(+v); }
      return `comets ~ PoissonProcess(μ = ${fmt(Scene.mu, 3)}/s) <span class="muted">· mean gap ${Scene.mu ? fmt(1 / Scene.mu, 1) + 's' : '∞'}</span>`;
    } },
    comet: { desc: 'summon one comet now', run: () => { Scene.comet(); return '<span class="muted">☄  look up.</span>'; } },
    bites: { usage: 'bites [ν|off] [p]', desc: 'bites/sec — Poisson process; each is a fish w.p. p, else a boot', run([v, p]) {
      if (v === 'off') Scene.setNu(0);
      else if (v !== undefined) { if (!(+v >= 0)) return err('usage: bites [ν|off] [p]'); Scene.setNu(+v); }
      if (p !== undefined) { if (!(+p >= 0 && +p <= 1)) return err('p must be between 0 and 1'); Scene.setPFish(+p); }
      const nu = Scene.nu, q = Scene.pFish;
      return `bites ~ PP(ν = ${fmt(nu, 3)}/s) <span class="muted">· mean gap ${nu ? fmt(1 / nu, 0) + 's' : '∞'}</span>
        <div class="muted">thinned: fish ~ PP(νp = ${fmt(nu * q, 3)}), boots ~ PP(ν(1−p) = ${fmt(nu * (1 - q), 3)}) with p = ${fmt(q)}</div>`;
    } },
    bite: { desc: 'make something bite right now', run: () => (Scene.bite() ? '<span class="muted">the bobber dips…</span>' : '<span class="muted">the line is busy.</span>') },
    moon: { desc: 'the real moon over Durham, NC right now', run: () => {
      const m = Scene.moon();
      const at = (d) => d ? d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
      const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(m.azimuth / 45) % 8];
      return `<div class="pre"><span class="h2">${esc(m.name)}</span> · ${fmt(m.illumination * 100, 0)}% lit <span class="muted">(phase ${fmt(m.phase, 3)})</span>
${m.up ? `up over ${esc(m.place)}: ${fmt(m.altitude, 1)}° high, toward ${compass} (${fmt(m.azimuth, 0)}°) <span class="muted">· sets ${esc(at(m.sets))}</span>`
       : `below the horizon in ${esc(m.place)} <span class="muted">· rises ${esc(at(m.rises))}</span>`}</div>`;
    } },
    stats: { desc: 'check the simulation against theory', run: () => {
      const s = Scene.stats();
      return `<div class="pre"><span class="h2">rain</span>   model: N(1s) ~ Poisson(λ=${s.lambda})
         observed over ${s.seconds}s: mean ${fmt(s.perSecMean)}  var ${fmt(s.perSecVar)}  var/mean ${fmt(s.perSecVar / s.perSecMean)} <span class="muted">(≈1 for Poisson)</span>
         total drops ${s.rainTotal} · on screen ${s.onScreen.drops}
<span class="h2">comets</span> model: gaps ~ Exp(μ=${fmt(s.mu, 3)}) → E[gap] = ${s.mu ? fmt(1 / s.mu, 1) : '∞'}s
         observed: ${s.comets} arrivals · mean gap ${fmt(s.gapMean, 1)}s · next in ${fmt(s.nextIn, 1)}s <span class="muted">(shh)</span>
<span class="h2">bites</span>  model: PP(ν=${fmt(s.nu, 3)}), fish w.p. p=${fmt(s.pFish)}
         observed: ${s.fish} fish · ${s.boots} boots · fish share ${fmt(s.fish / (s.fish + s.boots))} <span class="muted">(≈p)</span> · ${s.missed} missed while busy · next in ${fmt(s.nextBiteIn, 1)}s
<span class="muted">sim time ${fmt(s.simT, 0)}s${Scene.paused ? ' · paused / reduced motion' : ''}</span></div>`;
    } },
    pause: { desc: 'freeze the scene', run: () => { Scene.pause(); return 'scene paused. <span class="muted">resume with</span> ' + cmd('play'); } },
    play: { run: () => { Scene.resume(); return 'scene running.'; } },
    theme: { usage: 'theme [green|amber|ice]', desc: 'change colors', run([v]) {
      const themes = ['green', 'amber', 'ice'];
      if (!v) return `themes: ${themes.map((t) => cmd('theme ' + t, t)).join(' ')}`;
      if (!themes.includes(v)) return err(`theme: unknown theme ${v}`);
      setTheme(v);
      return `theme → ${esc(v)}`;
    } },
    hide: { desc: 'minimize the terminal (esc, the yellow dot, or double-click the title bar also work)', run: () => { setWin('hide'); return ''; } },
    exit: { run: () => { setWin('hide'); return ''; } },
    show: { run: () => { setWin('show'); return ''; } },
    center: { desc: 'move the window back to the middle', run: () => { recenter(); return ''; } },
    sudo: { run: () => err('guest is not in the sudoers file. This incident will be reported to the farmer.') },
    vim: { run: () => '<span class="muted">you are now trapped. just kidding — try</span> ' + cmd('help') },
  };
  COMMANDS.dir = { run: COMMANDS.ls.run };
  COMMANDS.man = { run: COMMANDS.help.run };
  const CLEAR = Symbol('clear');

  function parse(line) {
    return (line.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((t) => t.replace(/^(["'])(.*)\1$/, '$2'));
  }

  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  function run(line) {
    const [name, ...args] = parse(line);
    if (!name) return '';
    const key = name.toLowerCase();
    if (COMMANDS[key]) return COMMANDS[key].run(args);
    if (DIRS.includes(key.replace(/\/$/, '')) || key === '~' || key === '..') return COMMANDS.cd.run([key]);   // bare `projects` works
    const guess = Object.keys(COMMANDS).map((k) => [k, lev(key, k)]).sort((a, b) => a[1] - b[1])[0];
    return err(`zsh: command not found: ${name}`) + (guess && guess[1] <= 2 ? ` <span class="muted">did you mean</span> ${cmd(guess[0])}<span class="muted">?</span>` : '');
  }

  function exec(raw, { record = true, clear = true } = {}) {
    const line = raw.trim();
    if (record && line && hist[hist.length - 1] !== line) hist.push(line);
    hIdx = hist.length;

    const block = document.createElement('div');
    block.className = 'block';
    block.innerHTML = `<div class="echo"><span class="ps1">${esc(ps1())}</span>${esc(raw)}</div>`;
    // running anything other than hide/exit brings a minimized window back
    if (!/^(hide|exit)\b/i.test(line) && line) term.classList.remove('min');
    let html;
    try { html = run(line); } catch (e) { html = err(String(e.message || e)); }
    if (html === CLEAR) { out.innerHTML = ''; return; }
    if (clear) out.innerHTML = '';          // one command on screen at a time
    out.appendChild(block);
    if (html) {
      const res = document.createElement('div');
      res.className = 'res';
      res.innerHTML = html;
      block.appendChild(res);
    }
    out.scrollTop = clear ? 0 : block.offsetTop - 8;
  }

  // ---------------------------------------------------------------- state
  function setCwd(name) {
    cwd = name;
    cwdEl.textContent = name === '~' ? '~' : `~/${name}`;
    document.querySelectorAll('.nav [data-cmd]').forEach((b) => b.classList.toggle('active', b.dataset.cmd === `cd ${name}`));
    const hash = name === '~' ? '' : `#${name}`;
    if (location.hash !== hash) window.history.replaceState(null, '', hash || location.pathname + location.search);
  }

  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch { /* storage unavailable */ }
  }
  function setWin(mode) {
    if (mode === 'min') term.classList.toggle('min');
    if (mode === 'hide') term.classList.add('min');
    if (mode === 'show') term.classList.remove('min');
    if (mode === 'max') {
      if (term.classList.contains('min')) term.classList.remove('min');   // green restores a minimized window
      else { term.classList.toggle('max'); if (term.classList.contains('max')) recenter(); }
    }
    if (!term.classList.contains('min')) { clampToViewport(); input.focus({ preventScroll: true }); }
  }

  // ---- drag the window by its title bar
  const bar = term.querySelector('.titlebar');
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function place(x, y) {
    const r = term.getBoundingClientRect();
    term.style.left = clamp(x, 80 - r.width, innerWidth - 80) + 'px';   // keep >=80px grabbable
    term.style.top = clamp(y, 0, innerHeight - 40) + 'px';
    term.style.transform = 'none';
    term.classList.add('moved');
  }
  function clampToViewport() {
    if (!term.classList.contains('moved')) return;
    const r = term.getBoundingClientRect();
    place(r.left, r.top);
  }
  function recenter() {
    term.style.left = term.style.top = term.style.transform = '';
    term.classList.remove('moved');
  }
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    const r = term.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    term.classList.remove('max');
    place(r.left, r.top);
    term.classList.add('dragging');
    bar.setPointerCapture(e.pointerId);
    const move = (ev) => place(ev.clientX - ox, ev.clientY - oy);
    const up = () => {
      term.classList.remove('dragging');
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });
  bar.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) setWin('min'); });
  window.addEventListener('resize', clampToViewport);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.target.closest?.('#journal')) { e.preventDefault(); setWin('min'); }
  });

  // ------------------------------------------------------------ completion
  function complete() {
    const val = input.value;
    const parts = val.split(/\s+/);
    const word = parts[parts.length - 1];
    let options;
    if (parts.length === 1) {
      options = [...Object.keys(COMMANDS), ...DIRS].filter((c) => c.startsWith(word));
    } else {
      const slash = word.lastIndexOf('/');
      const base = slash >= 0 ? word.slice(0, slash + 1) : '';
      const stem = word.slice(slash + 1);
      const dir = resolve(base || '.');
      if (!dir || dir.type !== 'dir') return;
      const names = dir.name === '~' ? DIRS.map((d) => d + '/') : Object.keys(tree()[dir.name]);
      options = names.filter((n) => n.startsWith(stem)).map((n) => base + n);
    }
    options = [...new Set(options)];
    if (!options.length) return;
    if (options.length === 1) {
      parts[parts.length - 1] = options[0];
      input.value = parts.join(' ') + (options[0].endsWith('/') ? '' : ' ');
      return;
    }
    // extend to the common prefix, then show choices
    let pre = options[0];
    for (const o of options) while (!o.startsWith(pre)) pre = pre.slice(0, -1);
    if (pre.length > word.length) { parts[parts.length - 1] = pre; input.value = parts.join(' '); return; }
    const block = document.createElement('div');
    block.className = 'block';
    block.innerHTML = `<div class="echo"><span class="ps1">${esc(ps1())}</span>${esc(val)}</div><div class="res">${lsRow(options.map((o) => `<span class="muted">${esc(o)}</span>`))}</div>`;
    out.appendChild(block);
    out.scrollTop = out.scrollHeight;
  }

  // ---------------------------------------------------------------- events
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value;
    input.value = '';
    exec(v);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); complete(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (hIdx > 0) input.value = hist[--hIdx]; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); hIdx = Math.min(hist.length, hIdx + 1); input.value = hist[hIdx] ?? ''; }
    else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); out.innerHTML = ''; }
    else if (e.key === 'c' && e.ctrlKey && !window.getSelection().toString()) {
      e.preventDefault(); exec(input.value + '^C', { record: false, clear: false }); input.value = '';
    }
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b) {
      if (term.classList.contains('min') && b.closest('#term')) term.classList.remove('min');
      exec(b.dataset.cmd);
      input.focus({ preventScroll: true });
      return;
    }
    const w = e.target.closest('[data-win]');
    if (w) { setWin(w.dataset.win); return; }
    if (e.target.closest('#term') && !e.target.closest('a') && !window.getSelection().toString()) input.focus({ preventScroll: true });
  });
  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (DIRS.includes(h) && h !== cwd) exec(`cd ${h}`);
  });

  // live HUD
  setInterval(() => {
    if (!window.Scene) return;
    hud.textContent = `rain ~ Poisson(λ=${Scene.rate}/s) · comets ~ PP(μ=${fmt(Scene.mu, 3)}/s) · bites ~ PP(ν=${fmt(Scene.nu, 3)}/s)`;
  }, 500);

  // ------------------------------------------------------------------ boot
  async function load(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    try { return await r.json(); } catch (e) { throw new Error(`${url}: invalid JSON (${e.message})`); }
  }

  async function boot() {
    try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* ignore */ }
    try {
      [site, projects, papers] = await Promise.all(['content/site.json', 'content/projects.json', 'content/papers.json'].map(load));
    } catch (e) {
      out.innerHTML = `<div class="block">${err('failed to load content: ' + e.message)}<div class="muted">If you opened index.html directly from disk, run a local server instead: <span class="acc">python3 -m http.server</span></div></div>`;
      return;
    }
    projects = Array.isArray(projects) ? projects : [];
    papers = Array.isArray(papers) ? papers : [];
    userEl.textContent = `guest@${site.handle || 'home'}`;
    document.title = `${site.name || 'home'} — ~`;

    fetch(site.resume || 'assets/resume.pdf', { method: 'HEAD' }).then((r) => { resumeOk = r.ok; }).catch(() => {});

    out.innerHTML = `<div class="block dim">Last login: ${esc(new Date().toDateString())} on ttys000</div>`;
    const h = location.hash.slice(1);
    exec(DIRS.includes(h) ? `cd ${h}` : 'cd ~', { record: false, clear: false });
    if (!matchMedia('(pointer: coarse)').matches) input.focus({ preventScroll: true });
  }

  boot();
})();
