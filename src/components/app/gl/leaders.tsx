"use client";

import type { Map as GLMap } from "maplibre-gl";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useLayoutEffect, useRef } from "react";

// Callouts: an info box tied to a point on the map by a leader line, so the
// box always says which place it is about. Positions are written straight to
// the DOM on every map render (no React re-render), so they stay glued to the
// map while the camera flies, rotates and tilts.

interface Entry {
  at: [number, number];
  dx: number;
  dy: number;
  box: HTMLDivElement;
  path: SVGPathElement;
  dot: HTMLDivElement;
  /** a tether: the box is a fixed element (a panel row), not moved */
  fixed?: () => HTMLElement | null;
}

export class Leaders {
  private items = new Set<Entry>();
  private map: GLMap | null = null;
  /** screen margins the boxes stay out of (top bar, sheet, controls) */
  safe = { top: 8, bottom: 8, left: 8, right: 8 };
  private onRender = () => this.place();

  attach(map: GLMap) {
    if (this.map === map) return;
    this.detach();
    this.map = map;
    map.on("render", this.onRender);
    map.on("resize", this.onRender);
  }
  detach() {
    this.map?.off("render", this.onRender);
    this.map?.off("resize", this.onRender);
    this.map = null;
  }
  add(e: Entry) {
    this.items.add(e);
    this.place();
  }
  remove(e: Entry) {
    this.items.delete(e);
  }

  place() {
    const map = this.map;
    if (!map) return;
    const W = map.getContainer().clientWidth;
    const H = map.getContainer().clientHeight;
    const s = this.safe;
    // boxes already placed this pass: later ones step out of their way
    const taken: { l: number; t: number; w: number; h: number }[] = [];
    for (const e of this.items) {
      const p = map.project(e.at);
      const gone = p.x < -30 || p.x > W + 30 || p.y < -30 || p.y > H + 30;
      e.box.style.visibility = gone ? "hidden" : "visible";
      e.dot.style.visibility = gone ? "hidden" : "visible";
      if (gone) {
        e.path.setAttribute("d", "");
        continue;
      }
      if (e.fixed) {
        const r = e.fixed()?.getBoundingClientRect();
        if (!r || !r.width) {
          e.path.setAttribute("d", "");
          continue;
        }
        const right = p.x > r.left + r.width / 2;
        const bx = right ? r.right : r.left;
        const by = r.top + r.height / 2;
        const ex = bx + (right ? 18 : -18);
        e.path.setAttribute(
          "d",
          `M${p.x.toFixed(1)} ${p.y.toFixed(1)}L${ex.toFixed(1)} ${by.toFixed(1)}L${bx.toFixed(1)} ${by.toFixed(1)}`,
        );
        e.dot.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        continue;
      }
      const w = e.box.offsetWidth;
      const h = e.box.offsetHeight;
      // prefer the asked side; flip when the box would leave the screen
      let side = e.dx >= 0 ? 1 : -1;
      if (side > 0 && p.x + e.dx + w > W - s.right && p.x - e.dx - w > s.left)
        side = -1;
      else if (side < 0 && p.x - Math.abs(e.dx) - w < s.left)
        side = p.x + Math.abs(e.dx) + w < W - s.right ? 1 : side;
      let dy = e.dy;
      if (p.y + dy - h / 2 < s.top && p.y - dy + h / 2 < H - s.bottom) dy = -dy;
      else if (p.y + dy + h / 2 > H - s.bottom && p.y - dy - h / 2 > s.top)
        dy = -dy;
      const ax = p.x + side * Math.abs(e.dx);
      let left = side > 0 ? ax : ax - w;
      let top = p.y + dy - h / 2;
      left = Math.max(s.left, Math.min(W - s.right - w, left));
      top = Math.max(s.top, Math.min(H - s.bottom - h, top));
      if (e.box.style.visibility !== "hidden" && w && h) {
        for (let pass = 0; pass < 4; pass++) {
          const o = taken.find(
            (r) =>
              left < r.l + r.w + 6 &&
              left + w + 6 > r.l &&
              top < r.t + r.h + 6 &&
              top + h + 6 > r.t,
          );
          if (!o) break;
          // below it if there is room, else above it
          const below = o.t + o.h + 8;
          top = below + h <= H - s.bottom ? below : o.t - h - 8;
          top = Math.max(s.top, Math.min(H - s.bottom - h, top));
        }
        if (e.box.firstElementChild) taken.push({ l: left, t: top, w, h });
      }
      const bx = side > 0 ? left : left + w;
      const by = top + h / 2;
      // a diagonal from the point, then a short level run into the box
      const ex = bx - side * 18;
      e.path.setAttribute(
        "d",
        `M${p.x.toFixed(1)} ${p.y.toFixed(1)}L${ex.toFixed(1)} ${by.toFixed(1)}L${bx.toFixed(1)} ${by.toFixed(1)}`,
      );
      e.box.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
      e.dot.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    }
  }
}

export function Leader({
  scope,
  at,
  dx = 56,
  dy = -46,
  show = true,
  delay = 0,
  color = "#ffffff",
  children,
}: {
  scope: Leaders;
  /** [lng, lat] */
  at: [number, number];
  dx?: number;
  dy?: number;
  show?: boolean;
  delay?: number;
  color?: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const entry = useRef<Entry | null>(null);

  // registered once per scope; the props are copied in on every render below
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useLayoutEffect(() => {
    if (!box.current || !path.current || !dot.current) return;
    const e: Entry = {
      at,
      dx,
      dy,
      box: box.current,
      path: path.current,
      dot: dot.current,
    };
    entry.current = e;
    scope.add(e);
    return () => {
      scope.remove(e);
      entry.current = null;
    };
  }, [scope]);
  useLayoutEffect(() => {
    const e = entry.current;
    if (!e) return;
    e.at = at;
    e.dx = dx;
    e.dy = dy;
  });

  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        aria-hidden
      >
        <title>Leader line</title>
        <motion.path
          ref={path}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          style={{ filter: "drop-shadow(2px 2px 0 rgba(21,70,255,.8))" }}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: show ? 1 : 0, opacity: show ? 1 : 0 }}
          transition={{
            pathLength: {
              duration: 0.45,
              delay: show ? delay : 0,
              ease: [0.16, 1, 0.3, 1],
            },
            opacity: { duration: 0.2, delay: show ? delay : 0.25 },
          }}
        />
      </svg>
      <div
        ref={dot}
        className="pointer-events-none absolute top-0 left-0"
        style={{ visibility: "hidden" }}
      >
        <motion.div
          className="-mt-[5px] -ml-[5px] size-2.5 rotate-45 border-2 border-white bg-[#33d6ff] shadow-[2px_2px_0_#1546ff]"
          initial={{ scale: 0 }}
          animate={{ scale: show ? 1 : 0 }}
          transition={{
            type: "spring",
            stiffness: 500,
            damping: 20,
            delay: show ? delay : 0.2,
          }}
        />
      </div>
      <div
        ref={box}
        className="pointer-events-none absolute top-0 left-0"
        style={{ visibility: "hidden" }}
      >
        <AnimatePresence>
          {show && (
            <motion.div
              initial={{
                opacity: 0,
                x: dx >= 0 ? -24 : 24,
                clipPath: "polygon(0 0, 0 0, -20% 100%, -20% 100%)",
              }}
              animate={{
                opacity: 1,
                x: 0,
                clipPath: "polygon(0 0, 120% 0, 100% 100%, -20% 100%)",
              }}
              exit={{
                opacity: 0,
                x: dx >= 0 ? 16 : -16,
                transition: { duration: 0.18, ease: [0.4, 0, 1, 1] },
              }}
              transition={{
                x: {
                  type: "spring",
                  stiffness: 420,
                  damping: 24,
                  delay: delay + 0.18,
                },
                clipPath: {
                  duration: 0.34,
                  ease: [0.16, 1, 0.3, 1],
                  delay: delay + 0.18,
                },
                opacity: { duration: 0.12, delay: delay + 0.18 },
              }}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

/** the standard callout card: white, skewed, a hard blue shadow */
export function Card({
  label,
  children,
  sub,
  tone = "light",
}: {
  label?: ReactNode;
  children: ReactNode;
  sub?: ReactNode;
  tone?: "light" | "dark" | "gold";
}) {
  const skin =
    tone === "dark"
      ? "[--sl-bg:rgba(5,11,46,.92)] text-white [--sl-sh:5px_5px_0_rgba(21,70,255,.7)]"
      : tone === "gold"
        ? "[--sl-bg:#ffd400] text-[#050b2e] [--sl-sh:5px_5px_0_#050b2e]"
        : "[--sl-bg:#fff] text-[#050b2e] [--sl-sh:5px_5px_0_#1546ff]";
  return (
    <div className={`slant [--sl-k:-10deg] px-3 py-1.5 ${skin}`}>
      <div className="max-w-[15rem]">
        {label && (
          <div
            className={`text-[10px] font-black tracking-[0.18em] uppercase ${tone === "light" ? "text-[#1546ff]" : tone === "gold" ? "text-[#050b2e]/70" : "text-[#33d6ff]"}`}
          >
            {label}
          </div>
        )}
        <div className="text-sm leading-tight font-black">{children}</div>
        {sub && (
          <div
            className={`mt-0.5 text-[11px] leading-snug font-semibold ${tone === "dark" ? "text-slate-300" : "text-[#050b2e]/70"}`}
          >
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

/** a line from a fixed element (a list row) to the place it stands for */
export function Tether({
  scope,
  at,
  to,
  show = true,
  color = "#ffd400",
}: {
  scope: Leaders;
  at: [number, number];
  to: () => HTMLElement | null;
  show?: boolean;
  color?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const entry = useRef<Entry | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: registered once per scope
  useLayoutEffect(() => {
    if (!box.current || !path.current || !dot.current) return;
    const e: Entry = {
      at,
      dx: 0,
      dy: 0,
      box: box.current,
      path: path.current,
      dot: dot.current,
      fixed: to,
    };
    entry.current = e;
    scope.add(e);
    return () => scope.remove(e);
  }, [scope]);
  useLayoutEffect(() => {
    const e = entry.current;
    if (!e) return;
    e.at = at;
    e.fixed = to;
  });
  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        aria-hidden
      >
        <title>Leader line</title>
        <motion.path
          ref={path}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeDasharray="5 4"
          initial={{ opacity: 0 }}
          animate={{ opacity: show ? 0.95 : 0 }}
          transition={{ duration: 0.3 }}
        />
      </svg>
      <div
        ref={dot}
        className="pointer-events-none absolute top-0 left-0"
        style={{ visibility: "hidden" }}
      >
        <motion.div
          className="-mt-2 -ml-2 size-4 rounded-full border-2"
          style={{ borderColor: color }}
          initial={{ scale: 0 }}
          animate={{ scale: show ? [1.8, 1] : 0, opacity: show ? 1 : 0 }}
          transition={{ duration: 0.4 }}
        />
      </div>
      <div ref={box} className="hidden" />
    </>
  );
}
