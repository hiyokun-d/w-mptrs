"use client";

import {
  BrainCircuit,
  Clapperboard,
  CloudRain,
  Info,
  Navigation,
  Share2,
  Umbrella,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { alertText } from "@/lib/core/alerts";
import type { Itinerary } from "@/lib/core/router";
import { type Lang, t } from "@/lib/i18n";
import { type Choice, chosen, transitCard, useApp } from "@/lib/store/app";
import { clock, dur, mm, rupiah, summaryModes } from "./format";
import { useGL } from "./gl/store";
import { LegList, RainStrip } from "./Itinerary";
import { LeaveLater } from "./LeaveLater";
import { AnimatedNumber, Duration, rise, spring, stagger } from "./motion";

export const BETA_STEPS = [0, 0.5, 1, 2, 4];

function OptionCard({
  it,
  label,
  active,
  recommended,
  onClick,
  lang,
  overBudget = false,
}: {
  it: Itinerary | null;
  label: string;
  active: boolean;
  recommended: boolean;
  onClick: () => void;
  lang: Lang;
  overBudget?: boolean;
}) {
  if (!it)
    return (
      <div className="min-w-0 flex-1 rounded-2xl border border-dashed border-slate-300 p-3 text-sm text-slate-500">
        {label}: {t(lang, "noRoute")}
      </div>
    );
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.98 }}
      transition={spring.soft}
      className="relative min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-3 text-left dark:border-slate-800 dark:bg-slate-900"
    >
      {/* the selection ring glides to the card you tapped */}
      {active && (
        <motion.span
          layoutId="option-ring"
          transition={spring.soft}
          className="absolute -inset-px rounded-2xl border-2 border-sky-500 bg-sky-50/60 dark:bg-sky-950/30"
        />
      )}
      <div className="relative">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-xs font-semibold tracking-wide text-slate-500 uppercase">
            {label}
          </span>
          <AnimatePresence>
            {recommended && (
              <motion.span
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={spring.snappy}
                className="shrink-0 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white"
              >
                {t(lang, "recommended")}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        {/* the chosen card's time and modes morph into the minimised sheet */}
        <motion.div
          layoutId={active ? "chosen-time" : undefined}
          transition={spring.soft}
          className="mt-1 w-fit"
        >
          <Duration minutes={it.minutes} lang={lang} big />
        </motion.div>
        <div className="text-xs text-slate-500 tabular-nums">
          {clock(it.depart)} → {clock(it.arrive)}
        </div>
        <motion.div
          layoutId={active ? "chosen-modes" : undefined}
          transition={spring.soft}
          className="mt-2 flex flex-wrap gap-1"
        >
          {summaryModes(it).map((m, i) => (
            <motion.span
              key={`${i}-${m.label}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ ...spring.snappy, delay: 0.1 + i * 0.05 }}
              className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-white"
              style={{ background: m.color }}
            >
              {m.label}
            </motion.span>
          ))}
        </motion.div>
        <div className="mt-2 flex items-center gap-1 text-sm">
          <CloudRain
            className={`size-4 ${it.dose >= 0.05 ? "text-blue-600" : "text-slate-400"}`}
          />
          <span className="font-semibold">
            <AnimatedNumber value={it.dose} format={(v) => mm(v)} />
          </span>
          <span className="truncate text-xs text-slate-500">
            {t(lang, "rainDose")}
          </span>
        </div>
        <div className="mt-1 text-xs text-slate-500">
          🚶 {dur(it.walkMin, lang)} · {rupiah(it.fare)}
          {it.type === "moto" && overBudget && (
            <span className="ml-1 rounded bg-rose-100 px-1 font-semibold text-rose-700">
              {t(lang, "overBudget")}
            </span>
          )}
        </div>
        <div className="mt-2">
          <RainStrip it={it} />
        </div>
      </div>
    </motion.button>
  );
}

/** One sentence on why the cards look the way they do. */
function explainLine(
  lang: Lang,
  maxed: boolean,
): { tone: "same" | "trade" | "shift"; text: string } | null {
  const r = useApp.getState().result;
  if (!r?.explain || !r.fastest || !r.weatherAware) return null;
  const e = r.explain;
  const tr = transitCard(r);
  if (!r.shift && tr && tr.dose < r.fastest.dose - 0.005) {
    const extra = Math.round(tr.minutes - r.fastest.minutes);
    const close = r.fastest.dose - tr.dose < 0.1;
    if (close)
      return {
        tone: "same",
        text:
          lang === "id"
            ? `Hujan hampir sama di kedua pilihan (${mm(r.fastest.dose)} vs ${mm(tr.dose)}), jadi yang tercepat paling masuk akal.`
            : `Both options get about the same rain (${mm(r.fastest.dose)} vs ${mm(tr.dose)}), so the fastest makes the most sense.`,
      };
    return {
      tone: "trade",
      text:
        lang === "id"
          ? `Tercepat paling sepadan untuk Anda. Transportasi umum lebih kering (${mm(tr.dose)} vs ${mm(r.fastest.dose)}) tapi +${extra} menit — ${maxed ? "selisih waktunya terlalu besar, bahkan di pengaturan tertinggi." : "geser slider ke kanan untuk lebih menghindari hujan."}`
          : `The fastest route is the best trade-off for you. Public transport is drier (${mm(tr.dose)} vs ${mm(r.fastest.dose)}) but +${extra} min — ${maxed ? "the time difference is too large, even at the highest setting." : "move the slider right to avoid rain more."}`,
    };
  }
  if (!r.shift)
    return {
      tone: "same",
      text: `✓ ${t(lang, "same")}${r.fastest.dose >= 0.05 ? (lang === "id" ? ` — siapkan payung (${mm(r.fastest.dose)}).` : ` — bring an umbrella (${mm(r.fastest.dose)}).`) : "."}`,
    };
  const extra = Math.round(e.extraMin);
  const pct = Math.round(e.doseSavedPct);
  const heavy =
    e.exposedSavedMin >= 1
      ? lang === "id"
        ? ` · ${Math.round(e.exposedSavedMin)} mnt lebih sedikit di hujan`
        : ` · ${Math.round(e.exposedSavedMin)} fewer min in the rain`
      : "";
  const sign = extra >= 0 ? `+${extra}` : `${extra}`;
  const cheaper =
    e.fareSaved >= 1000
      ? lang === "id"
        ? ` · ${rupiah(e.fareSaved)} lebih hemat`
        : ` · ${rupiah(e.fareSaved)} cheaper`
      : "";
  // the switch was about money, not rain
  if (e.doseSaved < 0.05 && e.fareSaved >= 1000) {
    const why = r.price.motoOverBudget
      ? lang === "id"
        ? `ojek ${rupiah(r.fastest.fare)} melebihi budget Anda`
        : `the ojek (${rupiah(r.fastest.fare)}) is over your budget`
      : lang === "id"
        ? `dengan nilai waktu ${rupiah(r.price.vot)}/mnt, ojek tidak sepadan`
        : `at ${rupiah(r.price.vot)}/min of your time, the ojek isn't worth it`;
    return {
      tone: "shift",
      text:
        lang === "id"
          ? `${sign} menit, ${rupiah(e.fareSaved)} lebih hemat — ${why}.`
          : `${sign} min, ${rupiah(e.fareSaved)} cheaper — ${why}.`,
    };
  }
  return {
    tone: "shift",
    text:
      (lang === "id"
        ? `${sign} menit, hujan berkurang ${pct}% (${mm(e.doseSaved)} lebih kering)`
        : `${sign} min, ${pct}% less rain (${mm(e.doseSaved)} drier)`) +
      heavy +
      cheaper,
  };
}

const TONE = {
  same: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  trade: "bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100",
  shift: "bg-sky-50 text-sky-950 dark:bg-sky-950/40 dark:text-sky-100",
};

export function Results({ onReplan }: { onReplan: (beta: number) => void }) {
  const { lang, result, choice, set, beta, setPrefs, from, to } = useApp();
  const [why, setWhy] = useState(false);
  const [shared, setShared] = useState(false);
  if (!result) return null;
  const it = chosen(result, choice);
  const tr = transitCard(result);
  const pick = (c: Choice) => set({ choice: c });
  const line = explainLine(lang, beta >= BETA_STEPS[BETA_STEPS.length - 1]);

  const share = async () => {
    if (!from || !to) return;
    const q = new URLSearchParams({
      from: `${from.lat.toFixed(5)},${from.lng.toFixed(5)},${from.name ?? ""}`,
      to: `${to.lat.toFixed(5)},${to.lng.toFixed(5)},${to.name ?? ""}`,
    });
    const url = `${location.origin}/?${q}`;
    const title = `${from.name ?? "?"} → ${to.name ?? "?"}`;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        setShared(true);
        setTimeout(() => setShared(false), 1800);
      }
    } catch {
      // share sheet dismissed
    }
  };

  return (
    <motion.div
      variants={stagger(0.06)}
      initial="hidden"
      animate="show"
      className="space-y-3"
    >
      {result.offline && (
        <motion.p
          variants={rise}
          className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs text-amber-900"
        >
          {t(lang, "offline")}
        </motion.p>
      )}
      <AnimatePresence mode="wait" initial={false}>
        {line && (
          <motion.p
            key={line.text}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className={`rounded-xl px-3 py-2 text-sm ${TONE[line.tone]}`}
          >
            {line.tone === "shift" && (
              <Umbrella className="mr-1 inline size-4" />
            )}
            {line.text}
          </motion.p>
        )}
      </AnimatePresence>

      <motion.div layout className="flex gap-2">
        <OptionCard
          it={result.fastest}
          label={t(lang, "fastest")}
          overBudget={result.price?.motoOverBudget}
          active={choice === "fastest"}
          recommended={!result.shift}
          onClick={() => pick("fastest")}
          lang={lang}
        />
        <AnimatePresence mode="popLayout">
          {result.shift && (
            <OptionCard
              key="wa"
              it={result.weatherAware}
              label={t(lang, "weatherAware")}
              active={choice === "weatherAware"}
              recommended
              onClick={() => pick("weatherAware")}
              lang={lang}
            />
          )}
          {tr && (
            <OptionCard
              key="tr"
              it={tr}
              label={t(lang, "publicTransport")}
              active={choice === "transit"}
              recommended={false}
              onClick={() => pick("transit")}
              lang={lang}
            />
          )}
        </AnimatePresence>
      </motion.div>

      <motion.div
        variants={rise}
        className="rounded-2xl border border-slate-200 p-3 dark:border-slate-800"
      >
        <div className="flex items-center justify-between">
          <label htmlFor="beta" className="text-sm font-medium">
            {t(lang, "mindRain")}
          </label>
          <motion.span
            key={beta}
            initial={{ scale: 1.3, color: "#0284c7" }}
            animate={{ scale: 1, color: "#64748b" }}
            transition={spring.snappy}
            className="text-xs tabular-nums"
          >
            β = {beta}
          </motion.span>
        </div>
        <input
          id="beta"
          type="range"
          min={0}
          max={BETA_STEPS.length - 1}
          step={1}
          value={Math.max(0, BETA_STEPS.indexOf(beta))}
          onChange={(e) => {
            const b = BETA_STEPS[Number(e.target.value)];
            setPrefs({ beta: b });
            onReplan(b);
          }}
          className="mt-2 w-full accent-sky-600"
        />
        <div className="flex justify-between text-[11px] text-slate-500">
          <span>{t(lang, "mindRainLow")}</span>
          <span>{t(lang, "mindRainHigh")}</span>
        </div>
      </motion.div>

      <motion.div variants={rise} className="grid grid-cols-2 gap-2">
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          // with the 3D map, the explanation plays on the map itself
          onClick={() =>
            useGL.getState().map
              ? useGL.getState().set({ stage: true })
              : set({ sheet: "how" })
          }
          className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 text-sm font-medium dark:border-slate-800"
        >
          <BrainCircuit className="size-4 text-sky-600" />{" "}
          {t(lang, "howItWorks")}
        </motion.button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={share}
          className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 text-sm font-medium dark:border-slate-800"
        >
          <Share2 className="size-4" />
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={String(shared)}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
            >
              {shared ? t(lang, "copied") : t(lang, "share")}
            </motion.span>
          </AnimatePresence>
        </motion.button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={() => useGL.getState().set({ story: true })}
          className="col-span-2 flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#050b2e] text-sm font-bold text-white"
        >
          <Clapperboard className="size-4 text-[#33d6ff]" /> {t(lang, "video")}
        </motion.button>
      </motion.div>

      <motion.div variants={rise}>
        <LeaveLater />
      </motion.div>

      {result.alerts.length > 0 && choice === "weatherAware" && (
        <motion.div variants={rise} className="space-y-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            ☂ {t(lang, "alerts")}
          </h3>
          {result.alerts.map((a) => {
            const tx = alertText(a, a.issueAt, lang);
            return (
              <div
                key={a.issueAt}
                className={`rounded-xl border px-3 py-2 text-sm ${a.covered ? "border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/30" : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"}`}
              >
                <div className="font-semibold">
                  {clock(a.issueAt)} · {tx.headline}
                </div>
                <div className="text-slate-600 dark:text-slate-300">
                  {tx.advice}
                </div>
              </div>
            );
          })}
        </motion.div>
      )}

      {it && <LegList it={it} lang={lang} />}

      {it && (
        <motion.button
          variants={rise}
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={() =>
            set({
              trip: { startedAt: Date.now(), speed: 1, choice },
              sheet: "trip",
            })
          }
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-sky-600 font-semibold text-white shadow-lg shadow-sky-600/30"
        >
          <Navigation className="size-5" />
          {t(lang, "startTrip")}
        </motion.button>
      )}

      <button
        type="button"
        onClick={() => setWhy(!why)}
        className="flex items-center gap-1 text-xs text-slate-500"
      >
        <Info className="size-3.5" /> {t(lang, "why")} · {t(lang, "sources")}
      </button>
      <AnimatePresence>
        {why && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring.soft}
            className="overflow-hidden"
          >
            <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              <p>
                {lang === "id"
                  ? "Setiap ruas diberi biaya c = τ·w·(1 + β·E·φ(r)): waktu, dikali bobot (jalan/tunggu 1,5×), dikali penalti hujan sesuai paparan E (jalan & motor 1, di dalam kendaraan 0) dan prakiraan hujan r pada menit Anda tiba di ruas itu."
                  : "Each segment costs c = τ·w·(1 + β·E·φ(r)): time, times a weight (walk/wait 1.5×), times a rain penalty by exposure E (walk & motorcycle 1, inside a vehicle 0) and the forecast rain r at the minute you reach that segment."}
              </p>
              <p>
                {lang === "id" ? "Hujan" : "Rain"}: {result.rain.source}
                {result.rain.issuedAt
                  ? ` (${clock(result.rain.issuedAt)})`
                  : ""}
                {result.scenario !== "live"
                  ? ` + demo: ${result.scenario}`
                  : ""}
              </p>
              <p>
                {lang === "id"
                  ? "Jadwal: GTFS resmi TransJakarta, jadwal KRL (Comuline, per Mar 2025), MRT/LRT (headway terbit). Waktu bus adalah perkiraan dari jadwal × lalu lintas × hujan."
                  : "Schedules: official TransJakarta GTFS, KRL timetable (Comuline, as of Mar 2025), MRT/LRT (published headways). Bus times are estimates from schedule × traffic × rain."}
              </p>
              <p>{t(lang, "research")}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
