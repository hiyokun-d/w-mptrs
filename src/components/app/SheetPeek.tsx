"use client";

import { ChevronUp, CloudRain, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { BRAND } from "@/lib/brand";
import { t } from "@/lib/i18n";
import { chosen, useApp } from "@/lib/store/app";
import { mm, summaryModes } from "./format";
import { Duration, spring } from "./motion";

/**
 * The minimised sheet: one line that says what the full sheet holds. The
 * chosen trip's time and modes morph here from its option card.
 */
export function SheetPeek({
  view,
  onOpen,
}: {
  view: string;
  onOpen: () => void;
}) {
  const { lang, result, choice } = useApp();
  const it = result ? chosen(result, choice) : null;

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="flex w-full items-center gap-3 text-left"
    >
      {view === "loading" ? (
        <span className="flex flex-1 items-center gap-2 text-sm text-slate-500">
          <Loader2 className="size-4 animate-spin" /> {t(lang, "searching")}
        </span>
      ) : (view === "results" || view === "how") && it ? (
        <>
          <motion.div layoutId="chosen-time" transition={spring.soft}>
            <Duration minutes={it.minutes} lang={lang} />
          </motion.div>
          <motion.div
            layoutId="chosen-modes"
            transition={spring.soft}
            className="flex min-w-0 flex-1 flex-wrap gap-1"
          >
            {summaryModes(it)
              .slice(0, 4)
              .map((m, i) => (
                <span
                  key={`${i}-${m.label}`}
                  className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-white"
                  style={{ background: m.color }}
                >
                  {m.label}
                </span>
              ))}
          </motion.div>
          <span className="flex shrink-0 items-center gap-1 text-sm">
            <CloudRain
              className={`size-4 ${it.dose >= 0.05 ? "text-blue-600" : "text-slate-400"}`}
            />
            <span className="font-semibold tabular-nums">{mm(it.dose)}</span>
          </span>
        </>
      ) : (
        <span className="flex-1 truncate text-sm font-semibold">
          {view === "settings" ? t(lang, "settings") : BRAND.app}
          <span className="ml-2 font-normal text-slate-500">
            {view === "settings" ? "" : t(lang, "searchPlace")}
          </span>
        </span>
      )}
      <ChevronUp className="size-5 shrink-0 text-slate-400" />
    </motion.button>
  );
}
