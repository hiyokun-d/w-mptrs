"use client";

import { CalendarClock, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { costOf, type Itinerary } from "@/lib/core/router";
import { t } from "@/lib/i18n";
import { planTrip } from "@/lib/local/planner";
import { useApp } from "@/lib/store/app";
import { clock, mm } from "./format";
import { spring } from "./motion";

const OFFSETS = [0, 15, 30, 45, 60];

interface Slot {
  at: number;
  it: Itinerary | null;
  cost: number;
}

/**
 * "Leave later?": the same trip planned at 15-minute steps over the next
 * hour, so a passing storm shows up as a dip in the bars. Planned only when
 * asked, and not logged as research data.
 */
export function LeaveLater() {
  const { lang, result, from, to, moto, scenario, beta, vot, maxOjek, set } =
    useApp();
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [busy, setBusy] = useState(false);
  if (!result || !from || !to) return null;
  const base = result.depart;

  const load = async () => {
    setBusy(true);
    const out = await Promise.all(
      OFFSETS.map(async (m): Promise<Slot> => {
        const at = base + m * 60_000;
        if (m === 0) {
          const it = result.weatherAware;
          return {
            at,
            it,
            cost: it ? costOf(it, result.params) : Number.POSITIVE_INFINITY,
          };
        }
        try {
          const r = await planTrip({
            from,
            to,
            depart: at,
            beta,
            moto,
            scenario,
            vot,
            maxOjek,
            log: false,
          });
          const it = r.weatherAware;
          return {
            at,
            it,
            cost: it ? costOf(it, r.params) : Number.POSITIVE_INFINITY,
          };
        } catch {
          return { at, it: null, cost: Number.POSITIVE_INFINITY };
        }
      }),
    );
    setSlots(out);
    setBusy(false);
  };

  const maxDose = Math.max(0.2, ...(slots ?? []).map((s) => s.it?.dose ?? 0));
  const best = slots?.reduce<Slot | null>(
    (b, s) =>
      s.it &&
      (!b || s.it.dose < (b.it?.dose ?? Number.POSITIVE_INFINITY) - 0.05)
        ? s
        : b,
    null,
  );

  return (
    <div className="rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
      <button
        type="button"
        onClick={slots ? () => setSlots(null) : load}
        className="flex w-full items-center justify-between text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          <CalendarClock className="size-4" /> {t(lang, "leaveLater")}
        </span>
        {busy && <Loader2 className="size-4 animate-spin text-slate-400" />}
      </button>
      <AnimatePresence>
        {slots && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring.soft}
            className="overflow-hidden"
          >
            <div className="mt-3 flex h-24 items-end gap-2">
              {slots.map((s, i) => {
                const h = s.it ? Math.max(4, (s.it.dose / maxDose) * 100) : 4;
                const isBest = best === s && i > 0;
                return (
                  <button
                    key={s.at}
                    type="button"
                    onClick={() => set({ depart: i === 0 ? null : s.at })}
                    className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                  >
                    <span className="text-[10px] text-slate-500 tabular-nums">
                      {s.it ? mm(s.it.dose) : "–"}
                    </span>
                    <motion.div
                      className={`w-full rounded-t-lg ${isBest ? "bg-emerald-500" : "bg-sky-500/70"}`}
                      initial={{ height: 0 }}
                      animate={{ height: `${h}%` }}
                      transition={{ ...spring.soft, delay: i * 0.07 }}
                    />
                  </button>
                );
              })}
            </div>
            <div className="mt-1 flex gap-2">
              {slots.map((s, i) => (
                <span
                  key={s.at}
                  className="flex-1 text-center text-[11px] text-slate-500 tabular-nums"
                >
                  {i === 0 ? t(lang, "now") : clock(s.at)}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
              {best && best !== slots[0]
                ? lang === "id"
                  ? `Berangkat ${clock(best.at)} paling kering (${mm(best.it?.dose ?? 0)}). Ketuk batang untuk merencanakan ulang.`
                  : `Leaving at ${clock(best.at)} is driest (${mm(best.it?.dose ?? 0)}). Tap a bar to re-plan.`
                : lang === "id"
                  ? "Berangkat sekarang sudah pilihan terbaik dalam satu jam ke depan."
                  : "Leaving now is already the best choice for the next hour."}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
