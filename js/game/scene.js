// Stage 6a: the layered home scene (sky + moon, far mountains, castle, mist, petals, sakura branch)
// with gentle parallax (mouse on a laptop, device tilt on a phone), mist and petals drawn in code,
// and a slowly glowing moon and lantern windows. Everything heavy is skipped when effects are off.
// Pure presentation: nothing here reads or writes any data.
const ASSETS = 'assets/theme/';

/** Parallax strength per layer (px of movement for a full mouse sweep), far to near. */
const DEPTH = { sky: 10, far: 22, castle: 34, near: 48, branch: 26 };

/**
 * Build the scene. glow = { moon: {x, y, r} (fractions of the sky picture), windows: [{x, y}]
 * (fractions of the castle picture) }. Returns { el, destroy }.
 */
export function heroScene({ fx, glow }) {
  const el = document.createElement('section');
  el.className = 'hero-scene' + (fx ? ' fx' : '');
  el.id = 'castle';
  el.setAttribute('aria-label', 'A hilltop castle at night under the moon');

  const img = (name, cls, eager = false) => {
    const i = document.createElement('img');
    i.src = `${ASSETS}${name}.webp`;
    i.alt = '';
    i.className = `layer ${cls}`;
    i.decoding = 'async';
    if (!eager) i.loading = 'lazy';
    i.draggable = false;
    return i;
  };
  const sky = img('home_sky', 'l-sky', true);
  const moonGlow = document.createElement('div');
  moonGlow.className = 'moon-glow';
  moonGlow.style.left = `${glow.moon.x * 100}%`;
  moonGlow.style.top = `${glow.moon.y * 100}%`;
  const skyWrap = wrap('l-sky-wrap', sky, moonGlow);
  const far = img('home_far_mountains', 'l-far', true);
  const castle = img('home_castle', 'l-castle', true);
  const castleWrap = wrap('l-castle-wrap', castle);
  for (const w of glow.windows) {
    const d = document.createElement('span');
    d.className = 'window-glow';
    d.style.left = `${w.x * 100}%`;
    d.style.top = `${w.y * 100}%`;
    d.style.animationDelay = `${((w.x * 7 + w.y * 13) % 1) * 4}s`;
    castleWrap.append(d);
  }
  const branch = img('home_branch', 'l-branch', true);
  const ground = document.createElement('div');
  ground.className = 'layer l-ground';
  el.append(skyWrap, far, castleWrap, ground, branch);

  const timers = [];
  let raf = 0;
  let running = false;
  let visible = true;
  const cleanups = [];

  // ---- time of day: a tint over the night scene (dawn rose, day haze, dusk amber; night as painted) ----
  const tint = document.createElement('div');
  tint.className = 'layer l-tint';
  tint.setAttribute('aria-hidden', 'true');
  el.insertBefore(tint, branch);

  if (fx) {
    // ---- living sky: clouds drifting past the moon, and now and then birds crossing ----
    const clouds = document.createElement('div');
    clouds.className = 'layer l-clouds';
    clouds.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 4; i++) {
      const c = document.createElement('span');
      c.className = 'cloud';
      c.style.setProperty('--y', `${6 + i * 9}%`);
      c.style.setProperty('--d', `${70 + i * 23}s`);
      c.style.setProperty('--delay', `${-i * 19}s`);
      c.style.setProperty('--s', (0.7 + (i % 3) * 0.25).toFixed(2));
      clouds.append(c);
    }
    el.insertBefore(clouds, far);
    const birds = document.createElement('div');
    birds.className = 'layer l-birds';
    birds.setAttribute('aria-hidden', 'true');
    el.insertBefore(birds, far);
    const flight = () => {
      if (!el.isConnected) return;
      const flock = document.createElement('span');
      flock.className = 'flock';
      flock.style.setProperty('--y', `${8 + Math.random() * 22}%`);
      flock.style.setProperty('--dir', Math.random() < 0.5 ? '1' : '-1');
      flock.innerHTML = '<svg viewBox="0 0 60 24" width="60" height="24"><path d="M2 12 Q8 4 14 11 Q20 4 26 12" /><path d="M30 8 Q35 2 40 7 Q45 2 50 8" /><path d="M20 20 Q24 15 28 19 Q32 15 36 20" /></svg>';
      birds.append(flock);
      setTimeout(() => flock.remove(), 16000);
    };
    timers.push(setTimeout(flight, 3000));
    timers.push(setInterval(flight, 26000));

    // ---- mist (canvas, low resolution, drifting soft blobs) ----
    const mist = document.createElement('canvas');
    mist.className = 'layer l-mist';
    mist.setAttribute('aria-hidden', 'true');
    el.insertBefore(mist, castleWrap); // behind the castle: mist in the valley
    const mist2 = document.createElement('canvas');
    mist2.className = 'layer l-mist l-mist-near';
    mist2.setAttribute('aria-hidden', 'true');
    el.insertBefore(mist2, ground);
    // ---- petals (canvas particles; tap one and it flutters away) ----
    const petals = document.createElement('canvas');
    petals.className = 'layer l-petals';
    petals.id = 'petals';
    petals.setAttribute('aria-hidden', 'true');
    el.append(petals);

    const blobs = [];
    const P = [];
    let W = 0; let H = 0; let t0 = performance.now();
    const rnd = (a, b) => a + Math.random() * (b - a);
    const reset = (p, fromTop) => {
      p.x = rnd(-0.05, 1.05) * W;
      p.y = fromTop ? -20 : rnd(-H, 0);
      p.r = rnd(5, 9);
      p.vy = rnd(14, 28);
      p.vx = rnd(-6, 6);
      p.phase = rnd(0, Math.PI * 2);
      p.spin = rnd(-1.2, 1.2);
      p.rot = rnd(0, Math.PI * 2);
      p.burst = 0;
      p.alpha = rnd(0.7, 1);
      p.hue = rnd(335, 352);
    };
    const size = () => {
      const r = el.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      for (const c of [mist, mist2]) { c.width = Math.round(W / 3); c.height = Math.round(H / 3); }
      petals.width = W; petals.height = H;
      if (!blobs.length) for (let i = 0; i < 7; i++) blobs.push({ x: rnd(0, 1), y: rnd(0.55, 0.95), r: rnd(0.18, 0.34), s: rnd(0.004, 0.011), a: rnd(0.18, 0.32), ph: rnd(0, 6.3) });
      const n = W < 600 ? 14 : 24;
      while (P.length < n) { const p = {}; reset(p, false); P.push(p); }
      P.length = n;
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    cleanups.push(() => ro.disconnect());

    const drawMist = (c, t, near) => {
      const g = c.getContext('2d');
      const w = c.width; const h = c.height;
      g.clearRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      blobs.forEach((b, i) => {
        if (near !== (i % 2 === 0)) return;
        const x = ((b.x + t * b.s + Math.sin(t * 0.07 + b.ph) * 0.03) % 1.3 - 0.15) * w;
        const y = (b.y + Math.sin(t * 0.05 + b.ph) * 0.02) * h;
        const r = b.r * w;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(190, 200, 225, ${b.a})`);
        grad.addColorStop(1, 'rgba(190, 200, 225, 0)');
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, 2 * r, 2 * r);
      });
    };
    const drawPetals = (dt, t) => {
      const g = petals.getContext('2d');
      g.clearRect(0, 0, W, H);
      for (const p of P) {
        const sway = Math.sin(t * 1.3 + p.phase) * 18;
        if (p.burst > 0) {
          p.burst -= dt;
          p.x += p.vx * 6 * dt; p.y -= 90 * dt; p.rot += p.spin * 8 * dt; p.alpha -= dt * 1.4;
          if (p.burst <= 0 || p.alpha <= 0) reset(p, true);
        } else {
          p.x += (p.vx + sway * 0.6) * dt; p.y += p.vy * dt; p.rot += p.spin * dt;
          if (p.y > H + 20 || p.x < -40 || p.x > W + 40) reset(p, true);
        }
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.globalAlpha = Math.max(0, p.alpha);
        g.fillStyle = `hsl(${p.hue} 80% ${p.burst > 0 ? 90 : 84}%)`;
        g.beginPath();
        g.ellipse(0, 0, p.r, p.r * 0.62, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = `hsl(${p.hue} 70% 70% / 0.5)`;
        g.beginPath();
        g.ellipse(p.r * 0.25, 0, p.r * 0.45, p.r * 0.3, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    };
    let last = performance.now();
    const frame = (now) => {
      raf = 0;
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;
      drawMist(mist, t, false);
      drawMist(mist2, t * 1.4, true);
      drawPetals(dt, t);
      raf = requestAnimationFrame(frame);
    };
    const start = () => { if (!running && visible && document.visibilityState !== 'hidden') { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } };
    const stop = () => { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; };
    const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible) start(); else stop(); }, { threshold: 0.05 });
    io.observe(el);
    cleanups.push(() => io.disconnect());
    const onVis = () => (document.visibilityState === 'hidden' ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    cleanups.push(() => document.removeEventListener('visibilitychange', onVis));
    petals.addEventListener('pointerdown', (e) => {
      const r = petals.getBoundingClientRect();
      const x = e.clientX - r.left; const y = e.clientY - r.top;
      let best = null; let bd = 40 * 40;
      for (const p of P) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = p; } }
      if (best) { best.burst = 1.2; best.vx = (best.x - x) * 1.5 + (Math.random() - 0.5) * 20; }
    });
    cleanups.push(stop);
    start();

    // ---- parallax: pointer on laptops, tilt on phones ----
    const set = (px, py) => {
      el.style.setProperty('--px', px.toFixed(3));
      el.style.setProperty('--py', py.toFixed(3));
    };
    const onMove = (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const r = el.getBoundingClientRect();
      set((e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5);
    };
    const onLeave = () => set(0, 0);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    cleanups.push(() => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave); });
    if ('DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches) {
      let base = null;
      const onTilt = (ev) => {
        if (ev.gamma == null || ev.beta == null) return;
        if (base === null) base = { g: ev.gamma, b: ev.beta };
        const gx = Math.max(-20, Math.min(20, ev.gamma - base.g)) / 40;
        const gy = Math.max(-20, Math.min(20, ev.beta - base.b)) / 40;
        set(gx, gy);
      };
      const listen = () => { window.addEventListener('deviceorientation', onTilt); cleanups.push(() => window.removeEventListener('deviceorientation', onTilt)); };
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        // iPhone: the browser only allows tilt after a tap
        const ask = () => { DeviceOrientationEvent.requestPermission().then((s) => { if (s === 'granted') listen(); }).catch(() => {}); el.removeEventListener('click', ask); };
        el.addEventListener('click', ask);
        cleanups.push(() => el.removeEventListener('click', ask));
      } else listen();
    }
  }

  const destroy = () => { for (const c of cleanups) c(); timers.forEach((t) => { clearInterval(t); clearTimeout(t); }); };
  return { el, destroy };
}

function wrap(cls, ...children) {
  const d = document.createElement('div');
  d.className = `layer ${cls}`;
  d.append(...children);
  return d;
}
