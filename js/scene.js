/*
 * ASCII night scene: a farmer dozing over his fishing rod on a dock by a lake.
 *
 *  - Rain:   in each frame of length dt, the number of new drops is
 *            N ~ Poisson(lambda * dt). Sums of independent Poissons are
 *            Poisson, so counts per second are Poisson(lambda) exactly.
 *  - Comets: a homogeneous Poisson process with rate mu. Inter-arrival
 *            times are drawn as T ~ Exponential(mu) = -ln(U) / mu.
 *  - Bites:  a Poisson process with rate nu. Each bite is a fish with
 *            probability p, else a boot. Thinning a Poisson process keeps it
 *            Poisson: fish ~ PP(nu*p), boots ~ PP(nu*(1-p)).
 *  - Moon:   the real moon as seen from Durham, NC: its phase, and where it
 *            sits in the sky right now (gone when it's below the horizon).
 *
 * Exposes window.Scene for the terminal and the journal.
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
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const ease = (x) => 1 - (1 - x) ** 3;
  const clock = () => performance.now() / 1000;

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

  const FISH = [String.raw`><((('>`];
  const BOOT = [String.raw`|~~|`, String.raw`|  |__`, String.raw`|_____)`];

  // color codes -> CSS classes (see style.css)
  const C = { NONE: 0, STAR: 1, MOON: 2, MTN: 3, WATER: 4, GLOW: 5, RAIN: 6, RAINFAR: 7,
              SPLASH: 8, HEAD: 9, TAIL: 10, FARMER: 11, DOCK: 12, LINE: 13, BOB: 14, EMBER: 15, VOICE: 16 };
  const CLS = ['', 's', 'm', 'k', 'w', 'g', 'r', 'q', 'x', 'h', 't', 'f', 'd', 'l', 'b', 'e', 'v'];

  // ------------------------------------------------------------------ moon
  // Low-precision lunar ephemeris (good to a fraction of a degree, plenty for
  // ASCII). The phase is the same everywhere; altitude/azimuth are for Durham.
  const SITE = { name: 'Durham, NC', lat: 35.994, lon: -78.899 };
  const RAD = Math.PI / 180, OBL = 23.4397 * RAD;
  const days = (date) => date.valueOf() / 864e5 - 0.5 + 2440588 - 2451545;
  const raOf = (l, b) => Math.atan2(Math.sin(l) * Math.cos(OBL) - Math.tan(b) * Math.sin(OBL), Math.cos(l));
  const decOf = (l, b) => Math.asin(Math.sin(b) * Math.cos(OBL) + Math.cos(b) * Math.sin(OBL) * Math.sin(l));
  function moonCoords(d) {
    const L = RAD * (218.316 + 13.176396 * d), M = RAD * (134.963 + 13.064993 * d), F = RAD * (93.272 + 13.229350 * d);
    const l = L + RAD * 6.289 * Math.sin(M), b = RAD * 5.128 * Math.sin(F);
    return { ra: raOf(l, b), dec: decOf(l, b), dist: 385001 - 20905 * Math.cos(M) };
  }
  function sunCoords(d) {
    const M = RAD * (357.5291 + 0.98560028 * d);
    const Cn = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + Cn + RAD * 102.9372 + Math.PI;
    return { ra: raOf(L, 0), dec: decOf(L, 0) };
  }
  // alt: radians above the horizon. az: radians from due south, west positive.
  // phase: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. fraction: share lit.
  function moonSky(date = new Date()) {
    const d = days(date), m = moonCoords(d), s = sunCoords(d), phi = RAD * SITE.lat;
    const H = RAD * (280.16 + 360.9856235 * d) + RAD * SITE.lon - m.ra;
    const alt = Math.asin(Math.sin(phi) * Math.sin(m.dec) + Math.cos(phi) * Math.cos(m.dec) * Math.cos(H));
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(m.dec) * Math.cos(phi));
    const el = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
    const inc = Math.atan2(149598000 * Math.sin(el), m.dist - 149598000 * Math.cos(el));
    const ang = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra),
      Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
    return { alt, az, fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + (0.5 * inc * Math.sign(ang)) / Math.PI };
  }
  // next time the moon crosses the horizon (10-minute steps, then refined)
  function nextCrossing(date, rising) {
    let t = date.valueOf(), prev = moonSky(new Date(t)).alt;
    for (let i = 0; i < 6 * 30; i++) {
      const t2 = t + 6e5, a = moonSky(new Date(t2)).alt;
      if (rising ? prev <= 0 && a > 0 : prev > 0 && a <= 0) {
        let lo = t, hi = t2;
        for (let k = 0; k < 12; k++) {
          const mid = (lo + hi) / 2, am = moonSky(new Date(mid)).alt;
          if (rising ? am > 0 : am <= 0) hi = mid; else lo = mid;
        }
        return new Date(hi);
      }
      t = t2; prev = a;
    }
    return null;
  }
  // quarters and full/new are moments; give them a narrow band, the rest is crescent/gibbous
  function phaseName(p) {
    if (p < 0.03 || p > 0.97) return 'new moon';
    if (p < 0.22) return 'waxing crescent';
    if (p < 0.28) return 'first quarter';
    if (p < 0.47) return 'waxing gibbous';
    if (p < 0.53) return 'full moon';
    if (p < 0.72) return 'waning gibbous';
    if (p < 0.78) return 'last quarter';
    return 'waning crescent';
  }
  const MOON_W = 15, MOON_H = 7;

  // ----------------------------------------------------------------- state
  let cols = 0, rows = 0, horizon = 0;
  let chars = [], colors = new Uint8Array(0), mask = new Uint8Array(0);
  let stars = [], ridge = [];
  let sky = moonSky();
  const moon = { x: 0, y: 0, up: false };
  let farmerCells = [], tip = { x: 0, y: 0 }, bob = { x: 0, y: 0 };
  let cellW = 8, cellH = 16;
  let fx0 = 0, fy0 = 0;                                 // farmer art origin
  let eyes = [], zzz = { x: 0, y: 0 };

  // the star. states: ground -> drag -> ritual -> held (lantern on the rod tip) -> falling -> ground
  // It rests under the moon unless the visitor moved it (groundFrac: fraction of the viewport).
  // While resting it's a DOM element (see #ember); the grid only draws it in flight.
  let groundFrac = null, homeSpot = { x: 0, y: 0 };
  let ground = { x: 0, y: 0 }, hand = { x: 0, y: 0 }, farmerBox = { x0: 0, x1: 0, y0: 0, y1: 0 };
  const star = { state: 'ground', t0: 0 };
  const RITUAL = 2.6, FALL = 1.1;

  // the farmer. asleep unless poked, mid-catch, or holding the star
  const AWAKE = 20;                                     // seconds he stays up after a poke
  const BITE = { dip: 0.6, reel: 2.4, show: 4.8, drop: 5.5, end: 6.3 };
  const farmer = { awakeUntil: 0, bite: null, says: [] };

  let drops = [], splashes = [], comets = [];
  let simT = 0, nextComet = 0, nextBite = 0;

  const cfg = { rate: 'auto', wind: 0, mu: 1 / 14, nu: 1 / 40, pFish: 0.75, paused: false };
  const stats = { rainTotal: 0, bucket: 0, bucketStart: 0, buckets: [], arrivals: [], bites: [], fish: 0, boots: 0, missed: 0 };

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

    // farmer + dock
    farmerCells = [];
    const fx = cols < 90 ? 1 : Math.round(cols * 0.06);
    const fy = Math.max(horizon - 6, rows - FARMER.length - 1);
    fx0 = fx; fy0 = fy;
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
    const faceRow = FARMER.findIndex((l) => l.includes('#-#-#'));
    eyes = [...FARMER[faceRow]].map((c, i) => (c === '-' ? { x: fx + i, y: fy + faceRow } : null)).filter(Boolean);
    zzz = { x: fx + 18, y: fy + 2 };
    farmerBox = { x0: fx + 6, x1: fx + 21, y0: fy + 2, y1: dockY - 1 };

    placeMoon();

    // keep particles across re-layouts; drop any now off-grid
    drops = drops.filter((d) => d.x < cols && d.ty < rows);
    splashes = splashes.filter((sp) => sp.x < cols && sp.y < rows);
  }

  // Looking south from the dock: east is left, west is right; higher = further up.
  function placeMoon() {
    moon.up = sky.alt > -0.6 * RAD;                     // a sliver over the ridge still counts
    const ax = 0.5 + sky.az / Math.PI;                  // az -90° (E) -> 0, +90° (W) -> 1
    moon.x = clamp(Math.round(ax * cols - MOON_W / 2), 1, cols - MOON_W - 1);
    const lowest = horizon - 2 - MOON_H, highest = 1;
    moon.y = Math.round(lowest - (lowest - highest) * Math.sin(Math.max(0, sky.alt)));
    // the star's default rest: just under the moon, or high in the open sky when it's down
    homeSpot = moon.up
      ? { x: moon.x + (MOON_W >> 1), y: Math.min(horizon - 3, moon.y + MOON_H + 1) }
      : { x: Math.round(cols * 0.82), y: Math.round(horizon * 0.3) };
    ground = groundFrac ? fracCell(groundFrac) : homeSpot;
    window.dispatchEvent(new Event('scene:layout'));
  }

  const fracCell = (f) => ({ x: Math.floor((f.x * pre.clientWidth) / cellW), y: Math.floor((f.y * pre.clientHeight) / cellH) });
  const inGrid = (x, y) => x >= 0 && x < cols && y >= 0 && y < rows;
  function put(x, y, c, col) {
    x = Math.round(x); y = Math.round(y);
    if (!inGrid(x, y)) return;
    const i = y * cols + x;
    chars[i] = c; colors[i] = col;
  }
  // only draws on empty cells, so glows never smear the farmer
  function soft(x, y, c, col) {
    x = Math.round(x); y = Math.round(y);
    if (inGrid(x, y) && chars[y * cols + x] === ' ') put(x, y, c, col);
  }
  function text(x, y, s, col) { [...s].forEach((c, i) => put(x + i, y, c, col)); }

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

    // --- bites: Poisson process, Exp(nu) gaps; a bite during a catch (or while
    //     the star is on the rod) is missed, which thins the observed stream
    if (cfg.nu > 0) {
      while (simT >= nextBite) {
        if (farmer.bite || !['ground', 'drag'].includes(star.state)) stats.missed++;
        else startBite(rand() < cfg.pFish ? 'fish' : 'boot');
        nextBite += exponential(cfg.nu);
      }
    }
    if (farmer.bite && clock() - farmer.bite.t0 > BITE.end) farmer.bite = null;
  }

  // ---------------------------------------------------------------- farmer
  function say(lines) {
    const now = clock();
    farmer.says = lines.map(([s, from, dur]) => ({ s, from: now + from, until: now + from + dur }));
  }
  const isAwake = (now = clock()) => now < farmer.awakeUntil || !!farmer.bite || star.state === 'ritual' || star.state === 'held';

  function startBite(kind) {
    const now = clock();
    farmer.bite = { kind, t0: now };
    farmer.awakeUntil = Math.max(farmer.awakeUntil, now + BITE.end + 1.5);
    say(kind === 'fish'
      ? [['!', 0, 1], ['a fish!', BITE.reel, 1.3], ['back you go.', BITE.reel + 1.4, 1.2]]
      : [['!', 0, 1], ['...a boot.', BITE.reel, 1.3], ['not again.', BITE.reel + 1.4, 1.2]]);
    stats.bites.push(simT);
    if (stats.bites.length > 200) stats.bites.shift();
    if (kind === 'fish') stats.fish++; else stats.boots++;
  }

  const QUIPS = ['quiet night.', 'mm?', 'nothing biting.', 'the moon is out.', 'stars are low tonight.'];
  function drawFarmerFace(now) {
    const awake = isAwake(now);
    let e = awake ? ['o', 'o'] : ['-', '-'];
    const b = farmer.bite, a = b ? now - b.t0 : 0;
    if (b && a < BITE.dip + 0.4) e = ['O', 'O'];
    else if (b && a >= BITE.reel && a < BITE.drop) e = b.kind === 'fish' ? ['^', '^'] : ['>', '<'];
    else if (awake && (now * 0.6) % 4 < 0.12) e = ['-', '-'];        // blink
    eyes.forEach((p, i) => put(p.x, p.y, e[i], C.FARMER));
    if (!awake) {                                                    // zzz drifting off the hat
      for (let k = 0; k < 3; k++) {
        const p = (now * 0.35 + k / 3) % 1;
        soft(zzz.x + p * 5, zzz.y - p * 4, p < 0.4 ? 'z' : 'Z', C.STAR);
      }
    }
    farmer.says = farmer.says.filter((l) => now < l.until);
    const line = farmer.says.find((l) => now >= l.from);
    if (line) text(fx0 + 7, fy0, line.s, C.VOICE);
  }

  // ------------------------------------------------------------------ draw
  function draw() {
    const t = simT, now = clock();
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

    drawMoon();

    // mountains (in front of a low moon)
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

    // lake, with a moonlight path as wide as the moon is bright
    const lake = rows - horizon, mcx = moon.x + (MOON_W >> 1);
    const glow = moon.up ? 0.25 + 0.75 * sky.fraction : 0;
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
        const w = (1.5 + d * 4.5) * glow;
        if (glow > 0.3 && Math.abs(x - mcx) < w && v > -0.3) { ch = v > 0.7 ? '=' : '-'; col = C.GLOW; }
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

    // fishing line + bobber, or whatever is on the hook
    if (farmer.bite) drawBite(now);
    else { drawLine(bob.y); drawBob(t); }

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

    drawFarmerFace(now);
    drawStar();
    render();
  }

  // The disc is lit on the side facing the sun: from the northern hemisphere
  // a waxing moon is lit on the right, a waning one on the left.
  function drawMoon() {
    if (!moon.up) return;
    const e = sky.phase * 2 * Math.PI, ce = Math.cos(e), waxing = sky.phase < 0.5;
    for (let r = 0; r < MOON_H; r++) {
      const y = ((r + 0.5) / MOON_H) * 2 - 1, hw = Math.sqrt(Math.max(0, 1 - y * y));
      for (let c = 0; c < MOON_W; c++) {
        const x = ((c + 0.5) / MOON_W) * 2 - 1;
        if (Math.abs(x) > hw + 0.05) continue;
        const xn = hw > 0 ? x / hw : 0;
        const lit = waxing ? xn > ce : xn < -ce;
        const limb = Math.abs(x) > hw - 2.2 / MOON_W || r === 0 || r === MOON_H - 1;
        if (lit) put(moon.x + c, moon.y + r, r === 0 ? '.' : r === MOON_H - 1 ? "'" : ':', C.MOON);
        else put(moon.x + c, moon.y + r, limb ? '.' : ' ', C.STAR);   // the dark side, faintly outlined
      }
    }
  }

  function drawLine(endY) { for (let y = tip.y + 1; y < endY; y++) put(tip.x, y, '|', C.LINE); }
  function drawBob(t) {
    const phase = (t * 0.7) % 1;
    put(bob.x, bob.y, phase < 0.5 ? 'o' : 'O', C.BOB);
    if (phase < 0.5) { put(bob.x - 1, bob.y, '-', C.SPLASH); put(bob.x + 1, bob.y, '-', C.SPLASH); }
    else { put(bob.x - 2, bob.y, '(', C.SPLASH); put(bob.x + 2, bob.y, ')', C.SPLASH); }
  }
  function drawSprite(sp, cx, top, col) {
    const w = Math.max(...sp.map((l) => l.length)), left = Math.round(cx - w / 2);
    sp.forEach((l, r) => [...l].forEach((c, i) => { if (c !== ' ') put(left + i, top + r, c, col); }));
  }
  function ripple(x, k) { const r = 1 + Math.round(k * 3); put(x - r, bob.y, '(', C.SPLASH); put(x + r, bob.y, ')', C.SPLASH); }

  function drawBite(now) {
    const b = farmer.bite, a = now - b.t0, hang = tip.y + 2;
    const sp = b.kind === 'fish' ? FISH : BOOT, col = b.kind === 'fish' ? C.SPLASH : C.DOCK;
    if (a < BITE.dip) {                                // the bobber gets yanked under
      const k = a / BITE.dip;
      drawLine(bob.y);
      put(bob.x, bob.y, k < 0.3 ? 'O' : k < 0.6 ? 'o' : '.', C.BOB);
      ripple(bob.x, k);
    } else if (a < BITE.reel) {                        // he reels it up
      const u = ease((a - BITE.dip) / (BITE.reel - BITE.dip));
      const top = Math.round(bob.y + (hang - bob.y) * u);
      drawLine(top);
      drawSprite(sp, tip.x + 0.5, top, col);
      if (u < 0.4) ripple(bob.x, u * 2);
    } else if (a < BITE.show) {                        // dangling while he looks at it
      drawLine(hang);
      drawSprite(sp, tip.x + 0.5 + Math.round(Math.sin((a - BITE.reel) * 4)), hang, col);
    } else if (a < BITE.drop) {                        // tossed back
      const u = (a - BITE.show) / (BITE.drop - BITE.show);
      drawLine(hang);
      drawSprite(sp, tip.x + 0.5 + u * 4, Math.round(hang + (bob.y - hang) * u * u), col);
    } else {                                           // splash, line goes back in
      drawLine(bob.y);
      drawBob(simT);
      ripple(bob.x + 4, (a - BITE.drop) / (BITE.end - BITE.drop));
    }
  }

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
        // a lobbed arc from the rod tip to wherever the star rests
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

  // the moon moves about a quarter degree a minute
  setInterval(() => { sky = moonSky(); placeMoon(); if (!running()) draw(); }, 60000);

  // draw right away with fallback-font metrics, re-measure once the web font lands
  layout();
  nextComet = simT + exponential(cfg.mu || 1);
  nextBite = simT + 8 + exponential(cfg.nu || 1);       // let a first-time visitor see him doze first
  for (let i = 0; i < 36; i++) update(FRAME);   // pre-warm so the first frame already has rain
  draw();
  start();
  document.fonts?.ready.then(relayout);

  // star and farmer animations keep drawing even when the scene is paused
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
  const toPx = (b) => ({ x: b.x0 * cellW, y: b.y0 * cellH, w: (b.x1 - b.x0 + 1) * cellW, h: (b.y1 - b.y0 + 1) * cellH });
  window.Scene = {
    star: {
      get state() { return star.state; },
      // pixel point where the star rests
      cell: () => (groundFrac
        ? { x: groundFrac.x * pre.clientWidth, y: groundFrac.y * pre.clientHeight, w: cellW, h: cellH }
        : { x: (ground.x + 0.5) * cellW, y: (ground.y + 0.5) * cellH, w: cellW, h: cellH }),
      get frac() { return groundFrac; },
      // rest the star at a pixel point (or {x, y} fractions with setFrac); null sends it back under the moon
      place(px, py) { this.setFrac({ x: px / pre.clientWidth, y: py / pre.clientHeight }); },
      setFrac(f) {
        groundFrac = f && Number.isFinite(f.x) && Number.isFinite(f.y)
          ? { x: clamp(f.x, 0, 1), y: clamp(f.y, 0, 1) } : null;
        ground = groundFrac ? fracCell(groundFrac) : homeSpot;
      },
      overFarmer(px, py) {
        const x = Math.floor(px / cellW), y = Math.floor(py / cellH);
        return x >= farmerBox.x0 - 1 && x <= farmerBox.x1 + 1 && y >= farmerBox.y0 - 1 && y <= farmerBox.y1 + 1;
      },
      grab() { if (star.state === 'ground') setStar('drag'); },
      release() { if (star.state === 'drag') setStar('ground'); },
      ritual(onOpen) {
        if (star.state !== 'drag' && star.state !== 'ground') return;
        farmer.bite = null;
        farmer.says = [];
        if (reduceMotion.matches) { setStar('held'); onOpen?.(); return; }
        setStar('ritual');
        kick(RITUAL + 0.1);
        setTimeout(() => onOpen?.(), 2100);
        setTimeout(() => { if (star.state === 'ritual') setStar('held'); }, RITUAL * 1000);
      },
      fall() {
        if (star.state !== 'held' && star.state !== 'ritual') return;
        farmer.awakeUntil = clock() + 4;                       // watches it go, then dozes off
        if (reduceMotion.matches) { setStar('ground'); return; }
        setStar('falling');
        kick(FALL + 0.1);
        setTimeout(() => { if (star.state === 'falling') setStar('ground'); }, FALL * 1000);
      },
    },
    farmer: {
      get awake() { return isAwake(); },
      rect: () => toPx(farmerBox),
      // a click on the farmer: wakes him (he notices the star), or chats if he's up
      poke() {
        const now = clock(), was = isAwake(now);
        farmer.awakeUntil = Math.max(farmer.awakeUntil, now + AWAKE);
        if (farmer.bite || star.state !== 'ground') return;
        if (!was) say([['hm?', 0, 1.3], ['oh. a star fell.', 1.4, 2.6], ['bring it here?', 4.1, 3]]);
        else say([[QUIPS[(rand() * QUIPS.length) | 0], 0, 2.2]]);
        kick(7.2);
        setTimeout(() => { if (!running()) draw(); }, AWAKE * 1000 + 50);
      },
      stay(sec) { if (isAwake()) farmer.awakeUntil = Math.max(farmer.awakeUntil, clock() + sec); },
      snore() { say([['zzz...', 0, 1.6]]); kick(1.7); },
    },
    moon() {
      const s = sky, now = new Date();
      return {
        place: SITE.name,
        phase: s.phase, name: phaseName(s.phase), illumination: s.fraction,
        altitude: s.alt / RAD, azimuth: ((s.az / RAD + 180) % 360 + 360) % 360,   // compass bearing, 0 = north
        up: s.alt > 0, rises: s.alt > 0 ? null : nextCrossing(now, true), sets: s.alt > 0 ? nextCrossing(now, false) : null,
      };
    },
    get rate() { return rainRate(); },
    get auto() { return cfg.rate === 'auto'; },
    get mu() { return cfg.mu; },
    get nu() { return cfg.nu; },
    get pFish() { return cfg.pFish; },
    get wind() { return cfg.wind; },
    get paused() { return cfg.paused || reduceMotion.matches; },
    setRain(v) {
      cfg.rate = v === 'auto' ? 'auto' : clamp(v, 0, 5000);
      stats.buckets = []; stats.bucket = 0; stats.bucketStart = simT;   // fresh sample for the new λ
    },
    setWind(w) { cfg.wind = clamp(w, -1.5, 1.5); },
    setMu(m) {
      cfg.mu = clamp(m, 0, 10);
      stats.arrivals = [];
      if (cfg.mu > 0) nextComet = simT + exponential(cfg.mu);   // memoryless: resample is fine
    },
    setNu(v) {
      cfg.nu = clamp(v, 0, 2);
      stats.bites = []; stats.fish = stats.boots = stats.missed = 0;
      if (cfg.nu > 0) nextBite = simT + exponential(cfg.nu);
    },
    setPFish(p) { cfg.pFish = clamp(p, 0, 1); stats.fish = stats.boots = 0; },
    bite() {
      if (farmer.bite || !['ground', 'drag'].includes(star.state)) return false;
      startBite(rand() < cfg.pFish ? 'fish' : 'boot');
      kick(BITE.end + 0.2);
      return true;
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
        nu: cfg.nu, pFish: cfg.pFish, fish: stats.fish, boots: stats.boots, missed: stats.missed,
        nextBiteIn: cfg.nu > 0 ? Math.max(0, nextBite - simT) : Infinity,
        onScreen: { drops: drops.length, comets: comets.length },
      };
    },
  };
})();
