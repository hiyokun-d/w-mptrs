"use client";

// Particles and sound for the presentation. One canvas, one loop. Scenes ask
// for a mode every frame through `fx.update`; the loop eases between modes so
// nothing pops: rain fades out while the motes fade in, and so on.

/** a map element captured in screen space, for the finale's morph */
export interface Src {
  x: number;
  y: number;
  c: string;
}

export type FxMode =
  | { k: "off" }
  | { k: "drift" }
  /** amount 0…1 (≈ mm/h ÷ 20); wind in px/s, + blows right */
  | { k: "rain"; amount: number; wind?: number }
  /** data flowing from a source (a satellite) into targets */
  | {
      k: "stream";
      from: [number, number];
      to: [number, number][];
      color: string;
    }
  /**
   * the finale: map elements (vehicles, lines, rain, the search) leave their
   * places, gather into the wordmark, and later go back where they came from
   */
  | {
      k: "morph";
      text: string;
      y: number;
      src: Src[];
      phase: "gather" | "return";
    }
  | { k: "burst"; at: [number, number] };

const N = 220;
const COLORS = ["#33d6ff", "#ffffff", "#1546ff", "#7fe7ff", "#ffd400"];

export const fx = {
  mode: { k: "drift" } as FxMode,
  /** bumps on a real change of mode, so the loop can re-target */
  ver: 0,
  set(m: FxMode) {
    this.mode = m;
    this.ver++;
  },
  /** called every frame: a new kind (or a new morph phase) is a change;
   *  anything else just updates the live parameters */
  update(m: FxMode) {
    const c = this.mode;
    const changed =
      m.k !== c.k ||
      (m.k === "morph" &&
        c.k === "morph" &&
        (m.phase !== c.phase || m.text !== c.text)) ||
      (m.k === "burst" &&
        c.k === "burst" &&
        (m.at[0] !== c.at[0] || m.at[1] !== c.at[1]));
    if (changed) this.set(m);
    else this.mode = m;
  },
};

// ── rain ────────────────────────────────────────────────────────────────────

interface Drop {
  x: number;
  y: number;
  /** where it lands on screen: the map is tilted, so far ground is higher */
  ground: number;
  len: number;
  v: number;
}
interface Splash {
  x: number;
  y: number;
  age: number;
  size: number;
  /** two flying droplets */
  dx: number;
}

/** far → near: shorter, slower and fainter far away (parallax) */
const LAYERS = [
  { n: 300, len: [10, 17], v: [650, 800], a: 0.24, w: 1.4, g: [0.25, 0.75] },
  { n: 190, len: [22, 34], v: [1000, 1250], a: 0.38, w: 2, g: [0.5, 1] },
  { n: 80, len: [44, 66], v: [1500, 1900], a: 0.6, w: 2.9, g: [0.75, 1.1] },
] as const;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ── text targets for the morph ──────────────────────────────────────────────

function textTargets(text: string, w: number, h: number, y: number, n: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g || !n) return [];
  const size = Math.min((w * 0.92) / (text.length * 0.66), 210);
  g.font = `900 italic ${size}px ui-sans-serif, system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#fff";
  g.fillText(text, w / 2, y);
  const d = g.getImageData(0, 0, w, h).data;
  // pick the grid step that gives about one glyph point per particle, so
  // the letters come out solid and readable
  let ink = 0;
  for (let i = 3; i < d.length; i += 16) if (d[i] > 128) ink += 4;
  const step = Math.max(2, Math.sqrt(ink / n));
  const pts: [number, number][] = [];
  for (let yy = 0; yy < h; yy += step)
    for (let xx = 0; xx < w; xx += step) {
      const i = (Math.floor(yy) * w + Math.floor(xx)) * 4 + 3;
      if (d[i] > 128) pts.push([xx, yy]);
    }
  return pts;
}

// ── the loop ────────────────────────────────────────────────────────────────

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  u: number;
  sp: number;
  c: string;
  s: number;
}

interface M {
  x: number;
  y: number;
  vx: number;
  vy: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  c: string;
  delay: number;
}

/** Starts the particle loop on a canvas; returns a stop function. */
export function runParticles(cv: HTMLCanvasElement): () => void {
  const ctx = cv.getContext("2d");
  if (!ctx) return () => {};
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  let W = 0;
  let H = 0;
  const size = () => {
    W = cv.clientWidth;
    H = cv.clientHeight;
    cv.width = W * dpr;
    cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  window.addEventListener("resize", size);

  const ps: P[] = Array.from({ length: N }, (_, i) => ({
    x: Math.random() * W,
    y: Math.random() * H,
    vx: 0,
    vy: 0,
    u: Math.random(),
    sp: 0.2 + Math.random() * 0.6,
    c: COLORS[i % COLORS.length],
    s: 1.4 + Math.random() * 2.4,
  }));
  const drops: Drop[][] = LAYERS.map((L) =>
    Array.from({ length: L.n }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      ground: H * rnd(L.g[0], L.g[1]),
      len: rnd(L.len[0], L.len[1]),
      v: rnd(L.v[0], L.v[1]),
    })),
  );
  const splashes: Splash[] = [];
  let morph: M[] = [];
  let morphT = 0;

  // levels ease toward what the mode asks: this is the crossfade
  const lv = { drift: 0, rain: 0, stream: 0, burst: 0, morph: 0 };
  let rainAmt = 0;
  let wind = 90;
  let flash = 0;
  let nextFlash = 4;

  let ver = -1;
  let raf = 0;
  let last = performance.now();

  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const m = fx.mode;
    if (ver !== fx.ver) {
      ver = fx.ver;
      if (m.k === "burst")
        for (const p of ps) {
          const a = Math.random() * Math.PI * 2;
          const v = 120 + Math.random() * 380;
          p.x = m.at[0];
          p.y = m.at[1];
          p.vx = Math.cos(a) * v;
          p.vy = Math.sin(a) * v - 180;
          p.u = 1;
        }
      if (m.k === "morph" && m.phase === "gather") {
        const src = m.src.slice().sort((a, b) => a.x - b.x);
        const tg = textTargets(m.text, W, H, m.y, src.length).sort(
          (a, b) => a[0] - b[0],
        );
        morph = src.map((s, i) => {
          const t = tg[Math.floor((i / src.length) * tg.length)] ?? [s.x, s.y];
          return {
            x: s.x,
            y: s.y,
            vx: 0,
            vy: 0,
            sx: s.x,
            sy: s.y,
            tx: t[0],
            ty: t[1],
            c: s.c,
            // left letters lift first: a wave across the word
            delay: (t[0] / Math.max(1, W)) * 0.6 + Math.random() * 0.25,
          };
        });
        morphT = 0;
      }
      if (m.k === "morph" && m.phase === "return") morphT = 0;
    }

    const k = 1 - Math.exp(-dt / 0.45);
    const want = (key: keyof typeof lv) => (m.k === key ? 1 : 0);
    for (const key of Object.keys(lv) as (keyof typeof lv)[])
      lv[key] += (want(key) - lv[key]) * k;
    if (m.k === "rain") {
      rainAmt += (m.amount - rainAmt) * k;
      wind += ((m.wind ?? 90) - wind) * k;
    } else rainAmt *= 1 - k;

    ctx.clearRect(0, 0, W, H);
    if (m.k === "off" && lv.drift < 0.01 && rainAmt < 0.01 && lv.morph < 0.01)
      return;

    // ── rain: three depths, splashes where drops land, mist, lightning ──
    if (rainAmt > 0.005) {
      const a = Math.min(1, rainAmt);
      ctx.globalCompositeOperation = "lighter";
      LAYERS.forEach((L, li) => {
        const n = Math.floor(L.n * a);
        const ds = drops[li];
        ctx.strokeStyle = `rgba(205,228,255,${L.a * (0.55 + 0.45 * a)})`;
        ctx.lineWidth = L.w;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const d = ds[i];
          const vx = wind * (d.v / 1200);
          d.y += d.v * dt;
          d.x += vx * dt;
          if (d.y >= d.ground) {
            if (li > 0 && splashes.length < 160 && Math.random() < 0.7)
              splashes.push({
                x: d.x,
                y: d.ground,
                age: 0,
                size: li === 2 ? rnd(10, 18) : rnd(5, 10),
                dx: rnd(-1, 1),
              });
            d.y = -d.len - Math.random() * H * 0.25;
            d.x = Math.random() * (W + 200) - 100;
            d.ground = H * rnd(L.g[0], L.g[1]);
          }
          // the streak lies along its own velocity: wind slants it
          const k2 = d.len / d.v;
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - vx * k2, d.y - d.len);
        }
        ctx.stroke();
      });
      // splashes: a flat ring that spreads and fades, two droplets thrown up
      ctx.strokeStyle = "rgba(205,228,255,.5)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i];
        s.age += dt;
        const u = s.age / 0.32;
        if (u >= 1) {
          splashes.splice(i, 1);
          continue;
        }
        const r = s.size * (0.3 + u);
        ctx.moveTo(s.x + r, s.y);
        ctx.ellipse(s.x, s.y, r, r * 0.32, 0, 0, Math.PI * 2);
        for (const side of [-1, 1]) {
          const px = s.x + side * s.size * 0.9 * u + s.dx * 2;
          const py = s.y - s.size * 1.6 * u + s.size * 2.4 * u * u;
          ctx.moveTo(px + 0.8, py);
          ctx.arc(px, py, 1.5, 0, Math.PI * 2);
        }
      }
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.globalAlpha = 1;
      // mist near the ground grows with the rain
      ctx.globalCompositeOperation = "source-over";
      const mist = ctx.createLinearGradient(0, H * 0.45, 0, H);
      mist.addColorStop(0, "rgba(160,190,255,0)");
      mist.addColorStop(1, `rgba(160,190,255,${0.1 * a})`);
      ctx.fillStyle = mist;
      ctx.fillRect(0, H * 0.45, W, H * 0.55);
      // lightning, only in a real storm
      if (a > 0.75) {
        nextFlash -= dt;
        if (nextFlash <= 0) {
          flash = 1;
          nextFlash = rnd(5, 10);
        }
      }
      if (flash > 0.01) {
        // a double flicker, then a fade
        const f = flash > 0.7 ? (Math.sin(now / 18) > 0 ? 1 : 0.3) : flash;
        ctx.fillStyle = `rgba(220,235,255,${0.22 * f * a})`;
        ctx.fillRect(0, 0, W, H);
        flash *= 1 - Math.min(1, dt * 5);
      }
    }

    // ── motes, streams, bursts ──
    ctx.globalCompositeOperation = "lighter";
    const ambient = Math.max(lv.drift, lv.stream, lv.burst);
    if (ambient > 0.01)
      for (let i = 0; i < N; i++) {
        const p = ps[i];
        let a = 0;
        if (lv.drift > 0.01) {
          p.x += Math.sin(now / 2000 + i) * 6 * dt;
          p.y -= p.sp * 12 * dt;
          if (p.y < -5) p.y = H + 5;
          a = 0.22 * lv.drift;
        }
        if (m.k === "stream" && m.to.length) {
          const to = m.to[i % m.to.length];
          p.u += p.sp * 0.6 * dt;
          if (p.u > 1) p.u -= 1;
          const u = p.u;
          const mx = (m.from[0] + to[0]) / 2;
          const my = Math.min(m.from[1], to[1]) - 80;
          const sx =
            (1 - u) ** 2 * m.from[0] + 2 * (1 - u) * u * mx + u * u * to[0];
          const sy =
            (1 - u) ** 2 * m.from[1] + 2 * (1 - u) * u * my + u * u * to[1];
          // ease from wherever the mote was onto its stream
          p.x += (sx - p.x) * Math.min(1, lv.stream * 0.5 + 0.1);
          p.y += (sy - p.y) * Math.min(1, lv.stream * 0.5 + 0.1);
          a = Math.max(a, Math.sin(u * Math.PI) * 0.9 * lv.stream);
          ctx.fillStyle = m.color;
        } else ctx.fillStyle = p.c;
        if (lv.burst > 0.01 && p.u > 0) {
          p.vy += 520 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.u -= dt * 0.7;
          a = Math.max(a, Math.max(0, p.u) * lv.burst);
        }
        if (a <= 0.01) continue;
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
        ctx.fill();
      }
    ctx.globalAlpha = 1;

    // ── the morph: map elements fly into the word and back ──
    if (morph.length && (m.k === "morph" || lv.morph > 0.01)) {
      morphT += dt;
      const back = m.k !== "morph" || m.phase === "return";
      ctx.globalCompositeOperation = "source-over";
      for (const p of morph) {
        if (morphT < p.delay) {
          ctx.globalAlpha = lv.morph;
          ctx.fillStyle = p.c;
          ctx.fillRect(p.x - 1.8, p.y - 1.8, 3.6, 3.6);
          continue;
        }
        const tx = back ? p.sx : p.tx;
        const ty = back ? p.sy : p.ty;
        // a critically damped spring: quick, no wobble at the end
        p.vx += ((tx - p.x) * 38 - p.vx * 11) * dt;
        p.vy += ((ty - p.y) * 38 - p.vy * 11) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const speed = Math.hypot(p.vx, p.vy);
        ctx.globalAlpha = lv.morph;
        ctx.fillStyle = p.c;
        if (speed > 60) {
          // in flight: a short streak along the motion
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.atan2(p.vy, p.vx));
          ctx.fillRect(
            -Math.min(18, speed / 32),
            -1.7,
            Math.min(18, speed / 32) + 3.4,
            3.4,
          );
          ctx.restore();
        } else ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
      ctx.globalAlpha = 1;
      if (lv.morph < 0.02 && m.k !== "morph") morph = [];
    }
  };
  raf = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", size);
  };
}

// ── sound: synthesised, no files ───────────────────────────────────────────

let ac: AudioContext | null = null;
export const sound = { on: true };

function audio(): AudioContext | null {
  if (!sound.on || typeof window === "undefined") return null;
  ac ??= new AudioContext();
  if (ac.state === "suspended") void ac.resume();
  return ac;
}

/** filtered noise swept upward: the camera rushing in */
export function whoosh(sec = 1.1) {
  const a = audio();
  if (!a) return;
  const len = Math.floor(a.sampleRate * sec);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(180, a.currentTime);
  bp.frequency.exponentialRampToValueAtTime(3200, a.currentTime + sec * 0.7);
  bp.frequency.exponentialRampToValueAtTime(600, a.currentTime + sec);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.35, a.currentTime + sec * 0.55);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + sec);
  src.connect(bp).connect(g).connect(a.destination);
  src.start();
}

/** a soft pop when a number lands */
export function blip(freq = 880) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(freq, a.currentTime);
  o.frequency.exponentialRampToValueAtTime(freq * 1.5, a.currentTime + 0.08);
  g.gain.setValueAtTime(0.06, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.18);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + 0.2);
}
