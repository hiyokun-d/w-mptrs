"use client";

import {
  Bike,
  Bus,
  Clock,
  CloudRain,
  Footprints,
  TrainFront,
  Umbrella,
} from "lucide-react";
import { motion } from "motion/react";
import type { Itinerary, Leg } from "@/lib/core/router";
import { type Lang, t } from "@/lib/i18n";
import {
  clock,
  dur,
  legKey,
  legTitle,
  mm,
  rainWord,
  serviceText,
} from "./format";
import { rise, spring, stagger } from "./motion";
import { rainCss } from "./rain-colors";

function LegIcon({ g }: { g: Leg }) {
  const c = "size-4";
  if (g.kind === "walk") return <Footprints className={c} />;
  if (g.kind === "wait") return <Clock className={c} />;
  if (g.kind === "moto") return <Bike className={c} />;
  return g.route?.mode === "transjakarta" ? (
    <Bus className={c} />
  ) : (
    <TrainFront className={c} />
  );
}

/** trip as a strip: width = time, colour = mode, the band below = rain met */
export function RainStrip({ it }: { it: Itinerary }) {
  const total = it.arrive - it.depart || 1;
  return (
    <div className="space-y-0.5">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        {it.legs.map((g, i) => (
          <motion.div
            key={legKey(g)}
            title={g.kind}
            initial={{ width: 0 }}
            animate={{ width: `${(100 * (g.t1 - g.t0)) / total}%` }}
            transition={{ ...spring.soft, delay: i * 0.05 }}
            style={{
              background:
                g.kind === "walk"
                  ? "#94a3b8"
                  : g.kind === "wait"
                    ? "#cbd5e1"
                    : g.kind === "moto"
                      ? "#f97316"
                      : (g.route?.color ?? "#0ea5e9"),
            }}
          />
        ))}
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full">
        {it.legs.map((g, i) => (
          <motion.div
            key={legKey(g)}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: `${(100 * (g.t1 - g.t0)) / total}%`, opacity: 1 }}
            transition={{ ...spring.soft, delay: 0.15 + i * 0.05 }}
            style={{
              background: g.rain >= 0.5 ? rainCss(g.rain) : "transparent",
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function LegList({ it, lang }: { it: Itinerary; lang: Lang }) {
  return (
    <motion.ol
      key={it.depart + it.legs.length}
      variants={stagger(0.05)}
      initial="hidden"
      animate="show"
      className="relative ml-2 border-l-2 border-slate-200 dark:border-slate-800"
    >
      {it.legs.map((g) => {
        const exposed =
          (g.kind === "walk" && g.place !== "station") ||
          g.kind === "moto" ||
          (g.kind === "wait" && g.place !== "station" && g.place !== "none");
        const svc = serviceText(g, lang);
        return (
          <motion.li
            key={legKey(g)}
            variants={rise}
            className="relative pb-3 pl-5"
          >
            <span
              className="absolute top-0.5 -left-[11px] flex size-5 items-center justify-center rounded-full text-white"
              style={{
                background:
                  g.kind === "ride"
                    ? (g.route?.color ?? "#0ea5e9")
                    : g.kind === "moto"
                      ? "#f97316"
                      : "#64748b",
              }}
            >
              <LegIcon g={g} />
            </span>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium leading-tight">
                {legTitle(g, lang)}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-slate-500">
                {clock(g.t0)} · {dur(g.minutes, lang)}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
              {g.kind === "ride" && g.stops ? (
                <span>
                  {g.stops} {t(lang, "stops")}
                  {g.route?.cat ? ` · ${g.route.cat}` : ""}
                </span>
              ) : null}
              {svc && <span>{svc}</span>}
              {g.rain >= 0.5 && (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium text-white"
                  style={{ background: rainCss(g.rain) }}
                >
                  {exposed ? (
                    <CloudRain className="size-3" />
                  ) : (
                    <Umbrella className="size-3" />
                  )}
                  {rainWord(g.rain, lang)} {g.rain.toFixed(0)} mm/h
                  {exposed
                    ? ""
                    : lang === "id"
                      ? " · terlindung"
                      : " · sheltered"}
                </span>
              )}
            </div>
          </motion.li>
        );
      })}
      <motion.li variants={rise} className="relative pl-5">
        <span className="absolute top-0.5 -left-[7px] size-3 rounded-full bg-rose-600" />
        <span className="text-sm font-medium">
          {t(lang, "arrive")} {clock(it.arrive)}
        </span>
        <span className="ml-2 text-xs text-slate-500">
          {mm(it.dose)} {t(lang, "rainDose")}
        </span>
      </motion.li>
    </motion.ol>
  );
}
