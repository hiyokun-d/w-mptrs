"use client";

import {
  ArrowDownUp,
  ArrowLeft,
  CloudLightning,
  CloudRain,
  Layers,
  Radar,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useDragControls,
} from "motion/react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { BRAND } from "@/lib/brand";
import type { RainGrid } from "@/lib/core/rainfield";
import { RainField } from "@/lib/core/rainfield";
import type { Point } from "@/lib/core/router";
import { defaultLang, t } from "@/lib/i18n";
import { db, getPref } from "@/lib/local/db";
import { flushLog, planTrip, refreshCaches } from "@/lib/local/planner";
import { type Field, type Prefs, useApp } from "@/lib/store/app";
import { useNotes } from "@/lib/store/notify";
import { clock } from "./format";
import { useGL, webglOK } from "./gl/store";
import { HowItWorks } from "./HowItWorks";
import { LoadingPipeline } from "./LoadingPipeline";
import { rise, Signature, sheetSwap, spring, stagger } from "./motion";
import { PlaceSearch } from "./PlaceSearch";
import { Results } from "./Results";
import { SettingsView } from "./SettingsView";
import { SheetPeek } from "./SheetPeek";
import { SimMenu } from "./SimMenu";
import { SCENARIO_META } from "./scenario-meta";
import { HOME_DEMOS, presetState } from "./sim-presets";
import { Inbox, Toasts } from "./Toasts";
import { TripView } from "./TripView";
import { predictionNote } from "./tripNotes";

// both maps touch `window`, so they only render in the browser. MapLibre
// (3D, every vehicle) is the main map; Leaflet is the fallback without WebGL.
const mapLoading = () => (
  <div className="h-full w-full animate-pulse bg-slate-200 dark:bg-slate-800" />
);
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: mapLoading,
});
const Presentation = dynamic(() => import("./show/Presentation"), {
  ssr: false,
});
const StoryStudio = dynamic(() => import("./story/StoryStudio"), {
  ssr: false,
});
const MapGL = dynamic(() => import("./gl/MapGL"), {
  ssr: false,
  loading: mapLoading,
});

const RAIN_REFRESH_MS = 10 * 60_000;

/** Trips that show the model off well, one tap from the home sheet. */
const EXAMPLES: { from: Point; to: Point }[] = [
  {
    from: { lat: -6.243312, lng: 106.80175, name: "Blok M" },
    to: { lat: -6.1766, lng: 106.823, name: "Monas" },
  },
  {
    from: { lat: -6.2361, lng: 106.9994, name: "Stasiun Bekasi" },
    to: { lat: -6.2025, lng: 106.8233, name: "Stasiun Sudirman" },
  },
  {
    from: { lat: -6.201811, lng: 106.78265, name: "Binus University" },
    to: { lat: -6.190162, lng: 106.80656, name: "Petamburan" },
  },
  {
    from: { lat: -6.5952, lng: 106.7906, name: "Stasiun Bogor" },
    to: { lat: -6.21, lng: 106.8503, name: "Manggarai" },
  },
];

async function loadGrid(): Promise<RainGrid | null> {
  try {
    const res = await fetch("/api/rain", {
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return (await res.json()) as RainGrid;
  } catch {
    // offline: use the last grid this device saw
  }
  const blob = await db.blobs.get("rain").catch(() => undefined);
  return blob ? (JSON.parse(blob.data) as RainGrid) : null;
}

/** "lat,lng,name" from a shared link */
function parsePoint(s: string | null): Point | null {
  if (!s) return null;
  const [lat, lng, ...name] = s.split(",");
  const p = {
    lat: Number(lat),
    lng: Number(lng),
    name: name.join(",") || undefined,
  };
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) ? p : null;
}

export function AppShell() {
  const app = useApp();
  const {
    lang,
    from,
    to,
    sheet,
    result,
    loading,
    error,
    set,
    rainLayer,
    radarLayer,
    rainOffsetMin,
    trip,
    pickOnMap,
    moto,
    scenario,
    depart,
    vot,
    maxOjek,
  } = app;
  const [grid, setGrid] = useState<RainGrid | null>(null);
  const gridRef = useRef<RainGrid | null>(null);
  const [glOn, setGlOn] = useState<boolean | null>(null);
  useEffect(() => {
    setGlOn(webglOK() && !new URLSearchParams(location.search).has("leaflet"));
  }, []);
  useEffect(() => {
    gridRef.current = grid;
  }, [grid]);
  const [now, setNow] = useState(() => Date.now());
  const [tripPos, setTripPos] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const dragCtl = useDragControls();
  const dragged = useRef(false);
  const collapsed = useApp((s) => s.collapsed);

  // the map frames routes above the sheet, so it needs the sheet's height
  const sheetRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      const ro = new ResizeObserver(() => {
        const h = Math.round(el.offsetHeight / 10) * 10;
        if (Math.abs(h - useApp.getState().sheetPx) >= 10) set({ sheetPx: h });
      });
      ro.observe(el);
      return () => ro.disconnect();
    },
    [set],
  );

  // prefs live in Dexie; load them (and a shared link) before the first plan
  useEffect(() => {
    (async () => {
      const keys: (keyof Prefs)[] = [
        "lang",
        "beta",
        "moto",
        "scenario",
        "rainLayer",
        "radarLayer",
        "vot",
        "maxOjek",
      ];
      const defaults: Prefs = {
        lang: defaultLang(),
        beta: 1,
        moto: "ojek",
        scenario: "live",
        rainLayer: true,
        radarLayer: false,
        vot: 500,
        maxOjek: 0,
      };
      const loaded = Object.fromEntries(
        await Promise.all(
          keys.map(async (k) => [
            k,
            await getPref(k, defaults[k]).catch(() => defaults[k]),
          ]),
        ),
      );
      const q = new URLSearchParams(location.search);
      const f = parsePoint(q.get("from"));
      const to = parsePoint(q.get("to"));
      set({
        ...(loaded as Partial<Prefs>),
        ...(f && to ? { from: f, to } : {}),
      });
      if (f && to) history.replaceState(null, "", "/");
      setReady(true);
    })();
  }, [set]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // rain grid now and every 10 minutes; clock ticks every 30 s
  useEffect(() => {
    let alive = true;
    const pull = () => loadGrid().then((g) => alive && g && setGrid(g));
    void pull();
    const a = setInterval(pull, RAIN_REFRESH_MS);
    const b = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  // offline caches and the research log queue
  useEffect(() => {
    void refreshCaches();
    void flushLog();
    const online = () => {
      void flushLog();
      void refreshCaches();
    };
    window.addEventListener("online", online);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {});
    }
    return () => window.removeEventListener("online", online);
  }, []);

  const run = useCallback(
    async (b?: number) => {
      const s = useApp.getState();
      if (!s.from || !s.to) return;
      set({ loading: true, error: null });
      try {
        const r = await planTrip({
          from: s.from,
          to: s.to,
          depart: s.depart ?? undefined,
          beta: b ?? s.beta,
          moto: s.moto,
          scenario: s.scenario,
          vot: s.vot,
          maxOjek: s.maxOjek,
          reports: s.reports,
        });
        const keep = useApp.getState().sheet === "how" ? "how" : "results";
        const pick = r.shift ? r.weatherAware : r.fastest;
        const st = useApp.getState();
        if (pick)
          useNotes
            .getState()
            .push(
              predictionNote(
                pick,
                new RainField(gridRef.current, r.cells, r.depart),
                st.lang,
              ),
            );
        set({
          result: r,
          loading: false,
          sheet: keep,
          choice: r.shift ? "weatherAware" : "fastest",
        });
      } catch (e) {
        set({
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [set],
  );

  // plan as soon as both ends are set, and again when a routing input changes;
  // beta re-plans through Results' onReplan
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-plan only on these inputs
  useEffect(() => {
    if (ready && from && to && !trip) void run();
  }, [ready, from, to, moto, scenario, depart, vot, maxOjek]);

  const edit = (f: Field) => set({ editing: f, sheet: "search" });
  const onTime = useCallback((t: number | null) => setTripPos(t), []);
  const shownTime = tripPos ?? now + rainOffsetMin * 60_000;
  const stage = useGL((s) => s.stage);
  const story = useGL((s) => s.story);
  const sheetPx = useApp((s) => s.sheetPx);
  const showTop = sheet !== "trip" && sheet !== "how" && !stage;

  // which view the sheet shows; the key drives the swap animation
  const view =
    sheet === "settings"
      ? "settings"
      : sheet === "trip"
        ? "trip"
        : sheet === "how" && result
          ? "how"
          : loading
            ? "loading"
            : error
              ? "error"
              : result && sheet === "results"
                ? "results"
                : "home";

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative h-dvh w-full overflow-hidden bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="absolute inset-0 z-0">
          {glOn === null ? null : glOn ? (
            <MapGL grid={grid} now={now} tripPos={tripPos} />
          ) : (
            <MapView grid={grid} now={now} tripPos={tripPos} />
          )}
        </div>

        {stage && <Presentation grid={grid} />}
        {story && <StoryStudio grid={grid} />}
        {!stage && (
          <Toasts
            // during a trip the alert banner holds the top; cards go under it
            top={showTop ? 136 : sheet === "trip" ? 84 : 12}
            bottom={sheetPx + 12}
          />
        )}
        {!showTop && !stage && (
          <div className="absolute right-3 top-[max(.75rem,env(safe-area-inset-top))] z-[650]">
            <Inbox lang={lang} />
          </div>
        )}

        {/* top: from / to, slides away while a trip or the explainer is open */}
        <AnimatePresence>
          {showTop && (
            <motion.div
              key="top"
              initial={{ y: -120, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -120, opacity: 0 }}
              transition={spring.soft}
              className="pointer-events-none absolute inset-x-0 top-0 z-[650] p-3 pt-[max(.75rem,env(safe-area-inset-top))]"
            >
              <div className="pointer-events-auto mx-auto flex max-w-xl items-stretch gap-2 rounded-2xl bg-white/95 p-2 shadow-lg backdrop-blur dark:bg-slate-900/95">
                <div className="flex flex-1 flex-col gap-1">
                  {(["from", "to"] as const).map((f) => {
                    const p = f === "from" ? from : to;
                    return (
                      <div key={f} className="relative">
                        <motion.button
                          layout
                          transition={spring.soft}
                          type="button"
                          onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            set({
                              searchOrigin: {
                                x: r.left + 40,
                                y: r.top + r.height / 2,
                              },
                            });
                            edit(f);
                          }}
                          className={`flex h-10 w-full items-center gap-2 rounded-xl bg-slate-100 px-3 text-left text-sm dark:bg-slate-800 ${f === "to" && to ? "pr-9" : ""}`}
                        >
                          <span
                            className={`size-2.5 shrink-0 rounded-full ${f === "from" ? "bg-green-600" : "bg-red-600"}`}
                          />
                          <span className="w-8 shrink-0 text-xs text-slate-500">
                            {t(lang, f)}
                          </span>
                          <AnimatePresence mode="wait" initial={false}>
                            <motion.span
                              key={p?.name ?? `empty-${f}`}
                              initial={{ opacity: 0, x: 6 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: -6 }}
                              transition={{ duration: 0.15 }}
                              className={`truncate ${p ? "" : "text-slate-400"}`}
                            >
                              {p?.name ?? t(lang, "searchPlace")}
                            </motion.span>
                          </AnimatePresence>
                        </motion.button>
                        <AnimatePresence>
                          {f === "to" && to && (
                            <motion.button
                              type="button"
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0, opacity: 0 }}
                              whileTap={{ scale: 0.85, rotate: 90 }}
                              transition={spring.snappy}
                              aria-label={
                                lang === "id"
                                  ? "Hapus tujuan, kembali ke menu"
                                  : "Clear destination, back to menu"
                              }
                              onClick={() => {
                                app.resetTrip();
                                useGL.getState().set({ follow: null });
                              }}
                              className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"
                            >
                              <X className="size-4" />
                            </motion.button>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-col justify-between">
                  <motion.button
                    whileTap={{ rotate: 60 }}
                    type="button"
                    aria-label={t(lang, "settings")}
                    onClick={() =>
                      set({
                        sheet:
                          sheet === "settings"
                            ? result
                              ? "results"
                              : "home"
                            : "settings",
                      })
                    }
                    className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Settings className="size-5" />
                  </motion.button>
                  <motion.button
                    whileTap={{ rotate: 180 }}
                    transition={spring.snappy}
                    type="button"
                    aria-label={t(lang, "swap")}
                    onClick={app.swap}
                    className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <ArrowDownUp className="size-5" />
                  </motion.button>
                </div>
              </div>
              <div className="pointer-events-auto mx-auto mt-2 flex max-w-xl items-start gap-2">
                <select
                  aria-label={t(lang, "departAt")}
                  value={depart === null ? "" : String(depart)}
                  onChange={(e) =>
                    set({
                      depart: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className="h-8 rounded-full bg-white/95 px-3 text-xs shadow dark:bg-slate-900/95"
                >
                  <option value="">
                    {t(lang, "departAt")}: {t(lang, "now")}
                  </option>
                  {depart !== null &&
                    ![15, 30, 60, 90, 120, 180].some(
                      (m) =>
                        Math.ceil((now + m * 60_000) / 300_000) * 300_000 ===
                        depart,
                    ) && (
                      <option value={depart}>
                        {t(lang, "departAt")} {clock(depart)}
                      </option>
                    )}
                  {[15, 30, 60, 90, 120, 180].map((m) => {
                    const at =
                      Math.ceil((now + m * 60_000) / 300_000) * 300_000;
                    return (
                      <option key={m} value={at}>
                        {t(lang, "departAt")} {clock(at)}
                      </option>
                    );
                  })}
                </select>
                <div className="flex-1" />
                {(
                  [
                    ["rainLayer", rainLayer, Layers],
                    ["radarLayer", radarLayer, Radar],
                  ] as const
                ).map(([k, on, Icon]) => (
                  <motion.button
                    key={k}
                    type="button"
                    whileTap={{ scale: 0.92 }}
                    aria-pressed={on}
                    onClick={() => app.setPrefs({ [k]: !on })}
                    animate={{
                      backgroundColor: on ? "#0284c7" : "rgba(255,255,255,.95)",
                      color: on ? "#fff" : "#0f172a",
                    }}
                    transition={{ duration: 0.2 }}
                    className="flex h-8 items-center gap-1 rounded-full px-3 text-xs shadow"
                  >
                    <Icon className="size-3.5" />{" "}
                    <span className="hidden sm:inline">{t(lang, k)}</span>
                  </motion.button>
                ))}
                <SimMenu />
                <Inbox lang={lang} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {pickOnMap && (
            <motion.div
              initial={{ y: -40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -40, opacity: 0 }}
              transition={spring.soft}
              className="absolute inset-x-3 top-3 z-[900] flex items-center justify-between rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl"
            >
              {t(lang, "pickOnMap")} ({t(lang, pickOnMap)})
              <button
                type="button"
                aria-label={t(lang, "close")}
                onClick={() => set({ pickOnMap: null })}
              >
                <X className="size-5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* bottom sheet: its height follows the content, the content cross-fades */}
        <AnimatePresence>
          {sheet !== "search" && !pickOnMap && !stage && (
            <motion.div
              key="sheet"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={spring.soft}
              className="absolute inset-x-0 bottom-0 z-[600] flex justify-center"
            >
              <motion.div
                ref={sheetRef}
                layout
                transition={spring.soft}
                drag="y"
                dragControls={dragCtl}
                dragListener={false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0.08, bottom: 0.5 }}
                onDragStart={() => {
                  dragged.current = true;
                }}
                onDragEnd={(_, info) => {
                  // a flick or a long pull decides; short tugs snap back
                  if (info.offset.y > 70 || info.velocity.y > 450)
                    set({ collapsed: true });
                  else if (info.offset.y < -50 || info.velocity.y < -450)
                    set({ collapsed: false });
                }}
                className={`${view === "how" && !collapsed ? "max-h-[88dvh]" : "max-h-[62dvh]"} w-full max-w-xl ${collapsed ? "overflow-hidden" : "overflow-y-auto"} overscroll-contain rounded-t-3xl bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(0,0,0,.15)] dark:bg-slate-950`}
              >
                <button
                  type="button"
                  aria-label={
                    collapsed
                      ? lang === "id"
                        ? "Buka panel"
                        : "Expand panel"
                      : lang === "id"
                        ? "Kecilkan panel"
                        : "Minimise panel"
                  }
                  aria-expanded={!collapsed}
                  onPointerDown={(e) => {
                    dragged.current = false;
                    dragCtl.start(e);
                  }}
                  onClick={() => {
                    // the click that ends a drag is not a tap
                    if (!dragged.current) set({ collapsed: !collapsed });
                  }}
                  className="sticky top-0 z-10 -mx-4 mb-1 flex w-[calc(100%+2rem)] cursor-grab touch-none justify-center bg-white pt-2.5 pb-2 active:cursor-grabbing dark:bg-slate-950"
                >
                  <motion.span
                    className="h-1.5 rounded-full bg-slate-300 dark:bg-slate-700"
                    animate={{ width: collapsed ? 28 : 40 }}
                    whileHover={{ width: 52 }}
                    transition={spring.snappy}
                  />
                </button>
                {view === "trip" ? (
                  <TripView grid={grid} onTime={onTime} compact={collapsed} />
                ) : (
                  <AnimatePresence mode="popLayout">
                    {collapsed ? (
                      <SheetPeek
                        key="peek"
                        view={view}
                        onOpen={() => set({ collapsed: false })}
                      />
                    ) : (
                      <motion.div
                        key="full"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                      >
                        {view === "how" && (
                          <button
                            type="button"
                            onClick={() => set({ sheet: "results" })}
                            className="mb-2 flex items-center gap-1 text-xs text-slate-500"
                          >
                            <ArrowLeft className="size-3.5" /> {t(lang, "back")}
                          </button>
                        )}
                        {rainLayer &&
                          (view === "home" || view === "results") &&
                          grid && (
                            <motion.div
                              layout="position"
                              className="mb-3 flex items-center gap-2 text-xs text-slate-500"
                            >
                              <CloudRain className="size-4 shrink-0" />
                              <input
                                type="range"
                                aria-label={t(lang, "rainLayer")}
                                min={0}
                                max={180}
                                step={15}
                                value={rainOffsetMin}
                                onChange={(e) =>
                                  set({ rainOffsetMin: Number(e.target.value) })
                                }
                                className="flex-1 accent-sky-600"
                              />
                              <span className="w-24 text-right tabular-nums">
                                {rainOffsetMin === 0
                                  ? t(lang, "rainNow")
                                  : `${clock(shownTime)} (+${rainOffsetMin})`}
                              </span>
                            </motion.div>
                          )}
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.div key={view} {...sheetSwap}>
                            {view === "settings" ? (
                              <SettingsView />
                            ) : view === "how" ? (
                              <HowItWorks grid={grid} />
                            ) : view === "loading" ? (
                              <LoadingPipeline grid={grid} lang={lang} />
                            ) : view === "error" ? (
                              <div className="space-y-2 py-2">
                                <p className="text-sm text-red-600">
                                  {t(lang, "error")}: {error}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => run()}
                                  className="rounded-xl border px-3 py-2 text-sm"
                                >
                                  {t(lang, "findRoute")}
                                </button>
                              </div>
                            ) : view === "results" ? (
                              <Results onReplan={(b) => run(b)} />
                            ) : (
                              <motion.div
                                variants={stagger(0.07)}
                                initial="hidden"
                                animate="show"
                                className="space-y-2 py-1"
                              >
                                <motion.h1
                                  variants={rise}
                                  className="text-lg font-bold"
                                >
                                  {BRAND.app}
                                </motion.h1>
                                <motion.p
                                  variants={rise}
                                  className="text-sm text-slate-600 dark:text-slate-300"
                                >
                                  {lang === "id"
                                    ? "Pilih tujuan. Kami bandingkan rute tercepat dengan rute yang paling sedikit kehujanan, pakai prakiraan hujan per 15 menit di sepanjang jalan."
                                    : "Pick a destination. We compare the fastest route with the one that keeps you driest, using 15-minute rain forecasts along the way."}
                                </motion.p>
                                <motion.p
                                  variants={rise}
                                  className="flex items-center gap-1 pt-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase"
                                >
                                  <CloudLightning className="size-3.5" />{" "}
                                  {lang === "id"
                                    ? "Demo cuaca"
                                    : "Weather demos"}
                                </motion.p>
                                <motion.div
                                  variants={rise}
                                  className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1"
                                >
                                  {HOME_DEMOS.map((p) => {
                                    const Icon = SCENARIO_META[p.scenario].icon;
                                    return (
                                      <motion.button
                                        key={p.id}
                                        type="button"
                                        whileTap={{ scale: 0.96 }}
                                        onClick={() => set(presetState(p))}
                                        className="w-44 shrink-0 snap-start rounded-2xl border border-slate-200 p-2.5 text-left dark:border-slate-700"
                                      >
                                        <div className="flex items-center gap-1.5 text-xs leading-tight font-semibold">
                                          <span className="text-base">
                                            {p.emoji}
                                          </span>
                                          {p.name[lang]}
                                        </div>
                                        <div className="mt-0.5 truncate text-[11px] text-slate-500">
                                          {p.from.name} → {p.to.name}
                                        </div>
                                        <div className="mt-1 line-clamp-3 text-[10.5px] leading-snug text-slate-500">
                                          {p.check[lang]}
                                        </div>
                                        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-sky-700 tabular-nums dark:text-sky-300">
                                          <Icon className="size-3" />
                                          {t(
                                            lang,
                                            SCENARIO_META[p.scenario].key,
                                          )}{" "}
                                          · {String(p.at.h).padStart(2, "0")}.
                                          {String(p.at.m).padStart(2, "0")}
                                        </div>
                                      </motion.button>
                                    );
                                  })}
                                </motion.div>
                                <motion.p
                                  variants={rise}
                                  className="flex items-center gap-1 pt-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase"
                                >
                                  <Sparkles className="size-3.5" />{" "}
                                  {lang === "id" ? "Coba" : "Try"}
                                </motion.p>
                                <motion.div
                                  variants={rise}
                                  className="flex flex-wrap gap-1.5"
                                >
                                  {EXAMPLES.map((e) => (
                                    <motion.button
                                      key={`${e.from.name}-${e.to.name}`}
                                      type="button"
                                      whileTap={{ scale: 0.95 }}
                                      onClick={() =>
                                        set({
                                          from: e.from,
                                          to: e.to,
                                          result: null,
                                        })
                                      }
                                      className="rounded-full border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-700"
                                    >
                                      {e.from.name} → {e.to.name}
                                    </motion.button>
                                  ))}
                                </motion.div>
                                {result && (
                                  <motion.button
                                    variants={rise}
                                    type="button"
                                    onClick={() => set({ sheet: "results" })}
                                    className="rounded-xl border px-3 py-2 text-sm"
                                  >
                                    {t(lang, "back")}
                                  </motion.button>
                                )}
                                <motion.div variants={rise} className="pt-3">
                                  <Signature lang={lang} />
                                  <p className="mt-1 text-[11px] text-slate-400">
                                    {t(lang, "fullName")}
                                  </p>
                                </motion.div>
                              </motion.div>
                            )}
                          </motion.div>
                        </AnimatePresence>
                      </motion.div>
                    )}
                  </AnimatePresence>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {sheet === "search" && <PlaceSearch key="search" />}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
