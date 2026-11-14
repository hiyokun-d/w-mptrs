"use client";

import { Clock, FlaskConical, Play, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { SCENARIOS } from "@/lib/core/scenarios";
import { type Key, t } from "@/lib/i18n";
import { useApp } from "@/lib/store/app";
import { clock } from "./format";
import { rise, spring, stagger } from "./motion";
import { SCENARIO_META } from "./scenario-meta";
import { PRESETS, presetState } from "./sim-presets";

const TIMES: { key: Key; h: number; m: number }[] = [
  { key: "rushAm", h: 7, m: 30 },
  { key: "midday", h: 12, m: 0 },
  { key: "rushPm", h: 17, m: 30 },
  { key: "lateNight", h: 23, m: 30 },
];

/** Next occurrence of hh:mm in Jakarta time (UTC+7). */
function nextWib(h: number, m: number, now = Date.now()): number {
  const day = 86_400_000;
  const off = 7 * 3_600_000;
  const startOfDay = Math.floor((now + off) / day) * day - off;
  let at = startOfDay + (h * 60 + m) * 60_000;
  if (at < now) at += day;
  return at;
}

/**
 * Quick menu for demos: swap the weather scenario, jump the departure to a
 * rush hour, or play the chosen trip at 30×. Every change re-plans at once.
 */
export function SimMenu() {
  const { lang, scenario, depart, result, choice, from, to, setPrefs, set } =
    useApp();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node))
        setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const demo = scenario !== "live";
  const Icon = SCENARIO_META[scenario].icon;

  return (
    <div ref={panel} className="pointer-events-auto relative">
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.9, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -6 }}
            transition={spring.snappy}
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 top-14 z-10 max-h-[calc(100dvh-8rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-3xl bg-white/95 p-3 shadow-2xl ring-1 ring-black/5 backdrop-blur dark:bg-slate-900/95 dark:ring-white/10"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">{t(lang, "sim")}</span>
              <button
                type="button"
                aria-label={t(lang, "close")}
                onClick={() => setOpen(false)}
                className="rounded-full p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="size-4" />
              </button>
            </div>

            <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              {lang === "id" ? "Uji siap pakai" : "Test presets"}
            </p>
            <motion.div
              variants={stagger(0.02)}
              initial="hidden"
              animate="show"
              className="-mx-1 mb-3 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1"
            >
              {PRESETS.map((p) => {
                const on =
                  from?.name === p.from.name &&
                  to?.name === p.to.name &&
                  scenario === p.scenario;
                return (
                  <motion.button
                    key={p.id}
                    variants={rise}
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    title={p.check[lang]}
                    onClick={() => {
                      set(presetState(p));
                      setOpen(false);
                    }}
                    className={`relative w-40 shrink-0 snap-start rounded-2xl border p-2 text-left ${on ? "border-sky-600 bg-sky-50 dark:bg-sky-950/40" : "border-slate-200 dark:border-slate-700"}`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold leading-tight">
                      <span className="text-base">{p.emoji}</span>
                      {p.name[lang]}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-500">
                      {p.from.name} → {p.to.name}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[10px] leading-snug text-slate-500">
                      {p.check[lang]}
                    </div>
                    <div className="mt-1 flex gap-1 text-[10px] tabular-nums">
                      <span className="rounded bg-slate-100 px-1 dark:bg-slate-800">
                        {String(p.at.h).padStart(2, "0")}.
                        {String(p.at.m).padStart(2, "0")}
                      </span>
                      <span className="rounded bg-slate-100 px-1 dark:bg-slate-800">
                        β {p.beta}
                      </span>
                    </div>
                  </motion.button>
                );
              })}
            </motion.div>

            <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              {t(lang, "weather")}
            </p>
            <motion.div
              variants={stagger(0.025)}
              initial="hidden"
              animate="show"
              className="grid grid-cols-3 gap-1.5"
            >
              {SCENARIOS.map((s) => {
                const M = SCENARIO_META[s];
                const on = s === scenario;
                return (
                  <motion.button
                    key={s}
                    variants={rise}
                    type="button"
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setPrefs({ scenario: s })}
                    className="relative flex flex-col items-center gap-1 rounded-2xl px-1 py-2 text-center text-[11px] leading-tight"
                  >
                    {on && (
                      <motion.span
                        layoutId="sim-scenario"
                        transition={spring.snappy}
                        className="absolute inset-0 rounded-2xl bg-sky-600"
                      />
                    )}
                    <M.icon
                      className={`relative size-5 ${on ? "text-white" : "text-slate-600 dark:text-slate-300"}`}
                    />
                    <span
                      className={`relative ${on ? "font-semibold text-white" : ""}`}
                    >
                      {t(lang, M.key)}
                    </span>
                  </motion.button>
                );
              })}
            </motion.div>

            <p className="mt-3 mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              {t(lang, "departure")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: "now" as Key, at: null as number | null },
                ...TIMES.map((x) => ({ key: x.key, at: nextWib(x.h, x.m) })),
              ].map(({ key, at }) => {
                const on =
                  at === null
                    ? depart === null
                    : depart !== null && Math.abs(depart - at) < 60_000;
                return (
                  <motion.button
                    key={key}
                    type="button"
                    whileTap={{ scale: 0.95 }}
                    onClick={() => set({ depart: at })}
                    className="relative flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs dark:border-slate-700"
                  >
                    {on && (
                      <motion.span
                        layoutId="sim-time"
                        transition={spring.snappy}
                        className="absolute inset-0 rounded-full bg-slate-900 dark:bg-white"
                      />
                    )}
                    <Clock
                      className={`relative size-3 ${on ? "text-white dark:text-slate-900" : ""}`}
                    />
                    <span
                      className={`relative ${on ? "text-white dark:text-slate-900" : ""}`}
                    >
                      {t(lang, key)}
                      {at !== null && ` ${clock(at)}`}
                    </span>
                  </motion.button>
                );
              })}
            </div>

            {result && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setOpen(false);
                  set({
                    trip: { startedAt: Date.now(), speed: 30, choice },
                    sheet: "trip",
                  });
                }}
                className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-sky-600 text-sm font-semibold text-white"
              >
                <Play className="size-4" /> {t(lang, "playTrip")} · 30×
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        aria-label={t(lang, "sim")}
        aria-expanded={open}
        whileTap={{ scale: 0.92 }}
        onClick={() => {
          // the simulation acts on the map, so make room to see it
          if (!open) set({ collapsed: true });
          setOpen((o) => !o);
        }}
        className={`relative flex h-12 items-center gap-2 rounded-full px-4 text-sm font-semibold shadow-lg ${demo ? "bg-amber-400 text-slate-950" : "bg-white text-slate-900 dark:bg-slate-900 dark:text-white"}`}
      >
        {demo && (
          <span className="absolute -top-0.5 -right-0.5 size-3 animate-ping rounded-full bg-amber-500" />
        )}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={scenario}
            initial={{ rotate: -40, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 40, opacity: 0 }}
            transition={spring.snappy}
          >
            {demo ? (
              <Icon className="size-5" />
            ) : (
              <FlaskConical className="size-5" />
            )}
          </motion.span>
        </AnimatePresence>
        <span>
          {demo ? t(lang, SCENARIO_META[scenario].key) : t(lang, "sim")}
        </span>
      </motion.button>
    </div>
  );
}
