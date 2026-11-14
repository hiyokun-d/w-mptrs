"use client";

import {
  Bus,
  CloudRain,
  Pause,
  Play,
  SkipForward,
  Square,
  Umbrella,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type Alert,
  alertText,
  planAlerts,
  positionAt,
} from "@/lib/core/alerts";
import { arrivalRange } from "@/lib/core/predict";
import { RainField, type RainGrid } from "@/lib/core/rainfield";
import { rescore } from "@/lib/core/router";
import { type RainReport, shiftCells } from "@/lib/core/scenarios";
import { nextArrivalSec } from "@/lib/core/vehicles";
import { t } from "@/lib/i18n";
import { db, deviceId } from "@/lib/local/db";
import { planTrip } from "@/lib/local/planner";
import { chosen, useApp } from "@/lib/store/app";
import { useNotes } from "@/lib/store/notify";
import { clock, dur, legTitle, mm } from "./format";
import { RainStrip } from "./Itinerary";
import { spring } from "./motion";
import { useTripNotes } from "./tripNotes";

const SPEEDS = [1, 10, 30, 60, 120];

async function notify(title: string, body: string) {
  if (
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  )
    return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg)
      await reg.showNotification(title, {
        body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: "rain-alert",
      });
    else new Notification(title, { body });
    navigator.vibrate?.([120, 60, 120]);
  } catch {
    // notifications unavailable
  }
}

/**
 * Follows the planned trip in time. The clock is real time (speed 1) or
 * fast-forward for demos; position is interpolated along the plan.
 */
export function TripView({
  grid,
  onTime,
  compact = false,
}: {
  grid: RainGrid | null;
  onTime: (t: number | null) => void;
  /** minimised sheet: keep the clock and alerts running, show one line */
  compact?: boolean;
}) {
  const { lang, result, trip, set, scenario } = useApp();
  const [now, setNow] = useState(() => result?.depart ?? Date.now());
  const fired = useRef(new Set<number>());
  const base = trip ? chosen(result, trip.choice) : null;

  // the trip is re-scored when a newer forecast arrives
  const it = useMemo(() => {
    if (!base || !result) return base ?? null;
    return rescore(
      base,
      new RainField(grid, result.cells, result.depart),
      result.params,
    );
  }, [base, grid, result]);
  const alerts: Alert[] = useMemo(() => (it ? planAlerts(it) : []), [it]);

  // the clock carries on from where it is when the speed changes
  const nowRef = useRef(now);
  useEffect(() => {
    nowRef.current = now;
  }, [now]);
  const speed = trip?.speed ?? 1;
  const [paused, setPaused] = useState(false);
  // bumped on every seek, so the clock restarts from the new time
  const [epoch, setEpoch] = useState(0);
  const running = !!trip && !!result && !paused;
  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch restarts the clock after a seek
  useEffect(() => {
    if (!running) return;
    const start = Date.now();
    const t0 = nowRef.current;
    const tick = speed > 10 ? 250 : 500;
    const id = setInterval(
      () => setNow(t0 + (Date.now() - start) * speed),
      tick,
    );
    return () => clearInterval(id);
  }, [running, speed, epoch]);
  const seek = (t: number) => {
    nowRef.current = t;
    setNow(t);
    setEpoch((e) => e + 1);
  };

  useEffect(() => {
    onTime(trip ? now : null);
  }, [now, trip, onTime]);

  useEffect(() => {
    alerts.forEach((a, i) => {
      if (now >= a.issueAt && !fired.current.has(i) && !a.covered) {
        fired.current.add(i);
        const tx = alertText(a, now, lang);
        void notify(`☂ ${tx.headline}`, tx.advice);
      }
    });
  }, [now, alerts, lang]);

  useTripNotes(it, alerts, now, !!trip, lang);

  // ── "is it raining where you are?" ────────────────────────────────────
  // Asked when you meet rain the forecast didn't have (a sudden downpour),
  // halfway if nothing was asked yet, and on arrival. A "yes" becomes a
  // rain report: it joins the forecast, is pinned on the map, is kept for
  // research, and the rest of the trip is planned again with it.
  const [ask, setAsk] = useState<{
    moment: "mid" | "end";
    surprise: boolean;
    at: number;
    lat: number;
    lng: number;
    forecast: number;
  } | null>(null);
  const asked = useRef({ mid: false, end: false });
  const replanAt = useRef<{
    at: number;
    from: { lat: number; lng: number; name?: string };
  } | null>(null);
  // a new plan (or a new trip) starts the questions over, except at the end
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per trip
  useEffect(() => {
    fired.current.clear();
  }, [result]);
  useEffect(() => {
    if (!trip) asked.current = { mid: false, end: false };
  }, [trip]);
  const truth = useMemo(
    () =>
      result ? new RainField(grid, result.cells, result.depart, true) : null,
    [grid, result],
  );
  const forecastField = useMemo(
    () => (result ? new RainField(grid, result.cells, result.depart) : null),
    [grid, result],
  );
  useEffect(() => {
    if (!it || !trip || !truth || !forecastField || ask) return;
    const at = Math.min(now, it.arrive);
    const me = positionAt(it, at);
    const real = truth.at(me.lat, me.lng, at);
    const fc = forecastField.at(me.lat, me.lng, at);
    const a = asked.current;
    const open = (moment: "mid" | "end", surprise: boolean) => {
      setAsk({ moment, surprise, at, lat: me.lat, lng: me.lng, forecast: fc });
      // a fast demo waits for the answer
      if ((trip.speed ?? 1) > 1) setPaused(true);
    };
    if (now >= it.arrive) {
      if (!a.end) {
        a.end = true;
        open("end", false);
      }
      return;
    }
    // rain the forecast missed asks early; once mid-trip, once at the end
    if (!a.mid && real - fc >= 1.5) {
      a.mid = true;
      open("mid", true);
      return;
    }
    const half = (now - it.depart) / (it.arrive - it.depart || 1) >= 0.5;
    if (half && !a.mid) {
      a.mid = true;
      open("mid", false);
    }
  }, [now, it, trip, truth, forecastField, ask]);

  const replan = async (
    from: { lat: number; lng: number; name?: string },
    at: number,
  ) => {
    const st = useApp.getState();
    const dest = st.to;
    if (!dest || !st.trip) return;
    try {
      const r = await planTrip({
        from,
        to: dest,
        depart: at,
        beta: st.beta,
        moto: st.moto,
        scenario: st.scenario,
        vot: st.vot,
        maxOjek: st.maxOjek,
        reports: st.reports,
        // the storms carry on where they were; reports are added fresh
        cells: result
          ? shiftCells(
              result.cells.filter((c) => !c.reported),
              at - result.depart,
            )
          : undefined,
      });
      const choice = r.shift ? "weatherAware" : "fastest";
      const was = base;
      const now2 = chosen(r, choice);
      const same =
        !!was &&
        !!now2 &&
        now2.legs
          .filter((g) => g.kind === "ride")
          .map((g) => g.route?.short)
          .join() ===
          was.legs
            .filter((g) => g.kind === "ride" && g.t0 >= at)
            .map((g) => g.route?.short)
            .join();
      set({ result: r, choice, trip: { ...st.trip, choice } });
      useNotes.getState().push({
        key: `replan-${at}`,
        kind: "rain",
        level: "major",
        at,
        title:
          lang === "id"
            ? "Rute dicek ulang dengan laporanmu"
            : "Route re-checked with your report",
        body: same
          ? lang === "id"
            ? "Rute ini tetap yang terbaik."
            : "This route is still the best."
          : lang === "id"
            ? `Sekarang: ${
                now2?.legs
                  .filter((g) => g.kind === "ride" || g.kind === "moto")
                  .map((g) => (g.kind === "moto" ? "Ojek" : g.route?.short))
                  .join(" → ") || "jalan kaki"
              }`
            : `Now: ${
                now2?.legs
                  .filter((g) => g.kind === "ride" || g.kind === "moto")
                  .map((g) => (g.kind === "moto" ? "Ojek" : g.route?.short))
                  .join(" → ") || "walk"
              }`,
      });
    } catch {
      // offline and nothing cached: keep the trip as it is
    }
  };
  // a report made on board waits until you get off to re-plan
  useEffect(() => {
    const r = replanAt.current;
    if (r && now >= r.at) {
      replanAt.current = null;
      void replan(r.from, r.at);
    }
  });

  const answer = (mmh: number) => {
    const q = ask;
    if (!q || !it) return;
    setAsk(null);
    setPaused(false);
    const rep: RainReport = { lat: q.lat, lng: q.lng, t: q.at, mmh };
    const st = useApp.getState();
    set({ reports: [...st.reports, rep].slice(-20) });
    void (async () => {
      try {
        await fetch("/api/reports", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...rep,
            deviceId: await deviceId(),
            forecastMmh: q.forecast,
            moment: q.moment,
            scenario,
            simulated: (trip?.speed ?? 1) > 1 || scenario !== "live",
          }),
        });
      } catch {
        // offline: the report still counts on this device
      }
    })();
    if (mmh > 0)
      useNotes.getState().push({
        key: `report-${q.at}`,
        kind: "rain",
        at: q.at,
        title:
          lang === "id" ? "Ditandai: hujan di sini" : "Marked: raining here",
        body:
          lang === "id"
            ? "Terima kasih! Laporanmu masuk ke prakiraan."
            : "Thanks! Your report is now part of the forecast.",
      });
    if (mmh <= 0 || q.moment === "end") return;
    // on a bus or an ojek: re-plan from where you get off
    const cur = it.legs.find((g) => q.at < g.t1);
    if (
      cur &&
      (cur.kind === "ride" || cur.kind === "moto") &&
      cur.t1 - q.at > 60_000
    )
      replanAt.current = { at: cur.t1, from: { ...cur.to } };
    else
      void replan(
        {
          lat: q.lat,
          lng: q.lng,
          name: lang === "id" ? "Posisimu" : "Your position",
        },
        q.at,
      );
  };

  if (!it || !trip) return null;
  const end = async () => {
    try {
      await db.trips.add({
        startedAt: trip.startedAt,
        endedAt: Date.now(),
        from: it.legs[0]?.from.name ?? "",
        to: it.legs[it.legs.length - 1]?.to.name ?? "",
        type: it.type,
        minutes: it.minutes,
        dose: it.dose,
        shift: !!result?.shift,
      });
    } catch {
      // storage unavailable
    }
    onTime(null);
    set({ trip: null, sheet: "results" });
  };

  const done = now >= it.arrive;
  const cur = it.legs.find((g) => now < g.t1) ?? it.legs[it.legs.length - 1];
  const next = it.legs[it.legs.indexOf(cur) + 1];
  const active = alerts.find((a) => now >= a.issueAt && now <= a.until);
  const tx = active ? alertText(active, now, lang) : null;
  const range = arrivalRange(it);
  // the next bus/train you'll board, with its estimated arrival at your stop
  const busLeg = it.legs.find((g) => g.kind === "ride" && g.t0 > now - 30_000);
  const busEta = busLeg ? nextArrivalSec(busLeg, now) : null;
  const progress = Math.min(
    1,
    (now - it.depart) / (it.arrive - it.depart || 1),
  );

  return (
    <>
      <AnimatePresence>
        {tx && active && (
          // drops in when the alert is issued, leaves when the rain is behind you
          <motion.div
            key={active.issueAt}
            initial={{ y: -90, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -90, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            className={`pointer-events-auto fixed inset-x-3 top-3 z-[1001] mx-auto max-w-xl rounded-2xl p-3 shadow-xl ${active.covered ? "bg-sky-600 text-white" : "bg-amber-400 text-slate-950"}`}
            role="alert"
          >
            <div className="flex items-start gap-2">
              {active.covered ? (
                <Umbrella className="mt-0.5 size-5 shrink-0" />
              ) : (
                <CloudRain className="mt-0.5 size-5 shrink-0" />
              )}
              <div>
                <div className="font-bold leading-tight">{tx.headline}</div>
                <div className="text-sm">{tx.advice}</div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {ask && (
          <motion.div
            key={`ask-${ask.at}`}
            initial={{ y: -90, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -90, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            className="pointer-events-auto fixed inset-x-3 top-3 z-[1002] mx-auto max-w-xl rounded-2xl bg-[#050b2e] p-3 text-white shadow-[6px_6px_0_#1546ff]"
            role="dialog"
            aria-label={lang === "id" ? "Laporan hujan" : "Rain report"}
          >
            <div className="flex items-start gap-2">
              <CloudRain className="mt-0.5 size-5 shrink-0 text-[#33d6ff]" />
              <div className="flex-1">
                <div className="font-bold leading-tight">
                  {ask.moment === "end"
                    ? lang === "id"
                      ? "Sudah sampai. Apakah hujan di sini?"
                      : "You've arrived. Is it raining here?"
                    : lang === "id"
                      ? "Apakah sedang hujan di tempatmu?"
                      : "Is it raining where you are?"}
                </div>
                <div className="text-sm text-slate-300">
                  {ask.surprise
                    ? lang === "id"
                      ? "Prakiraan tidak melihat hujan di sini. Jawabanmu menandai tempat ini dan rute dihitung ulang."
                      : "The forecast didn't see rain here. Your answer marks this spot and re-plans the route."
                    : lang === "id"
                      ? "Jawabanmu membantu memperbaiki prakiraan."
                      : "Your answer helps correct the forecast."}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {(
                    [
                      [0, lang === "id" ? "Tidak" : "No"],
                      [3, lang === "id" ? "Gerimis" : "Light"],
                      [15, lang === "id" ? "Deras" : "Heavy"],
                    ] as const
                  ).map(([v, label]) => (
                    <motion.button
                      key={v}
                      type="button"
                      whileTap={{ scale: 0.94 }}
                      onClick={() => answer(v)}
                      className={`h-10 rounded-xl text-sm font-bold ${v === 0 ? "border border-white/30" : v === 3 ? "bg-sky-500" : "bg-[#1546ff]"}`}
                    >
                      {label}
                    </motion.button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 tabular-nums">
              {clock(now)}
              {speed > 1 && (
                <span className="rounded bg-sky-100 px-1 font-semibold text-sky-700">
                  {paused ? "❚❚" : `${speed}×`}
                </span>
              )}
            </div>
            {/* the title rolls over when you reach the next leg */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={done ? "done" : cur.t0}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.22 }}
                className={`${compact ? "text-base" : "text-lg"} font-bold leading-tight`}
              >
                {done
                  ? lang === "id"
                    ? "Sampai! 🎉"
                    : "Arrived! 🎉"
                  : legTitle(cur, lang)}
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">{t(lang, "arrive")}</div>
            <div className="text-lg font-bold tabular-nums">
              {clock(it.arrive)}
            </div>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {!compact && (
            <motion.div
              key="details"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
              className="space-y-3 overflow-hidden"
            >
              <div className="relative">
                <RainStrip it={it} />
                <div
                  className="absolute -top-1 h-4 w-0.5 bg-slate-900 transition-[left] duration-500 ease-linear dark:bg-white"
                  style={{ left: `${progress * 100}%` }}
                />
              </div>
              {!done && next && (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {lang === "id" ? "Berikutnya" : "Next"}:{" "}
                  {legTitle(next, lang)} · {clock(next.t0)} (
                  {dur((next.t0 - now) / 60_000, lang)})
                </p>
              )}
              {busLeg && busEta !== null && busEta > -30 && busEta < 1800 && (
                <motion.p
                  layout
                  className="flex items-center gap-1.5 text-sm text-sky-700 dark:text-sky-300"
                >
                  <Bus className="size-4" />
                  {busLeg.route?.short} ·{" "}
                  {busEta <= 30
                    ? lang === "id"
                      ? "tiba sekarang"
                      : "arriving now"
                    : `${lang === "id" ? "tiba" : "arrives in"} ~${Math.ceil(busEta / 60)} ${t(lang, "min")}`}
                  <span className="text-xs text-slate-500">
                    ({t(lang, "estimated")})
                  </span>
                </motion.p>
              )}
              <p className="text-xs text-slate-500">
                {mm(it.dose)} {t(lang, "rainDose")} ·{" "}
                {lang === "id"
                  ? "prakiraan diperbarui otomatis"
                  : "forecast refreshes automatically"}
              </p>
              {/* simulation controls: play/pause, speed, scrub, jump to the next event */}
              <div className="space-y-2 rounded-2xl bg-slate-50 p-2.5 dark:bg-slate-900">
                <div className="flex items-center gap-2">
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.9 }}
                    aria-label={paused ? "Play" : "Pause"}
                    onClick={() => setPaused((p) => !p)}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={String(paused)}
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.5, opacity: 0 }}
                        transition={{ duration: 0.12 }}
                      >
                        {paused ? (
                          <Play className="size-4" />
                        ) : (
                          <Pause className="size-4" />
                        )}
                      </motion.span>
                    </AnimatePresence>
                  </motion.button>
                  <div className="flex flex-1 rounded-full bg-white p-0.5 shadow-inner dark:bg-slate-800">
                    {SPEEDS.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => set({ trip: { ...trip, speed: v } })}
                        className="relative flex-1 rounded-full py-1 text-xs font-semibold tabular-nums"
                      >
                        {speed === v && (
                          <motion.span
                            layoutId="trip-speed"
                            transition={spring.snappy}
                            className="absolute inset-0 rounded-full bg-sky-600"
                          />
                        )}
                        <span
                          className={`relative ${speed === v ? "text-white" : "text-slate-600 dark:text-slate-300"}`}
                        >
                          {v}×
                        </span>
                      </button>
                    ))}
                  </div>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.9, x: 3 }}
                    aria-label={
                      lang === "id"
                        ? "Lompat ke kejadian berikutnya"
                        : "Jump to next event"
                    }
                    onClick={() => {
                      const events = [
                        ...it.legs.map((g) => g.t0 - 30_000),
                        ...alerts.map((a) => a.issueAt),
                        it.arrive,
                      ]
                        .filter((x) => x > now + 1000)
                        .sort((a, b) => a - b);
                      if (events.length) seek(events[0]);
                    }}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full border border-slate-200 dark:border-slate-700"
                  >
                    <SkipForward className="size-4" />
                  </motion.button>
                </div>
                <input
                  type="range"
                  aria-label={
                    lang === "id" ? "Waktu simulasi" : "Simulation time"
                  }
                  min={it.depart}
                  max={it.arrive + 60_000}
                  step={15_000}
                  value={Math.min(now, it.arrive + 60_000)}
                  onChange={(e) => seek(Number(e.target.value))}
                  className="w-full accent-sky-600"
                />
                <div className="flex justify-between text-[11px] text-slate-500 tabular-nums">
                  <span>{clock(it.depart)}</span>
                  <span>
                    {lang === "id" ? "perkiraan tiba" : "likely"}{" "}
                    {clock(range.p10)}–{clock(range.p90)}
                  </span>
                  <span>{clock(it.arrive)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={end}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-semibold text-white dark:bg-white dark:text-slate-900"
              >
                <Square className="size-4" /> {t(lang, "endTrip")}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
