"use client";

import {
  Bike,
  Bus,
  CloudRain,
  Database,
  Footprints,
  Gauge,
  Hourglass,
  Network,
  RotateCcw,
  Route,
  Trophy,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { phi, routingExposure, W } from "@/lib/core/dp";
import { trafficFactor, wib } from "@/lib/core/eta";
import type { RainGrid } from "@/lib/core/rainfield";
import {
  costOf,
  type Itinerary,
  type Leg,
  TRANSFER_PENALTY_MIN,
} from "@/lib/core/router";
import { type Lang, t } from "@/lib/i18n";
import type { PlanResponse } from "@/lib/local/planner";
import { transitCard, useApp } from "@/lib/store/app";
import { clock, legTitle, summaryModes } from "./format";
import { AnimatedNumber, rise, Signature, spring, stagger } from "./motion";
import { SCENARIO_META } from "./scenario-meta";

// "How the algorithm chose": the plan replayed as a pipeline. Each stage
// starts when the one before it has finished, so the reader sees data flow
// into the search, the search into leg scores, the scores into a decision.

const DATA_MS = 1500;
const SEARCH_MS = 1800;
const ROW_MS = 420;

type Manifest = {
  counts?: { stops: number; routes: number; patterns: number };
  sources?: { name: string }[];
};

const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => v.toFixed(2);

function legIcon(g: Leg) {
  if (g.kind === "walk") return Footprints;
  if (g.kind === "wait") return Hourglass;
  if (g.kind === "moto") return Bike;
  return Bus;
}

function Stage({
  n,
  title,
  icon: Icon,
  active,
  done,
  children,
}: {
  n: number;
  title: string;
  icon: typeof Database;
  active: boolean;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative pl-9">
      {/* the pipeline: a line that fills as data passes to the next stage */}
      <div className="absolute top-8 bottom-0 left-[13px] w-0.5 bg-slate-200 dark:bg-slate-800">
        <motion.div
          className="w-full bg-sky-500"
          initial={{ height: "0%" }}
          animate={{ height: done ? "100%" : "0%" }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
        />
      </div>
      <motion.div
        className="absolute top-0 left-0 flex size-7 items-center justify-center rounded-full text-white"
        animate={{
          backgroundColor: active || done ? "#0284c7" : "#cbd5e1",
          scale: active && !done ? [1, 1.12, 1] : 1,
        }}
        transition={
          active && !done
            ? { scale: { repeat: Number.POSITIVE_INFINITY, duration: 1.4 } }
            : spring.soft
        }
      >
        <Icon className="size-4" />
      </motion.div>
      <div className="flex items-baseline gap-2 pb-2">
        <span className="text-[11px] font-semibold text-slate-400 tabular-nums">
          0{n}
        </span>
        <h3
          className={`text-sm font-semibold ${active || done ? "" : "text-slate-400"}`}
        >
          {title}
        </h3>
      </div>
      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            transition={spring.soft}
            className="overflow-hidden pb-5"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DataCard({
  icon: Icon,
  label,
  value,
  detail,
  delay,
}: {
  icon: typeof Database;
  label: string;
  value: React.ReactNode;
  detail: string;
  delay: number;
}) {
  return (
    <motion.div
      variants={rise}
      transition={{ ...spring.soft, delay }}
      className="rounded-2xl border border-slate-200 p-2.5 dark:border-slate-800"
    >
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="mt-0.5 text-lg font-bold leading-tight">{value}</div>
      <div className="truncate text-[11px] text-slate-500">{detail}</div>
    </motion.div>
  );
}

/** φ(r) curve with the rain each leg met marked on it. */
function PhiCurve({ legs, r0, k }: { legs: Leg[]; r0: number; k: number }) {
  const R = 30;
  const pts = Array.from({ length: 61 }, (_, i) => {
    const r = (i / 60) * R;
    return `${(r / R) * 100},${40 - phi(r, r0, k) * 36}`;
  }).join(" ");
  return (
    <svg
      viewBox="-2 0 106 46"
      className="h-20 w-full"
      role="img"
      aria-label="φ(r): rain discomfort curve, with the rain each leg meets"
    >
      <line
        x1="0"
        y1="40"
        x2="100"
        y2="40"
        stroke="currentColor"
        className="text-slate-300 dark:text-slate-700"
        strokeWidth="0.5"
      />
      <motion.polyline
        points={pts}
        fill="none"
        stroke="#0284c7"
        strokeWidth="1.4"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9 }}
      />
      <line
        x1={(r0 / R) * 100}
        y1="4"
        x2={(r0 / R) * 100}
        y2="40"
        stroke="#94a3b8"
        strokeDasharray="1.5 1.5"
        strokeWidth="0.4"
      />
      <text x={(r0 / R) * 100 + 1} y="8" fontSize="3.6" fill="#64748b">
        r₀={r0}
      </text>
      {legs
        .filter((g) => g.rain > 0.05)
        .map((g, i) => (
          <motion.circle
            key={`${g.t0}-${g.kind}`}
            cx={(Math.min(g.rain, R) / R) * 100}
            cy={40 - phi(g.rain, r0, k) * 36}
            r="1.8"
            fill={routingExposure(g.kind) ? "#f59e0b" : "#94a3b8"}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ ...spring.snappy, delay: 0.9 + i * 0.12 }}
          />
        ))}
      <text x="100" y="45.5" fontSize="3.6" fill="#64748b" textAnchor="end">
        {R} mm/h
      </text>
      <text x="0" y="45.5" fontSize="3.6" fill="#64748b">
        0
      </text>
    </svg>
  );
}

/** One leg's cost, with the formula filled in term by term. */
function LegRow({
  g,
  beta,
  r0,
  k,
  lang,
  delay,
}: {
  g: Leg;
  beta: number;
  r0: number;
  k: number;
  lang: Lang;
  delay: number;
}) {
  const w = W[g.kind];
  const E = routingExposure(g.kind);
  const ph = phi(g.rain, r0, k);
  const cost = g.minutes * w * (1 + beta * E * ph);
  const Icon = legIcon(g);
  const terms: [string, string, string?][] = [
    ["τ", f1(g.minutes)],
    ["w", f1(w)],
    ["β", f1(beta)],
    ["E", E.toFixed(0), E ? "text-amber-600" : "text-slate-400"],
    ["φ", f2(ph), ph > 0.5 && E ? "text-amber-600" : undefined],
  ];
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...spring.soft, delay }}
      className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900"
    >
      <div className="flex items-center gap-2 text-xs">
        <Icon className="size-3.5 shrink-0 text-slate-500" />
        <span className="flex-1 truncate font-medium">{legTitle(g, lang)}</span>
        <span className="text-slate-500 tabular-nums">
          r = <AnimatedNumber value={g.rain} format={f1} delay={delay} /> mm/h
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-1 font-mono text-[11px] text-slate-600 dark:text-slate-300">
        {terms.map(([sym, val, cls], i) => (
          <motion.span
            key={sym}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: delay + 0.08 * (i + 1) }}
            className={cls}
          >
            {i === 2 ? "(1 + " : ""}
            {sym}
            <sub className="text-[9px] text-slate-400">{val}</sub>
            {i < 4 ? (i === 1 ? " ×" : " ·") : ")"}
          </motion.span>
        ))}
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: delay + 0.5 }}
          className="ml-auto font-sans text-sm font-bold text-slate-900 dark:text-white"
        >
          ={" "}
          <AnimatedNumber
            value={cost}
            format={f1}
            delay={delay + 0.5}
            duration={0.5}
          />
        </motion.span>
      </div>
    </motion.div>
  );
}

function timePart(it: Itinerary): number {
  return (
    it.legs.reduce((a, g) => a + g.minutes * W[g.kind], 0) +
    TRANSFER_PENALTY_MIN * it.transfers
  );
}

export function HowItWorks({ grid }: { grid: RainGrid | null }) {
  const { lang, result } = useApp();
  const [run, setRun] = useState(0);
  const [stage, setStage] = useState(0);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [tab, setTab] = useState<"weatherAware" | "fastest" | "transit">(
    "weatherAware",
  );

  useEffect(() => {
    fetch("/network/manifest.json")
      .then((r) => r.json())
      .then(setManifest)
      .catch(() => {});
  }, []);

  const r = result as PlanResponse;
  const tr = transitCard(r);
  const tabs = useMemo(() => {
    const list: { id: typeof tab; label: string; it: Itinerary }[] = [];
    if (r.weatherAware && r.shift)
      list.push({
        id: "weatherAware",
        label: t(lang, "weatherAware"),
        it: r.weatherAware,
      });
    if (r.fastest)
      list.push({ id: "fastest", label: t(lang, "fastest"), it: r.fastest });
    if (tr)
      list.push({ id: "transit", label: t(lang, "publicTransport"), it: tr });
    return list;
  }, [r, tr, lang]);
  const current = tabs.find((x) => x.id === tab) ?? tabs[0];

  const candidates = useMemo(() => {
    const seen = new Set<Itinerary>();
    const out: { label: string; it: Itinerary; cost: number; time: number }[] =
      [];
    const add = (label: string, it: Itinerary | null) => {
      if (!it || seen.has(it)) return;
      seen.add(it);
      out.push({ label, it, cost: costOf(it, r.params), time: timePart(it) });
    };
    add(
      lang === "id" ? "Transit (cari tercepat)" : "Transit (fastest search)",
      r.options.transit0,
    );
    add(
      lang === "id"
        ? "Transit (cari sadar hujan)"
        : "Transit (rain-aware search)",
      r.options.transitB,
    );
    add("Ojek", r.options.moto);
    return out.sort((a, b) => a.cost - b.cost);
  }, [r, lang]);

  const legs = current?.it.legs ?? [];
  const legsMs = 300 + legs.length * ROW_MS + 600;
  const compareMs = 300 + candidates.length * 350 + 900;

  // advance through the pipeline; a replay restarts it
  // biome-ignore lint/correctness/useExhaustiveDependencies: restart only on replay
  useEffect(() => {
    setStage(0);
    // each stage waits for the previous one's animation to finish
    const durations = [DATA_MS, SEARCH_MS, legsMs, compareMs];
    const ids: ReturnType<typeof setTimeout>[] = [];
    let at = 0;
    durations.forEach((d, i) => {
      at += d;
      ids.push(setTimeout(() => setStage(i + 1), at));
    });
    return () => ids.forEach(clearTimeout);
  }, [run]);

  if (!result) return null;
  const p = r.params;
  const traffic = trafficFactor(r.depart);
  const { hour, day } = wib(r.depart);
  const max = Math.max(...candidates.map((c) => c.cost), 1);
  const winner = candidates[0];
  const values = grid ? grid.nLat * grid.nLng * grid.nt : 0;
  const S = SCENARIO_META[r.scenario];

  return (
    <div className="space-y-1">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold">{t(lang, "howItWorks")}</h2>
        <motion.button
          whileTap={{ scale: 0.92, rotate: -90 }}
          type="button"
          onClick={() => setRun((x) => x + 1)}
          className="flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs dark:border-slate-700"
        >
          <RotateCcw className="size-3.5" /> {t(lang, "replay")}
        </motion.button>
      </div>

      <div key={run}>
        <Stage
          n={1}
          title={t(lang, "dataIn")}
          icon={Database}
          active={stage >= 0}
          done={stage >= 1}
        >
          <motion.div
            variants={stagger(0.12)}
            initial="hidden"
            animate="show"
            className="grid grid-cols-2 gap-2"
          >
            <DataCard
              icon={CloudRain}
              label={lang === "id" ? "Prakiraan hujan" : "Rain forecast"}
              value={
                <>
                  <AnimatedNumber
                    value={values}
                    format={(v) => Math.round(v).toLocaleString()}
                  />{" "}
                  <span className="text-xs font-normal text-slate-500">
                    {lang === "id" ? "nilai" : "values"}
                  </span>
                </>
              }
              detail={
                grid
                  ? `${r.rain.source} · ${grid.nLat}×${grid.nLng}×${grid.nt}${r.rain.issuedAt ? ` · ${clock(r.rain.issuedAt)}` : ""}`
                  : r.rain.source
              }
              delay={0}
            />
            <DataCard
              icon={Network}
              label={lang === "id" ? "Jaringan" : "Network"}
              value={
                <>
                  <AnimatedNumber
                    value={r.stats?.stops ?? manifest?.counts?.stops ?? 0}
                    format={(v) => Math.round(v).toLocaleString()}
                  />{" "}
                  <span className="text-xs font-normal text-slate-500">
                    {lang === "id" ? "halte" : "stops"}
                  </span>
                </>
              }
              detail={`${r.stats?.patterns ?? manifest?.counts?.patterns ?? "–"} ${lang === "id" ? "pola trayek" : "trip patterns"} · TJ · KRL · MRT · LRT`}
              delay={0.1}
            />
            <DataCard
              icon={Gauge}
              label={lang === "id" ? "Lalu lintas" : "Traffic"}
              value={
                <>
                  ×<AnimatedNumber value={traffic} format={f2} />
                </>
              }
              detail={`${String(hour).padStart(2, "0")}:00 · ${day >= 5 ? (lang === "id" ? "akhir pekan" : "weekend") : lang === "id" ? "hari kerja" : "weekday"} · ${lang === "id" ? "perkiraan" : "profile"}`}
              delay={0.2}
            />
            <DataCard
              icon={S.icon}
              label={lang === "id" ? "Skenario" : "Scenario"}
              value={t(lang, S.key)}
              detail={
                r.cells.length
                  ? `${r.cells.length} ${lang === "id" ? "sel badai buatan" : "synthetic storm cell(s)"}`
                  : lang === "id"
                    ? "cuaca sebenarnya"
                    : "real forecast only"
              }
              delay={0.3}
            />
          </motion.div>
        </Stage>

        <Stage
          n={2}
          title={t(lang, "search")}
          icon={Route}
          active={stage >= 1}
          done={stage >= 2}
        >
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {lang === "id"
              ? "Dijkstra bergantung waktu menyelesaikan "
              : "Time-dependent Dijkstra settled "}
            <b>
              <AnimatedNumber
                value={r.stats?.settled ?? 0}
                format={(v) => Math.round(v).toLocaleString()}
              />
            </b>
            {lang === "id" ? " halte dan mencoba " : " stops and tried "}
            <b>
              <AnimatedNumber
                value={r.stats?.relaxed ?? 0}
                format={(v) => Math.round(v).toLocaleString()}
              />
            </b>
            {lang === "id" ? " sambungan dalam " : " connections in "}
            <b>
              <AnimatedNumber
                value={r.stats?.ms ?? 0}
                format={(v) => `${Math.round(v)} ms`}
              />
            </b>
            {lang === "id"
              ? `, dua kali: β = 0 (tercepat) dan β = ${p.beta} (Anda). Hujan dibaca di tempat dan menit Anda tiba di tiap ruas.`
              : `, twice: β = 0 (fastest) and β = ${p.beta} (yours). Rain is read at the place and minute you reach each leg.`}
          </p>
        </Stage>

        <Stage
          n={3}
          title={t(lang, "scoreLegs")}
          icon={Footprints}
          active={stage >= 2}
          done={stage >= 3}
        >
          <div className="mb-2 rounded-xl bg-sky-50 px-3 py-2 text-center font-mono text-xs text-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
            c = τ · w · (1 + β · E · φ(r))
          </div>
          {tabs.length > 1 && (
            <div className="mb-2 flex gap-1">
              {tabs.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => setTab(x.id)}
                  className="relative rounded-full px-3 py-1 text-xs"
                >
                  {current?.id === x.id && (
                    <motion.span
                      layoutId="how-tab"
                      transition={spring.snappy}
                      className="absolute inset-0 rounded-full bg-slate-900 dark:bg-white"
                    />
                  )}
                  <span
                    className={`relative ${current?.id === x.id ? "text-white dark:text-slate-900" : ""}`}
                  >
                    {x.label}
                  </span>
                </button>
              ))}
            </div>
          )}
          <PhiCurve key={`phi-${current?.id}`} legs={legs} r0={p.r0} k={p.k} />
          <div key={`legs-${current?.id}`} className="space-y-1.5">
            {legs.map((g, i) => (
              <LegRow
                key={`${g.t0}-${g.kind}`}
                g={g}
                beta={p.beta}
                r0={p.r0}
                k={p.k}
                lang={lang}
                delay={0.2 + i * (ROW_MS / 1000)}
              />
            ))}
            {current && current.it.transfers > 0 && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 + legs.length * (ROW_MS / 1000) }}
                className="text-right text-xs text-slate-500"
              >
                + {current.it.transfers} × {TRANSFER_PENALTY_MIN}{" "}
                {lang === "id" ? "mnt penalti transit" : "min transfer penalty"}
              </motion.p>
            )}
          </div>
        </Stage>

        <Stage
          n={4}
          title={t(lang, "compare")}
          icon={Gauge}
          active={stage >= 3}
          done={stage >= 4}
        >
          <div className="space-y-2.5">
            {candidates.map((c, i) => (
              <motion.div
                key={c.label}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.35 }}
              >
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-medium">
                    {c.label}
                    <span className="flex gap-0.5">
                      {summaryModes(c.it)
                        .slice(0, 3)
                        .map((m, j) => (
                          <span
                            key={`${j}-${m.label}`}
                            className="rounded px-1 text-[10px] font-semibold text-white"
                            style={{ background: m.color }}
                          >
                            {m.label}
                          </span>
                        ))}
                    </span>
                  </span>
                  <span className="font-bold tabular-nums">
                    <AnimatedNumber
                      value={c.cost}
                      format={f1}
                      delay={i * 0.35}
                    />
                  </span>
                </div>
                <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <motion.div
                    className="h-full bg-slate-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${(c.time / max) * 100}%` }}
                    transition={{
                      duration: 0.6,
                      delay: i * 0.35,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  />
                  <motion.div
                    className="h-full bg-amber-400"
                    initial={{ width: 0 }}
                    animate={{ width: `${((c.cost - c.time) / max) * 100}%` }}
                    transition={{
                      duration: 0.5,
                      delay: i * 0.35 + 0.55,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  />
                </div>
              </motion.div>
            ))}
            <div className="flex gap-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-slate-500" />{" "}
                {t(lang, "timePart")} (τ·w)
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-amber-400" />{" "}
                {t(lang, "rainPart")} (τ·w·β·E·φ)
              </span>
            </div>
          </div>
        </Stage>

        <Stage
          n={5}
          title={t(lang, "decision")}
          icon={Trophy}
          active={stage >= 4}
          done={false}
        >
          {winner && (
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={spring.soft}
              className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100"
            >
              <p className="font-semibold">
                {winner.label} · {f1(winner.cost)}{" "}
                {lang === "id" ? "menit terasa" : "perceived min"}
              </p>
              <p className="mt-1 text-xs">
                {r.shift && r.explain
                  ? lang === "id"
                    ? `Lebih lambat ${Math.round(r.explain.extraMin)} menit dari yang tercepat, tapi ${Math.round(r.explain.doseSavedPct)}% lebih sedikit hujan. Pada β = ${p.beta}, hujan yang dihindari bernilai lebih dari waktu tambahan.`
                    : `${Math.round(r.explain.extraMin)} min slower than the fastest, but ${Math.round(r.explain.doseSavedPct)}% less rain. At β = ${p.beta}, the rain avoided is worth more than the extra time.`
                  : lang === "id"
                    ? "Rute tercepat juga punya biaya total terendah, jadi tidak perlu pindah moda."
                    : "The fastest route also has the lowest total cost, so no modal shift is needed."}
              </p>
            </motion.div>
          )}
          <div className="mt-4">
            <Signature lang={lang} compact />
          </div>
        </Stage>
      </div>
    </div>
  );
}
