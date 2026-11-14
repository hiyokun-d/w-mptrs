"use client";

import {
  ChevronLeft,
  ChevronRight,
  Info,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RainField, type RainGrid } from "@/lib/core/rainfield";
import { type PlanResponse, traceSearch } from "@/lib/local/planner";
import { chosen, useApp } from "@/lib/store/app";
import { drop, layer, setNight } from "../gl/layers";
import { Leaders } from "../gl/leaders";
import { useGL } from "../gl/store";
import { fx, runParticles, sound, whoosh } from "./fx";
import {
  type Ctx,
  project,
  restoreAppLayers,
  SCENES,
  SHOW_LAYERS,
  stageLayers,
} from "./scenes";

const PACES = [0.5, 1, 1.5, 2];
/** the finale's rush back to the street */
const RUSH_S = 2.6;

/**
 * "How the algorithm chose", told on the map itself: the camera flies through
 * the data, the search and the decision while captions explain and callouts
 * point at the map. Scenes run on a paced clock; paused, the camera idles in a
 * slow orbit. Drag or use the rotate buttons to look around at any time.
 */
export default function Presentation({ grid }: { grid: RainGrid | null }) {
  const app = useApp();
  const { map, fleet, set: setGL } = useGL();
  const r = app.result as PlanResponse | null;
  const it = r ? chosen(r, app.choice) : null;
  const alt = r
    ? chosen(
        r,
        app.choice === "fastest"
          ? r.shift
            ? "weatherAware"
            : "transit"
          : "fastest",
      )
    : null;

  const [scene, setScene] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [pace, setPace] = useState(1);
  const [more, setMore] = useState(false);
  const [mute, setMute] = useState(false);
  const [hudT, setHudT] = useState(0);
  const [rush, setRush] = useState(false);
  // the slash cut plays once, when the show opens
  const [opening, setOpening] = useState(true);
  const [trace, setTrace] = useState<Ctx["trace"]>(null);

  const ctx = useRef<Ctx | null>(null);
  const tRef = useRef(0);
  const sceneRef = useRef(0);
  const entered = useRef(-1);
  const playRef = useRef(true);
  const paceRef = useRef(1);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const cur = useRef<[number, number]>([innerWidth / 2, innerHeight / 2]);
  const closing = useRef(false);
  const bar = useRef<HTMLSpanElement>(null);
  /** last time the viewer touched the map: the orbit waits for them */
  const lastUser = useRef(0);
  const leaders = useMemo(() => {
    const l = new Leaders();
    // keep callouts clear of the title, the caption and the controls
    l.safe = { top: 84, bottom: 178, left: 12, right: 12 };
    return l;
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setOpening(false), 1100);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    if (!map) return;
    leaders.attach(map);
    const touch = () => {
      lastUser.current = performance.now();
    };
    map.on("mousedown", touch);
    map.on("touchstart", touch);
    map.on("wheel", touch);
    return () => {
      leaders.detach();
      map.off("mousedown", touch);
      map.off("touchstart", touch);
      map.off("wheel", touch);
    };
  }, [map, leaders]);

  useEffect(() => {
    playRef.current = playing;
  }, [playing]);
  useEffect(() => {
    paceRef.current = pace;
    if (ctx.current) ctx.current.pace = pace;
  }, [pace]);
  useEffect(() => {
    sound.on = !mute;
  }, [mute]);

  // the search replay: run the router once more on this device, with a trace
  useEffect(() => {
    if (!r || !app.from || !app.to) return;
    const field = new RainField(grid, r.cells, r.depart);
    traceSearch(app.from, app.to, r.depart, r.params.beta, field).then((x) => {
      if (x) setTrace({ trace: x.trace, ms: x.ms, relaxed: x.relaxed });
    });
  }, [r, app.from, app.to, grid]);

  // the stage: night city, glowing 3D buildings, every vehicle
  useEffect(() => {
    if (!map) return;
    setNight(map, 1);
    if (!map.getSource("openmaptiles")) return;
    layer(
      map,
      {
        id: "s-bld",
        type: "fill-extrusion",
        source: "openmaptiles",
        "source-layer": "building",
        // 3D only up close: far out it costs frames and says nothing
        minzoom: 14,
        paint: {
          "fill-extrusion-color": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "render_height"], 0],
            0,
            "#0c4a6e",
            40,
            "#0369a1",
            120,
            "#38bdf8",
          ],
          "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.8,
        },
      },
      "w-route-case",
    );
    setGL({ fleetMode: "off", follow: null });
  }, [map, setGL]);

  useEffect(() => {
    if (!canvas.current) return;
    return runParticles(canvas.current);
  }, []);

  if (map && r && it && !ctx.current)
    ctx.current = {
      map,
      r,
      it,
      alt,
      fleet,
      grid,
      field: new RainField(grid, r.cells, r.depart),
      lang: app.lang,
      trace,
      pace,
      leaders,
      cache: new Map(),
    };
  if (ctx.current) {
    ctx.current.trace = trace;
    ctx.current.leaders = leaders;
    ctx.current.fleet = fleet;
    ctx.current.lang = app.lang;
  }

  /** leave: restore the day map and land on your route's next vehicle */
  const finish = useCallback(() => {
    const c = ctx.current;
    if (c) {
      drop(c.map, SHOW_LAYERS);
      setNight(c.map, 0);
      restoreAppLayers(c.map);
    }
    fx.set({ k: "off" });
    const ride = c?.it.legs.find((g) => g.kind === "ride" && g.trip);
    const next =
      c?.fleet && ride?.trip
        ? c.fleet.arrivals(
            Date.now(),
            c.fleet.serving(ride.trip.board, ride.trip.alight),
            3600,
            1,
          )[0]
        : undefined;
    setGL({ stage: false, fleetMode: "auto", follow: next?.id ?? null });
  }, [setGL]);

  /** the finale's dive: blur, rush of air, fast fly to the street */
  const dive = useCallback(() => {
    const c = ctx.current;
    if (!c || closing.current) return;
    closing.current = true;
    setRush(true);
    whoosh(1.3);
    const ride = c.it.legs.find((g) => g.kind === "ride") ?? c.it.legs[0];
    const at = ride ? [ride.from.lng, ride.from.lat] : [106.83, -6.2];
    c.map.flyTo({
      center: at as [number, number],
      zoom: 16.4,
      pitch: 62,
      bearing: c.map.getBearing() + 140,
      duration: 1300,
      curve: 1.9,
      essential: true,
    });
    setTimeout(() => setRush(false), 1050);
    setTimeout(finish, 1500);
  }, [finish]);

  const go = useCallback((i: number) => {
    const n = Math.max(0, Math.min(SCENES.length - 1, i));
    sceneRef.current = n;
    tRef.current = 0;
    entered.current = -1;
    setScene(n);
  }, []);

  // the clock: one loop drives camera hooks, the pointer, particles, HUD
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastHud = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const c = ctx.current;
      if (!c) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = SCENES[sceneRef.current];
      if (entered.current !== sceneRef.current) {
        entered.current = sceneRef.current;
        // one scene failing must not stop the show
        try {
          s.enter?.(c);
          // layers of the last scene fade out, this scene's fade in
          stageLayers(c, s.layers);
        } catch (e) {
          console.warn("[show]", s.id, e);
        }
      }
      if (playRef.current) tRef.current += dt * paceRef.current;
      // a slow orbit once the camera has landed: the scene's own while
      // playing, an idle one while paused; never while you're looking around
      const orbit = playRef.current ? (s.orbit ?? 0) * paceRef.current : 1.5;
      if (orbit && !c.map.isMoving() && now - lastUser.current > 4000)
        c.map.setBearing(c.map.getBearing() + dt * orbit);
      const t = tRef.current;
      if (playRef.current)
        try {
          s.frame?.(c, t);
        } catch (e) {
          console.warn("[show]", s.id, e);
        }

      try {
        fx.update(s.fx?.(c, t) ?? { k: "drift" });
      } catch (e) {
        console.warn("[show fx]", s.id, e);
      }

      // callouts follow the map even when it stands still (panels animate,
      // lists reorder); about ten boxes, so every frame is cheap
      c.leaders.place();

      const target = s.cursor?.(c, t);
      const el = cursor.current;
      if (el) {
        if (target) {
          const [x, y] = project(c, target);
          const k = Math.min(1, dt * 5);
          cur.current = [
            cur.current[0] + (x - cur.current[0]) * k,
            cur.current[1] + (y - cur.current[1]) * k,
          ];
          el.style.opacity = "1";
          el.style.transform = `translate(${cur.current[0]}px, ${cur.current[1]}px)`;
        } else el.style.opacity = "0";
      }

      const D = s.dur(c);
      if (bar.current)
        bar.current.style.width = `${Math.min(100, (t / D) * 100)}%`;
      if (s.id === "finale" && t > D - RUSH_S) dive();
      else if (t >= D && sceneRef.current < SCENES.length - 1) {
        sceneRef.current++;
        tRef.current = 0;
        setScene(sceneRef.current);
      }
      // the HUD re-renders 10× a second; callouts and counters move on their
      // own, so this only decides what is shown
      if (now - lastHud > 100) {
        lastHud = now;
        setHudT(t);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [dive]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowRight") go(sceneRef.current + 1);
      else if (e.key === "ArrowLeft") go(sceneRef.current - 1);
      else if (e.key === "Escape") dive();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [go, dive]);

  const c = ctx.current;
  const s = SCENES[scene];
  const lines = c ? s.lines(c) : [];
  const D = c ? s.dur(c) : 1;
  const cues = c && s.cues ? s.cues(c) : null;
  const li = cues
    ? Math.max(0, cues.filter((x) => x <= hudT).length - 1)
    : Math.max(
        0,
        Math.min(lines.length - 1, Math.floor((hudT / D) * lines.length)),
      );
  const line = lines[li] ?? "";
  const id = (en: string, idn: string) => (app.lang === "id" ? idn : en);

  return (
    <div className="pointer-events-none fixed inset-0 z-[900] text-white">
      {/* the map is the stage: a deep-water vignette frames it */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(5,11,46,.8))]" />

      {/* opening: two blades cut across on the diagonal, once */}
      <AnimatePresence>
        {opening && (
          <motion.div
            key="cut"
            className="absolute inset-0 overflow-hidden"
            exit={{ opacity: 0 }}
          >
            {[
              ["#1546ff", 0, "70%"],
              ["#33d6ff", 0.07, "22%"],
            ].map(([bg, d, w]) => (
              <motion.div
                key={bg as string}
                className="absolute top-[-20%] h-[140%] -skew-x-[18deg]"
                style={{ background: bg as string, width: w as string }}
                initial={{ x: "-120vw" }}
                animate={{ x: "160vw" }}
                transition={{
                  duration: 0.75,
                  delay: d as number,
                  ease: [0.7, 0, 0.25, 1],
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* rush: speed lines and blur while diving back to the street */}
      <AnimatePresence>
        {rush && (
          <motion.div
            key="rush"
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 1.4 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.35 }}
            style={{
              background:
                "repeating-conic-gradient(from 0deg, rgba(255,255,255,.22) 0deg 0.6deg, transparent 0.6deg 7deg)",
              maskImage: "radial-gradient(circle, transparent 18%, black 70%)",
              WebkitMaskImage:
                "radial-gradient(circle, transparent 18%, black 70%)",
              backdropFilter: "blur(7px)",
            }}
          />
        )}
      </AnimatePresence>

      {/* scene title: a big index, a cyan blade, the name */}
      <div className="absolute top-4 left-4 sm:top-6 sm:left-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={s.id}
            className="flex items-end gap-3"
            exit={{
              opacity: 0,
              x: 40,
              transition: { duration: 0.15, ease: [0.4, 0, 1, 1] },
            }}
          >
            <motion.span
              initial={{ y: 30, opacity: 0, rotate: -8 }}
              animate={{ y: 0, opacity: 1, rotate: 0 }}
              transition={{
                type: "spring",
                stiffness: 380,
                damping: 18,
                delay: 0.25,
              }}
              className="text-5xl leading-none font-black text-transparent italic tabular-nums sm:text-6xl"
              style={{ WebkitTextStroke: "2px #33d6ff" }}
            >
              {String(scene + 1).padStart(2, "0")}
            </motion.span>
            <div>
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{
                  duration: 0.35,
                  delay: 0.3,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="mb-1 h-1.5 w-16 origin-left -skew-x-12 bg-[#33d6ff]"
              />
              <div className="overflow-hidden">
                <motion.div
                  initial={{ y: "110%" }}
                  animate={{ y: 0 }}
                  transition={{
                    duration: 0.45,
                    delay: 0.36,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className="text-xl font-black tracking-tight uppercase italic drop-shadow-[3px_3px_0_#1546ff] sm:text-2xl"
                >
                  {c ? s.title(c) : ""}
                </motion.div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {c && s.Hud && (
        <AnimatePresence mode="wait">
          <motion.div
            key={s.id}
            className="absolute inset-0"
            exit={{
              opacity: 0,
              x: 30,
              transition: { duration: 0.18, ease: [0.4, 0, 1, 1] },
            }}
          >
            <s.Hud c={c} t={hudT} />
          </motion.div>
        </AnimatePresence>
      )}

      {/* particles over the HUD: they gather into the wordmark */}
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />

      {/* the pointer that "presents" */}
      <div
        ref={cursor}
        className="absolute top-0 left-0 opacity-0 transition-opacity duration-300"
      >
        <span className="absolute -top-3 -left-3 size-6 animate-ping bg-[#33d6ff]/40 [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]" />
        <svg
          width="22"
          height="26"
          viewBox="0 0 22 26"
          className="drop-shadow-[3px_3px_0_#1546ff]"
        >
          <title>Pointer</title>
          <path
            d="M1 1 L1 21 L6.5 16 L10 24.5 L13.5 23 L10 15 L17.5 15 Z"
            fill="#fff"
            stroke="#050b2e"
            strokeWidth="1.5"
          />
        </svg>
      </div>

      {/* the caption: one sentence at a time, words rising in */}
      <div className="absolute bottom-[92px] left-3 max-w-[min(94vw,36rem)] sm:left-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={playing ? `${s.id}-${li}` : "paused"}
            initial={{
              x: -50,
              opacity: 0,
              clipPath: "polygon(0 0, 0 0, -10% 100%, -10% 100%)",
            }}
            animate={{
              x: 0,
              opacity: 1,
              clipPath: "polygon(0 0, 110% 0, 100% 100%, -10% 100%)",
            }}
            exit={{
              x: 40,
              opacity: 0,
              transition: { duration: 0.16, ease: [0.4, 0, 1, 1] },
            }}
            transition={{
              x: { type: "spring", stiffness: 380, damping: 26 },
              clipPath: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
              opacity: { duration: 0.1 },
            }}
            className="slant px-4 py-2.5 text-[#050b2e] [--sl-sh:8px_8px_0_#1546ff]"
          >
            <div className="text-[15px] leading-snug font-semibold">
              {playing ? (
                line.split(" ").map((w, i) => (
                  <span
                    key={`${i}-${w}`}
                    className="inline-block overflow-hidden align-bottom"
                  >
                    <motion.span
                      className="inline-block"
                      initial={{ y: "105%" }}
                      animate={{ y: 0 }}
                      transition={{
                        duration: 0.32,
                        delay: (0.12 + i * 0.03) / pace,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                    >
                      {w}&nbsp;
                    </motion.span>
                  </span>
                ))
              ) : (
                <span className="font-black tracking-widest uppercase italic">
                  {id("Paused · take your time", "Dijeda · santai saja")}
                </span>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* more detail for the curious */}
      <AnimatePresence>
        {more && c && s.more && (
          <motion.div
            key={`more-${s.id}`}
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 60, transition: { duration: 0.16 } }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="pointer-events-auto absolute right-4 bottom-[92px] max-w-sm border-l-4 border-[#33d6ff] bg-[#050b2e]/92 p-4 text-sm text-slate-100 shadow-[8px_8px_0_rgba(21,70,255,.55)]"
          >
            {s.more(c)}
          </motion.div>
        )}
      </AnimatePresence>

      {/* controls */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-0 px-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-2 flex max-w-2xl gap-1">
          {SCENES.map((x, i) => (
            <button
              key={x.id}
              type="button"
              aria-label={c ? x.title(c) : x.id}
              title={c ? x.title(c) : x.id}
              onClick={() => go(i)}
              className="relative h-2 flex-1 -skew-x-[30deg] overflow-hidden bg-white/15"
            >
              <span
                ref={i === scene ? bar : undefined}
                className="absolute inset-y-0 left-0 bg-[#33d6ff]"
                style={{
                  width: i < scene ? "100%" : i > scene ? "0%" : undefined,
                }}
              />
            </button>
          ))}
        </div>
        <div className="mx-auto flex max-w-2xl items-center gap-1.5 bg-[#050b2e]/85 p-1.5 shadow-[6px_6px_0_rgba(21,70,255,.5)] backdrop-blur-md">
          <button
            type="button"
            aria-label={id("Previous", "Sebelumnya")}
            onClick={() => go(scene - 1)}
            className="p-2 hover:bg-white/10"
          >
            <ChevronLeft className="size-4" />
          </button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.88 }}
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => setPlaying((p) => !p)}
            className="slant flex h-9 w-12 items-center justify-center text-[#050b2e]"
          >
            <span>
              {playing ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
            </span>
          </motion.button>
          <button
            type="button"
            aria-label={id("Next", "Berikutnya")}
            onClick={() => go(scene + 1)}
            className="p-2 hover:bg-white/10"
          >
            <ChevronRight className="size-4" />
          </button>
          <div className="ml-1 flex">
            {PACES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPace(p)}
                className="relative px-2.5 py-1 text-xs font-black italic tabular-nums"
              >
                {pace === p && (
                  <motion.span
                    layoutId="show-pace"
                    transition={{ type: "spring", stiffness: 500, damping: 32 }}
                    className="slant absolute inset-0 [--sl-bg:#1546ff]"
                  />
                )}
                <span className="relative">{p}×</span>
              </button>
            ))}
          </div>
          <div className="flex-1" />
          {(
            [
              [-45, RotateCcw, id("Rotate left", "Putar kiri")],
              [45, RotateCw, id("Rotate right", "Putar kanan")],
            ] as const
          ).map(([d, Icon, label]) => (
            <motion.button
              key={d}
              type="button"
              whileTap={{ scale: 0.85 }}
              aria-label={label}
              title={label}
              onClick={() => {
                lastUser.current = performance.now();
                map?.easeTo({
                  bearing: map.getBearing() + d,
                  duration: 650,
                  easing: (x) => 1 - (1 - x) ** 3,
                });
              }}
              className="p-2 hover:bg-white/10"
            >
              <Icon className="size-4" />
            </motion.button>
          ))}
          <button
            type="button"
            aria-pressed={more}
            disabled={!s.more}
            onClick={() => setMore((m) => !m)}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold uppercase italic disabled:opacity-30 ${more ? "bg-white text-[#050b2e]" : "hover:bg-white/10"}`}
          >
            <Info className="size-3.5" />{" "}
            <span className="hidden sm:inline">{id("More", "Detail")}</span>
          </button>
          <button
            type="button"
            aria-label={mute ? "Sound on" : "Mute"}
            onClick={() => setMute((m) => !m)}
            className="p-2 hover:bg-white/10"
          >
            {mute ? (
              <VolumeX className="size-4" />
            ) : (
              <Volume2 className="size-4" />
            )}
          </button>
          <button
            type="button"
            aria-label={id("Close", "Tutup")}
            onClick={dive}
            className="p-2 hover:bg-white/10"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
