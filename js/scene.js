/*
 * ASCII night scene: a farmer fishing off a dock by a lake.
 *
 *  - Rain:   in each frame of length dt, the number of new drops is
 *            N ~ Poisson(lambda * dt). Sums of independent Poissons are
 *            Poisson, so counts per second are Poisson(lambda) exactly.
 *  - Comets: a homogeneous Poisson process with rate mu. Inter-arrival
 *            times are drawn as T ~ Exponential(mu) = -ln(U) / mu.
 *
 * Exposes window.Scene for the terminal (rain/comet/stats commands).
 */
(() => {
  'use strict';

  const pre = document.getElementById('scene');
  if (!pre) return;

  // ---------------------------------------------------------------- random
  const rand = Math.random;
  function gauss() {
    let u = 0, v = 0;
    while (!u) u = rand();
    while (!v) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  // Knuth's multiplication method; normal approximation for large lambda.
  function poisson(lambda) {
    if (!(lambda > 0)) return 0;
    if (lambda > 40) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gauss()));
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= rand(); } while (p > L);
    return k - 1;
  }
  const exponential = (rate) => -Math.log(1 - rand()) / rate;

  // ------------------------------------------------------------------- art
  // '@' marks the rod tip, '#' is an opaque blank (blocks rain, draws ' ').
  const FARMER = String.raw`
                                   @
                                 ,'
            _____              ,'
        ___/_____\___        ,'
           |#-#-#|         ,'
           \#####/       ,'
         ___\###/___   ,'
        /###|###|###\,'
       /#/##|###|##=o
       \_\##|___|###|
          \_|###|___/
  ==========|###|==========
  ||   ||   |#|#|     ||
  ||   ||   |#|#|     ||
  ||   ||   (_|_)     ||
`.split('\n').slice(1, -1);

  const MOON = String.raw`
    _..._
  .:::::::.
 :::::::::::
 :::::::::::
 '::::::::'
   '':::''
`.split('\n').slice(1, -1);

  // color codes -> CSS classes (see style.css)
  const C = { NONE: 0, STAR: 1, MOON: 2, MTN: 3, WATER: 4, GLOW: 5, RAIN: 6, RAINFAR: 7,
              SPLASH: 8, HEAD: 9, TAIL: 10, FARMER: 11, DOCK: 12, LINE: 13, BOB: 14, EMBER: 15 };
  const CLS = ['', 's', 'm', 'k', 'w', 'g', 'r', 'q', 'x', 'h', 't', 'f', 'd', 'l', 'b', 'e'];

  // ----------------------------------------------------------------- state
  let cols = 0, rows = 0, horizon = 0;
  let chars = [], colors = new Uint8Array(0), mask = new Uint8Array(0);
  let stars = [], ridge = [], moon = { x: 0, y: 0 };
  let farmerCells = [], tip = { x: 0, y: 0 }, bob = { x: 0, y: 0 };
  let cellW = 8, cellH = 16;

  // the fallen star: lies on the dock until dragged into the farmer's hands.
  // states: ground -> drag -> ritual -> held (lantern on the rod tip) -> falling -> ground
  // where the star rests: a fraction of the viewport if the visitor moved it, else the dock.
  // While resting it's a DOM element (see #ember); the grid only draws it in flight.
  let groundFrac = null, dockSpot = { x: 0, y: 0 };
  let ground = { x: 0, y: 0 }, hand = { x: 0, y: 0 }, farmerBox = { x0: 0, x1: 0, y0: 0, y1: 0 };
  const star = { state: 'ground', t0: 0 };
  const RITUAL = 2.6, FALL = 1.1;
  const clock = () => performance.now() / 1000;

  let drops = [], splashes = [], comets = [];
  let simT = 0, nextComet = 0;

  const cfg = { rate: 'auto', wind: 0, mu: 1 / 14, paused: false };
  const stats = { rainTotal: 0, bucket: 0, bucketStart: 0, buckets: [], arrivals: [] };

  const rainRate = () => (cfg.rate === 'auto' ? Math.round(cols * 0.35) : cfg.rate);

  // ---------------------------------------------------------------- layout
  function layout() {
    const probe = document.createElement('span');
    probe.textContent = 'M'.repeat(100);
    pre.textContent = '';
    pre.appendChild(probe);
    const cw = probe.getBoundingClientRect().width / 100 || 8;
    pre.removeChild(probe);
    const ch = parseFloat(getComputedStyle(pre).lineHeight) || cw * 2;
    cellW = cw; cellH = ch;

    cols = Math.ceil(pre.clientWidth / cw) + 1;
    rows = Math.ceil(pre.clientHeight / ch) + 1;
    horizon = Math.round(rows * 0.6);

    const N = cols * rows;
    chars = new Array(N).fill(' ');
    colors = new Uint8Array(N);
    mask = new Uint8Array(N);

    // stars
    stars = [];
    const glyphs = ['.', '.', '.', "'", '*', '+'];
    const nStars = Math.round(cols * horizon * 0.012);
    for (let i = 0; i < nStars; i++) {
      stars.push({ x: (rand() * cols) | 0, y: (rand() * (horizon - 2)) | 0,
                   ph: rand() * 6.283, sp: 0.4 + rand() * 1.8, c: glyphs[(rand() * glyphs.length) | 0] });
    }

    // mountain ridge heights (in rows)
    const s1 = rand() * 10, s2 = rand() * 10, s3 = rand() * 10, amp = Math.min(1.2, rows / 45);
    ridge = new Array(cols);
    for (let x = 0; x < cols; x++) {
      const h = 2.4 + 1.8 * Math.sin(x * 0.035 + s1) + 1.3 * Math.sin(x * 0.09 + s2) + 0.6 * Math.sin(x * 0.21 + s3);
      ridge[x] = Math.max(0, Math.round(h * amp));
    }

    moon.x = cols < 70 ? cols - 14 : Math.min(cols - 16, Math.round(cols * 0.86));
    moon.y = Math.max(1, Math.round(horizon * 0.14));

    // farmer + dock
    farmerCells = [];
    const fx = cols < 90 ? 1 : Math.round(cols * 0.06);
    const fy = Math.max(horizon - 6, rows - FARMER.length - 1);
    const dockIdx = FARMER.findIndex((l) => l.includes('===='));
    let legMin = Infinity, legMax = -Infinity;
    FARMER.forEach((line, r) => {
      if (r <= dockIdx) return;
      [...line].forEach((c, i) => { if ('#()_'.includes(c)) { legMin = Math.min(legMin, i); legMax = Math.max(legMax, i); } });
    });
    FARMER.forEach((line, r) => {
      [...line].forEach((c, i) => {
        if (c === ' ') return;
        const x = fx + i, y = fy + r;
        if (c === '@') { tip.x = x; tip.y = y; c = ','; }
        const isRod = r < dockIdx && (c === ',' || c === "'") && i > 20;
        const isDock = r >= dockIdx && (i < legMin || i > legMax);
        farmerCells.push({ x, y, c: c === '#' ? ' ' : c, col: isRod ? C.LINE : isDock ? C.DOCK : C.FARMER, solid: !isRod });
      });
    });
    // extend dock planks and posts off the left edge
    const dockY = fy + dockIdx;
    for (let x = 0; x < fx + 2; x++) {
      farmerCells.push({ x, y: dockY, c: '=', col: C.DOCK, solid: true });
      if (x % 8 === 3 || x % 8 === 4) {
        for (let y = dockY + 1; y < rows; y++) farmerCells.push({ x, y, c: '|', col: C.DOCK, solid: true });
      }
    }
    for (const fc of farmerCells) if (inGrid(fc.x, fc.y) && fc.solid) mask[fc.y * cols + fc.x] = 1;

    bob.x = tip.x;
    bob.y = Math.min(rows - 2, dockY + 2);

    const handRow = FARMER.findIndex((l) => l.includes('=o'));
    hand = { x: fx + FARMER[handRow].indexOf('=o') + 1, y: fy + handRow };
    dockSpot = { x: fx + 24, y: dockY - 1 };                    // on the planks, right of the farmer
    ground = groundFrac ? fracCell(groundFrac) : dockSpot;
    farmerBox = { x0: fx + 6, x1: fx + 21, y0: fy + 2, y1: dockY - 1 };
    window.dispatchEvent(new Event('scene:layout'));

    // keep particles across re-layouts; drop any now off-grid
    drops = drops.filter((d) => d.x < cols && d.ty < rows);
    splashes = splashes.filter((sp) => sp.x < cols && sp.y < rows);
  }

  const fracCell = (f) => ({ x: Math.floor((f.x * pre.clientWidth) / cellW), y: Math.floor((f.y * pre.clientHeight) / cellH) });
  const inGrid = (x, y) => x >= 0 && x < cols && y >= 0 && y < rows;
  function put(x, y, c, col) {
    x = Math.round(x); y = Math.round(y);
    if (!inGrid(x, y)) return;
    const i = y * cols + x;
    chars[i] = c; colors[i] = col;
  }

  // ------------------------------------------------------------- simulation
  function spawnComet() {
    const dir = rand() < 0.5 ? -1 : 1;
    const speed = cols * (0.22 + rand() * 0.25);       // columns / second
    const slope = 0.12 + rand() * 0.3;                  // rows per column
    comets.push({
      x: dir < 0 ? cols * (0.45 + rand() * 0.65) : cols * (-0.1 + rand() * 0.6),
      y: rand() * horizon * 0.35,
      vx: dir * speed, vy: speed * slope,
      len: 8 + ((rand() * 14) | 0),
    });
    stats.arrivals.push(simT);
    if (stats.arrivals.length > 200) stats.arrivals.shift();
  }

  function update(dt) {
    simT += dt;

    // --- rain: N ~ Poisson(lambda * dt)
    const n = poisson(rainRate() * dt);
    stats.rainTotal += n;
    stats.bucket += n;
    while (simT - stats.bucketStart >= 1) {
      stats.buckets.push(stats.bucket);
      if (stats.buckets.length > 120) stats.buckets.shift();
      stats.bucket = 0;
      stats.bucketStart += 1;
    }
    const lake = rows - horizon;
    for (let i = 0; i < n; i++) {
      const depth = rand();                              // 0 = far, 1 = near
      drops.push({
        x: rand() * (cols + 20) - 10 - cfg.wind * 10,
        y: -rand() * 3,
        vy: rows * (0.55 + 0.6 * depth),
        ty: horizon + Math.floor(depth * lake),
        depth,
      });
    }
    for (const d of drops) {
      const prevY = d.y;
      d.y += d.vy * dt;
      d.x += cfg.wind * d.vy * 0.5 * dt;
      const x = Math.round(d.x);
      for (let y = Math.floor(prevY) + 1; y <= Math.floor(d.y); y++) {
        if (y >= d.ty) { splashes.push({ x, y: d.ty, age: 0, kind: d.depth > 0.45 ? 'ring' : 'dot' }); d.dead = true; break; }
        if (x >= 0 && x < cols && y >= 0 && y < rows && mask[y * cols + x]) {
          splashes.push({ x, y: y - 1, age: 0, kind: 'hit' }); d.dead = true; break;
        }
      }
    }
    drops = drops.filter((d) => !d.dead);
    for (const s of splashes) s.age += dt;
    splashes = splashes.filter((s) => s.age < (s.kind === 'ring' ? 0.6 : 0.25));

    // --- comets: homogeneous Poisson process, Exp(mu) gaps
    if (cfg.mu > 0) {
      while (simT >= nextComet) { spawnComet(); nextComet += exponential(cfg.mu); }
    }
    for (const c of comets) { c.x += c.vx * dt; c.y += c.vy * dt; }
    comets = comets.filter((c) => c.x > -c.len - 2 && c.x < cols + c.len + 2 && c.y < horizon + 2);
  }

  // ------------------------------------------------------------------ draw
  function draw() {
    const t = simT;
    chars.fill(' ');
    colors.fill(0);

    // stars
    for (const s of stars) {
      const tw = Math.sin(t * s.sp + s.ph);
      if (tw > -0.6) put(s.x, s.y, tw > 0.85 && s.c === '.' ? '+' : s.c, C.STAR);
    }

    // comets (drawn before moon/mountains so they pass behind them)
    for (const c of comets) {
      const n = Math.hypot(c.vx, c.vy), ux = c.vx / n, uy = c.vy / n;
      const slopeCh = Math.abs(uy) < 0.25 * Math.abs(ux) ? '-' : ux * uy > 0 ? '\\' : '/';
      for (let i = c.len; i >= 1; i--) {
        const ch = i < c.len * 0.4 ? slopeCh : i < c.len * 0.75 ? (i % 2 ? slopeCh : '.') : '.';
        put(c.x - ux * i, c.y - uy * i, ch, C.TAIL);
      }
      put(c.x, c.y, '*', C.HEAD);
    }

    // moon
    MOON.forEach((line, r) => [...line].forEach((ch, i) => {
      if (ch !== ' ' || (i > 0 && i < line.length - 1)) put(moon.x + i, moon.y + r, ch, C.MOON);
    }));

    // mountains
    for (let x = 0; x < cols; x++) {
      const h = ridge[x], hl = ridge[x - 1] ?? h, hr = ridge[x + 1] ?? h;
      const top = horizon - 1 - h;
      let ch = '_';
      if (hl < h && hr < h) ch = '^';
      else if (hr > hl) ch = '/';
      else if (hr < hl) ch = '\\';
      put(x, top, ch, C.MTN);
      for (let y = top + 1; y < horizon; y++) put(x, y, (x * 7 + y * 13) % 11 === 0 ? '.' : ' ', C.MTN);
    }

    // lake
    const lake = rows - horizon, mcx = moon.x + 5;
    for (let y = horizon; y < rows; y++) {
      const d = (y - horizon) / lake;
      const thr = 1.35 - d * 0.55;
      for (let x = 0; x < cols; x++) {
        const v = Math.sin(x * 0.19 + y * 1.9 + t * 1.1)
                + 0.8 * Math.sin(x * 0.051 - y * 0.7 - t * 0.6)
                + 0.35 * Math.sin(x * 0.6 + y * 3.3 + t * 2.2);
        let ch = ' ', col = C.WATER;
        if (y === horizon) ch = v > -0.4 ? '-' : ' ';
        else if (v > thr) ch = '~';
        else if (v > thr - 0.25 && d < 0.5) ch = '-';
        else if (v < -1.75) ch = '.';
        // moonlight path
        const w = 1.5 + d * 4.5;
        if (Math.abs(x - mcx) < w && v > -0.3) { ch = v > 0.7 ? '=' : '-'; col = C.GLOW; }
        if (ch !== ' ') put(x, y, ch, col);
      }
    }

    // comet reflections
    for (const c of comets) {
      const ry = horizon + (horizon - c.y) * (lake / horizon) * 0.8;
      if (ry > horizon && ry < rows) {
        put(c.x, ry, '~', C.TAIL);
        put(c.x - Math.sign(c.vx), ry, '-', C.TAIL);
      }
    }

    // farmer, dock, rod
    for (const fc of farmerCells) put(fc.x, fc.y, fc.c, fc.col);

    // fishing line + bobber
    for (let y = tip.y + 1; y < bob.y; y++) put(tip.x, y, '|', C.LINE);
    const phase = (t * 0.7) % 1;
    put(bob.x, bob.y, phase < 0.5 ? 'o' : 'O', C.BOB);
    if (phase < 0.5) { put(bob.x - 1, bob.y, '-', C.SPLASH); put(bob.x + 1, bob.y, '-', C.SPLASH); }
    else { put(bob.x - 2, bob.y, '(', C.SPLASH); put(bob.x + 2, bob.y, ')', C.SPLASH); }

    // rain
    for (const d of drops) {
      const near = d.depth > 0.45;
      let ch = near ? '|' : "'";
      if (cfg.wind > 0.15) ch = near ? '\\' : '`';
      else if (cfg.wind < -0.15) ch = near ? '/' : ',';
      put(d.x, d.y, ch, near ? C.RAIN : C.RAINFAR);
    }

    // splashes
    for (const s of splashes) {
      if (s.kind === 'hit') { put(s.x, s.y, "'", C.SPLASH); continue; }
      if (s.kind === 'dot') { put(s.x, s.y, s.age < 0.12 ? '.' : '-', C.SPLASH); continue; }
      if (s.age < 0.1) put(s.x, s.y, '.', C.SPLASH);
      else if (s.age < 0.22) put(s.x, s.y, 'o', C.SPLASH);
      else if (s.age < 0.4) { put(s.x - 1, s.y, '(', C.SPLASH); put(s.x + 1, s.y, ')', C.SPLASH); }
      else { put(s.x - 2, s.y, '(', C.SPLASH); put(s.x + 2, s.y, ')', C.SPLASH); }
    }

    drawStar();
    render();
  }

  // only draws on empty cells, so glows never smear the farmer
  function soft(x, y, c, col) {
    x = Math.round(x); y = Math.round(y);
    if (inGrid(x, y) && chars[y * cols + x] === ' ') put(x, y, c, col);
  }
  const ease = (x) => 1 - (1 - x) ** 3;

  function drawStar() {
    const t = clock(), a = t - star.t0;
    const pulse = (k) => (Math.sin(t * k) > 0.4 ? '+' : '*');
    switch (star.state) {
      case 'ritual': drawRitual(a); break;
      case 'held':                                               // a lantern on the rod tip
        put(tip.x, tip.y, pulse(1.6), C.EMBER);
        if (Math.sin(t * 1.6) > 0) { soft(tip.x - 1, tip.y, '.', C.TAIL); soft(tip.x + 1, tip.y, '.', C.TAIL); }
        break;
      case 'falling': {
        const u = Math.min(1, a / (FALL - 0.25));
        // a lobbed arc from the rod tip to wherever the star was resting
        const at = (v) => [tip.x + (ground.x - tip.x) * v, tip.y + (ground.y - tip.y) * v - Math.sin(Math.PI * v) * 5];
        if (u < 1) {
          for (let k = 3; k >= 1; k--) { const [x, y] = at(Math.max(0, u - k * 0.05)); put(x, y, '.', C.TAIL); }
          const [x, y] = at(u);
          put(x, y, '*', C.EMBER);
        } else {
          put(ground.x, ground.y, '*', C.EMBER);
          soft(ground.x - 1, ground.y, '.', C.TAIL); soft(ground.x + 1, ground.y, '.', C.TAIL);
        }
        break;
      }
    }
  }

  function drawRitual(a) {
    const H = hand, T = tip;
    if (a < 0.6) {                                   // cradled in the hands, brightening
      put(H.x, H.y, a % 0.2 < 0.1 ? '*' : '+', C.EMBER);
      if (a > 0.2) for (const [dx, dy] of [[-2, 0], [2, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]]) soft(H.x + dx, H.y + dy, '.', C.TAIL);
    } else if (a < 1.5) {                            // climbs the rod
      const u = ease((a - 0.6) / 0.9);
      for (let k = 4; k >= 1; k--) {
        const v = Math.max(0, u - k * 0.06);
        put(H.x + (T.x - H.x) * v, H.y + (T.y - H.y) * v, k > 2 ? '.' : "'", C.TAIL);
      }
      put(H.x + (T.x - H.x) * u, H.y + (T.y - H.y) * u, '*', C.EMBER);
    } else {                                         // blooms at the tip
      const b = Math.min(1, (a - 1.5) / (RITUAL - 1.5));
      put(T.x, T.y, '*', C.EMBER);
      const R = 1 + b * 8, n = 18, ch = b < 0.35 ? '*' : b < 0.7 ? '+' : '.';
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + b * 0.5;
        put(T.x + Math.cos(ang) * R * 2, T.y + Math.sin(ang) * R, ch, b < 0.5 ? C.EMBER : C.TAIL);
        if (i % 2 === 0) put(T.x + Math.cos(ang) * R * 1.1, T.y + Math.sin(ang) * R * 0.55, '.', C.TAIL);
      }
    }
  }

  const ESC = { '<': '&lt;', '>': '&gt;', '&': '&amp;' };
  function render() {
    const out = [];
    for (let y = 0; y < rows; y++) {
      let cur = 0;
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x, col = colors[i];
        if (col !== cur) {
          if (cur) out.push('</span>');
          if (col) out.push('<span class="', CLS[col], '">');
          cur = col;
        }
        const ch = chars[i];
        out.push(ESC[ch] || ch);
      }
      if (cur) out.push('</span>');
      out.push('\n');
    }
    pre.innerHTML = out.join('');
  }

  // ------------------------------------------------------------------ loop
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const FRAME = 1 / 24;
  let raf = 0, last = 0, acc = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const t = now / 1000;
    const dt = last ? Math.min(t - last, 0.1) : 0;  // cap so hidden tabs don't fast-forward
    last = t;
    acc += dt;
    if (acc < FRAME) return;
    update(acc);
    acc = 0;
    draw();
  }
  function start() {
    cancelAnimationFrame(raf);
    last = 0;
    if (reduceMotion.matches || cfg.paused) {
      for (let i = 0; i < 48; i++) update(FRAME);      // settle a still frame
      draw();
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function relayout() {
    layout();
    if (reduceMotion.matches || cfg.paused) start();
    else draw();
  }
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(relayout, 120);
  });
  reduceMotion.addEventListener?.('change', start);

  // draw right away with fallback-font metrics, re-measure once the web font lands
  layout();
  nextComet = simT + exponential(cfg.mu || 1);
  for (let i = 0; i < 36; i++) update(FRAME);   // pre-warm so the first frame already has rain
  draw();
  start();
  document.fonts?.ready.then(relayout);

  // star animations keep drawing even when the scene is paused
  const running = () => !(reduceMotion.matches || cfg.paused);
  let kickRaf = 0, kickUntil = 0;
  function kick(sec) {
    kickUntil = Math.max(kickUntil, clock() + sec);
    if (kickRaf || running()) return;
    const step = () => { draw(); kickRaf = clock() < kickUntil ? requestAnimationFrame(step) : 0; };
    kickRaf = requestAnimationFrame(step);
  }
  function setStar(s) {
    star.state = s;
    star.t0 = clock();
    window.dispatchEvent(new CustomEvent('scene:star', { detail: s }));
    if (!running()) draw();
  }

  // ------------------------------------------------------------------- API
  window.Scene = {
    star: {
      get state() { return star.state; },
      // pixel center + cell size of the star lying on the dock
      // pixel point where the star rests
      cell: () => (groundFrac
        ? { x: groundFrac.x * pre.clientWidth, y: groundFrac.y * pre.clientHeight, w: cellW, h: cellH }
        : { x: (ground.x + 0.5) * cellW, y: (ground.y + 0.5) * cellH, w: cellW, h: cellH }),
      get frac() { return groundFrac; },
      // rest the star at a pixel point (or {x, y} fractions with setFrac); null puts it back on the dock
      place(px, py) { this.setFrac({ x: px / pre.clientWidth, y: py / pre.clientHeight }); },
      setFrac(f) {
        groundFrac = f && Number.isFinite(f.x) && Number.isFinite(f.y)
          ? { x: Math.min(1, Math.max(0, f.x)), y: Math.min(1, Math.max(0, f.y)) } : null;
        ground = groundFrac ? fracCell(groundFrac) : dockSpot;
      },
      overFarmer(px, py) {
        const x = Math.floor(px / cellW), y = Math.floor(py / cellH);
        return x >= farmerBox.x0 - 1 && x <= farmerBox.x1 + 1 && y >= farmerBox.y0 - 1 && y <= farmerBox.y1 + 1;
      },
      grab() { if (star.state === 'ground') setStar('drag'); },
      release() { if (star.state === 'drag') setStar('ground'); },
      ritual(onOpen) {
        if (star.state !== 'drag' && star.state !== 'ground') return;
        if (reduceMotion.matches) { setStar('held'); onOpen?.(); return; }
        setStar('ritual');
        kick(RITUAL + 0.1);
        setTimeout(() => onOpen?.(), 2100);
        setTimeout(() => { if (star.state === 'ritual') setStar('held'); }, RITUAL * 1000);
      },
      fall() {
        if (star.state !== 'held' && star.state !== 'ritual') return;
        if (reduceMotion.matches) { setStar('ground'); return; }
        setStar('falling');
        kick(FALL + 0.1);
        setTimeout(() => { if (star.state === 'falling') setStar('ground'); }, FALL * 1000);
      },
    },
    get rate() { return rainRate(); },
    get auto() { return cfg.rate === 'auto'; },
    get mu() { return cfg.mu; },
    get wind() { return cfg.wind; },
    get paused() { return cfg.paused || reduceMotion.matches; },
    setRain(v) {
      cfg.rate = v === 'auto' ? 'auto' : Math.max(0, Math.min(5000, v));
      stats.buckets = []; stats.bucket = 0; stats.bucketStart = simT;   // fresh sample for the new λ
    },
    setWind(w) { cfg.wind = Math.max(-1.5, Math.min(1.5, w)); },
    setMu(m) {
      cfg.mu = Math.max(0, Math.min(10, m));
      stats.arrivals = [];
      if (cfg.mu > 0) nextComet = simT + exponential(cfg.mu);   // memoryless: resample is fine
    },
    comet() { spawnComet(); if (this.paused) draw(); },
    pause() { cfg.paused = true; cancelAnimationFrame(raf); },
    resume() { cfg.paused = false; start(); },
    stats() {
      const b = stats.buckets;
      const mean = b.length ? b.reduce((a, x) => a + x, 0) / b.length : NaN;
      const vr = b.length > 1 ? b.reduce((a, x) => a + (x - mean) ** 2, 0) / (b.length - 1) : NaN;
      const a = stats.arrivals;
      const gaps = a.slice(1).map((x, i) => x - a[i]);
      const gm = gaps.length ? gaps.reduce((s, x) => s + x, 0) / gaps.length : NaN;
      return {
        simT, lambda: rainRate(), rainTotal: stats.rainTotal,
        seconds: b.length, perSecMean: mean, perSecVar: vr,
        mu: cfg.mu, comets: a.length, gapMean: gm, nextIn: cfg.mu > 0 ? Math.max(0, nextComet - simT) : Infinity,
        onScreen: { drops: drops.length, comets: comets.length },
      };
    },
  };
})();
