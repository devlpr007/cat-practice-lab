// Stage 6e: ambient effects drawn in code inside each dojo's header scene only (never over the
// cards): forge sparks (Blade), drifting ink fog from both sides (Scroll), fireflies (Shadow).
// Runs only with effects on; stops when the scene is scrolled away or the tab is hidden.
const rnd = (a, b) => a + Math.random() * (b - a);

/** source: { x, y } of the forge fire as fractions of the scene (measured in the artwork). */
const FORGE = { x: 0.843, y: 0.60 };

export function dojoAmbience(scene, key) {
  const canvas = document.createElement('canvas');
  canvas.className = 'dojo-ambience';
  canvas.setAttribute('aria-hidden', 'true');
  scene.append(canvas);
  const g = canvas.getContext('2d');
  let W = 1; let H = 1; let raf = 0; let running = false; let visible = true; let last = performance.now();
  const P = [];

  const size = () => {
    const r = scene.getBoundingClientRect();
    const scale = key === 'varc' ? 0.5 : 1; // fog is soft: half resolution is enough
    W = Math.max(1, Math.round(r.width * scale)); H = Math.max(1, Math.round(r.height * scale));
    canvas.width = W; canvas.height = H;
    P.length = 0;
    const n = { quant: W < 500 ? 40 : 70, varc: 12, lrdi: W < 500 ? 18 : 34 }[key];
    for (let i = 0; i < n; i++) P.push(spawn(key, W, H, true));
  };
  const ro = new ResizeObserver(size);
  ro.observe(scene);

  const draw = {
    quant(dt, t) {
      g.clearRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      for (const p of P) {
        p.life -= dt;
        if (p.life <= 0) Object.assign(p, spawn(key, W, H, false));
        p.vy -= 40 * dt; // sparks rise and accelerate upward with the heat
        p.x += (p.vx + Math.sin(t * 3 + p.ph) * 14) * dt; p.y += p.vy * dt;
        const a = Math.min(1, p.life / 0.6) * p.alpha;
        g.globalAlpha = a;
        g.fillStyle = p.hot ? '#ffe9a8' : '#ff9a3d';
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
        g.globalAlpha = a * 0.35; g.fillStyle = '#ff6a1a';
        g.beginPath(); g.arc(p.x, p.y, p.r * 2.6, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    },
    varc(dt, t) {
      g.clearRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      for (const p of P) {
        p.x += p.vx * dt; p.y += Math.sin(t * 0.25 + p.ph) * 6 * dt;
        // fog drifts in from its side across the scene and fades as it reaches the middle
        const inward = p.side < 0 ? p.x / W : 1 - p.x / W; // 0 at own edge, 0.5 at the centre
        if (inward > 0.62) Object.assign(p, spawn(key, W, H, false));
        const fade = Math.max(0, 1 - inward / 0.62);
        const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        grad.addColorStop(0, `rgba(235, 238, 230, ${(p.alpha * fade).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(235, 238, 230, 0)');
        g.fillStyle = grad;
        g.fillRect(p.x - p.r, p.y - p.r, 2 * p.r, 2 * p.r);
      }
    },
    lrdi(dt, t) {
      g.clearRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      for (const p of P) {
        p.ph += dt * p.wander;
        p.vx += Math.cos(p.ph) * 12 * dt; p.vy += Math.sin(p.ph * 1.3) * 12 * dt;
        p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < -10) p.x = W + 10; if (p.x > W + 10) p.x = -10;
        if (p.y < H * 0.05) p.vy += 8 * dt; if (p.y > H * 0.95) p.vy -= 8 * dt;
        const glow = 0.35 + 0.65 * Math.max(0, Math.sin(t * p.blink + p.ph0)); // slow blink
        g.globalAlpha = glow * p.alpha;
        g.fillStyle = '#d9f58a';
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
        g.globalAlpha = glow * p.alpha * 0.3; g.fillStyle = '#b8ff6a';
        g.beginPath(); g.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    },
  }[key];

  const frame = (now) => {
    raf = 0;
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    draw(dt, now / 1000);
    raf = requestAnimationFrame(frame);
  };
  const start = () => { if (!running && visible && document.visibilityState !== 'hidden') { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } };
  const stop = () => { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; };
  const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible) start(); else stop(); }, { threshold: 0.05 });
  io.observe(scene);
  const onVis = () => (document.visibilityState === 'hidden' ? stop() : start());
  document.addEventListener('visibilitychange', onVis);
  size();
  start();
  return () => { stop(); ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVis); canvas.remove(); };
}

function spawn(key, W, H, anywhere) {
  if (key === 'quant') {
    const hot = Math.random() < 0.3;
    return { x: W * FORGE.x + rnd(-0.05, 0.05) * W, y: H * FORGE.y + (anywhere ? rnd(-0.5, 0) * H : rnd(-0.03, 0.03) * H), vx: rnd(-18, 18), vy: rnd(-70, -25), r: rnd(0.8, 2.2), life: rnd(0.8, 2.6), alpha: rnd(0.5, 1), hot, ph: rnd(0, 6.3) };
  }
  if (key === 'varc') {
    const side = Math.random() < 0.5 ? -1 : 1;
    const r = rnd(0.18, 0.32) * Math.max(W, H);
    return { side, x: side < 0 ? (anywhere ? rnd(-r, W * 0.5) : -r * 0.6) : (anywhere ? rnd(W * 0.5, W + r) : W + r * 0.6), y: rnd(0.3, 1.0) * H, vx: side * rnd(8, 18) * (W / 1000), r, alpha: rnd(0.16, 0.28), ph: rnd(0, 6.3) };
  }
  return { x: rnd(0, W), y: rnd(0.1, 0.9) * H, vx: rnd(-10, 10), vy: rnd(-6, 6), r: rnd(1.2, 2.2), alpha: rnd(0.6, 1), wander: rnd(0.6, 1.6), ph: rnd(0, 6.3), ph0: rnd(0, 6.3), blink: rnd(0.5, 1.4) };
}
