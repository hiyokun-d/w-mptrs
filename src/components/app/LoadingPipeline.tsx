"use client";

import { Check, CloudRain, Cpu, Network, TrafficCone } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { trafficFactor, wib } from "@/lib/core/eta";
import type { RainGrid } from "@/lib/core/rainfield";
import type { Lang } from "@/lib/i18n";
import { AnimatedNumber, spring } from "./motion";

type Counts = { stops: number; routes: number; patterns: number };
let countsPromise: Promise<Counts | null> | null = null;
function loadCounts() {
  countsPromise ??= fetch("/network/manifest.json")
    .then((r) => r.json())
    .then((m) => (m.counts as Counts) ?? null)
    .catch(() => null);
  return countsPromise;
}

const STEP_MS = 260;

/**
 * What the planner is doing while it plans, with the real inputs: the rain
 * grid, the network, the traffic factor for this hour, then the search.
 * Planning takes well under a second, so it is a quick strip, not a show.
 */
export function LoadingPipeline({
  grid,
  lang,
}: {
  grid: RainGrid | null;
  lang: Lang;
}) {
  const id = (en: string, idn: string) => (lang === "id" ? idn : en);
  const [step, setStep] = useState(0);
  const [counts, setCounts] = useState<Counts | null>(null);
  useEffect(() => {
    loadCounts().then(setCounts);
    const ids = [1, 2, 3].map((s) => setTimeout(() => setStep(s), s * STEP_MS));
    return () => ids.forEach(clearTimeout);
  }, []);

  const now = Date.now();
  const cells = grid ? grid.nLat * grid.nLng * grid.nt : 0;
  const maxMmh = grid ? Math.max(0, ...grid.values) : 0;
  const tf = trafficFactor(now);
  const h = wib(now);

  const rows = [
    {
      icon: CloudRain,
      label: id("Rain forecast", "Prakiraan hujan"),
      value: grid ? (
        <>
          <AnimatedNumber value={cells} duration={0.4} />{" "}
          {id("values", "nilai")} · max{" "}
          <AnimatedNumber
            value={maxMmh}
            format={(v) => v.toFixed(1)}
            duration={0.4}
          />{" "}
          mm/h
        </>
      ) : (
        id("no grid — dry", "tanpa data — kering")
      ),
    },
    {
      icon: Network,
      label: id("Transit network", "Jaringan transit"),
      value: counts ? (
        <>
          <AnimatedNumber value={counts.stops} duration={0.4} />{" "}
          {id("stops", "halte")} ·{" "}
          <AnimatedNumber value={counts.routes} duration={0.4} />{" "}
          {id("lines", "rute")}
        </>
      ) : (
        "…"
      ),
    },
    {
      icon: TrafficCone,
      label: id("Traffic now", "Lalu lintas"),
      value: (
        <>
          ×<AnimatedNumber value={tf} format={(v) => v.toFixed(2)} />{" "}
          {id("at", "pukul")} {String(h.hour).padStart(2, "0")}:
          {String(h.minute).padStart(2, "0")}
        </>
      ),
    },
    {
      icon: Cpu,
      label: id("Searching routes", "Mencari rute"),
      value: id("τ·w·(1+β·E·φ(r)) per leg", "τ·w·(1+β·E·φ(r)) per ruas"),
    },
  ];

  return (
    <div className="space-y-1.5 py-1">
      {rows.map((r, i) => {
        const on = step >= i;
        const done = step > i;
        const Icon = r.icon;
        return (
          <motion.div
            key={r.label}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: on ? 1 : 0.35, x: 0 }}
            transition={{ ...spring.soft, delay: i * 0.05 }}
            className="relative flex items-center gap-3 overflow-hidden rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-900"
          >
            {on && !done && (
              <motion.span
                aria-hidden
                className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-sky-200/60 to-transparent dark:via-sky-500/20"
                initial={{ x: "-100%" }}
                animate={{ x: "300%" }}
                transition={{
                  duration: 0.9,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "linear",
                }}
              />
            )}
            <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-white shadow-sm dark:bg-slate-800">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={done ? "d" : "i"}
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.4, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {done ? (
                    <Check className="size-4 text-emerald-600" />
                  ) : (
                    <Icon
                      className={`size-4 ${on ? "text-sky-600" : "text-slate-400"}`}
                    />
                  )}
                </motion.span>
              </AnimatePresence>
            </span>
            <span className="relative text-sm font-medium">{r.label}</span>
            <span className="relative ml-auto truncate text-xs text-slate-500 tabular-nums">
              {on ? r.value : ""}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}
