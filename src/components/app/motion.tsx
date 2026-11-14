"use client";

import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useTransform,
} from "motion/react";
import { useEffect, useRef } from "react";
import { BRAND } from "@/lib/brand";
import type { Lang } from "@/lib/i18n";

// One spring vocabulary for the whole app, so every movement feels related:
// `soft` for content that follows a user action, `snappy` for small toggles.
export const spring = {
  soft: { type: "spring", stiffness: 260, damping: 30, mass: 0.9 },
  snappy: { type: "spring", stiffness: 520, damping: 34 },
} as const;

/** Content swapped inside the sheet: rises in, sinks out. */
export const sheetSwap = {
  initial: { opacity: 0, y: 14, filter: "blur(2px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -8, filter: "blur(2px)" },
  transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
} as const;

/** Parent/child variants: children follow one another in reading order. */
export const stagger = (gap = 0.06, delay = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren: gap, delayChildren: delay } },
});
export const rise = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: spring.soft },
};

/**
 * A number that counts from its previous value to the new one, so a change
 * (a new β, a new forecast) is visible as a change rather than a swap.
 */
export function AnimatedNumber({
  value,
  format = (v) => v.toFixed(0),
  delay = 0,
  duration = 0.7,
}: {
  value: number;
  format?: (v: number) => string;
  delay?: number;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    if (!inView) return;
    const c = animate(mv, value, { duration, delay, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [value, inView, delay, duration, mv]);
  return (
    <motion.span ref={ref} className="tabular-nums">
      {text}
    </motion.span>
  );
}

/** Minutes as "1 h 9 min" / "1 j 9 mnt"; under an hour, just minutes. */
export function Duration({
  minutes,
  lang,
  big = false,
}: {
  minutes: number;
  lang: Lang;
  big?: boolean;
}) {
  const m = Math.max(1, Math.round(minutes));
  const h = Math.floor(m / 60);
  const num = big ? "text-2xl font-bold" : "font-semibold";
  const unit = "text-sm text-slate-500";
  const minU = lang === "id" ? "mnt" : "min";
  return (
    <span className="inline-flex items-baseline gap-1">
      {h > 0 && (
        <>
          <span className={num}>
            <AnimatedNumber value={h} />
          </span>
          <span className={unit}>{lang === "id" ? "j" : "h"}</span>
        </>
      )}
      <span className={num}>
        <AnimatedNumber value={m - h * 60} />
      </span>
      <span className={unit}>{minU}</span>
    </span>
  );
}

/** The project signature: the mark draws itself once, then rests. */
export function Signature({
  lang,
  compact = false,
}: {
  lang: Lang;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 ${compact ? "text-[11px]" : "text-xs"} text-slate-500`}
    >
      <svg
        viewBox="0 0 24 24"
        className={compact ? "size-4" : "size-5"}
        aria-hidden="true"
      >
        <motion.path
          d="M4 12a8 8 0 0 1 16 0z"
          fill="none"
          stroke="#0284c7"
          strokeWidth={2}
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, ease: "easeInOut" }}
        />
        <motion.path
          d="M12 12v6a2 2 0 0 1-4 0"
          fill="none"
          stroke="#0284c7"
          strokeWidth={2}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5, delay: 0.8 }}
        />
      </svg>
      <span>
        <span className="font-semibold text-slate-700 dark:text-slate-200">
          {BRAND.app}
        </span>{" "}
        · {BRAND.project} · {lang === "id" ? "oleh" : "by"}{" "}
        <span className="font-medium">{BRAND.by}</span> © {BRAND.year}
      </span>
    </div>
  );
}
