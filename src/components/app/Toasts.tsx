"use client";

import {
  Bell,
  Bus,
  CloudRain,
  Flag,
  Footprints,
  Info,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { type Lang, t } from "@/lib/i18n";
import { type NoteKind, useNotes } from "@/lib/store/notify";
import { clock } from "./format";
import { spring } from "./motion";

const ICON: Record<NoteKind, typeof Bell> = {
  action: Footprints,
  rain: CloudRain,
  vehicle: Bus,
  predict: Sparkles,
  arrive: Flag,
  info: Info,
};
const TINT: Record<NoteKind, string> = {
  action: "bg-slate-900 text-white",
  rain: "bg-amber-400 text-slate-950",
  vehicle: "bg-sky-600 text-white",
  predict: "bg-violet-600 text-white",
  arrive: "bg-emerald-600 text-white",
  info: "bg-white text-slate-900",
};

/**
 * Notes by importance: an emergency is a red banner across the very top,
 * a note that needs action now sits under the top bar, and everything else
 * is a small pill at the bottom, just above the sheet, out of the way.
 */
export function Toasts({ top, bottom }: { top: number; bottom: number }) {
  const { notes, toasts, dismiss } = useNotes();
  const shown = toasts
    .map((k) => notes.find((n) => n.key === k))
    .filter((n) => !!n);
  const by = (l: string) => shown.filter((n) => (n.level ?? "minor") === l);
  const swipe = (key: string) => ({
    drag: "x" as const,
    dragConstraints: { left: 0, right: 0 },
    onDragEnd: (_: unknown, info: { offset: { x: number } }) =>
      Math.abs(info.offset.x) > 60 && dismiss(key),
  });
  const close = (key: string) => (
    <button
      type="button"
      aria-label="Dismiss"
      onClick={() => dismiss(key)}
      className="opacity-70"
    >
      <X className="size-4" />
    </button>
  );
  return (
    <>
      {/* emergency: over everything, impossible to miss */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[1100] flex flex-col">
        <AnimatePresence>
          {by("emergency").map((n) => (
            <motion.output
              key={n.key}
              layout
              initial={{ y: -80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -80, opacity: 0 }}
              transition={spring.snappy}
              {...swipe(n.key)}
              className="pointer-events-auto flex items-center gap-3 bg-red-600 px-4 pt-[max(.6rem,env(safe-area-inset-top))] pb-2.5 text-white shadow-2xl"
            >
              <motion.span
                animate={{ scale: [1, 1.25, 1] }}
                transition={{ duration: 0.9, repeat: Number.POSITIVE_INFINITY }}
              >
                <TriangleAlert className="size-5" />
              </motion.span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">{n.title}</div>
                {n.body && <div className="text-xs opacity-90">{n.body}</div>}
              </div>
              {close(n.key)}
            </motion.output>
          ))}
        </AnimatePresence>
      </div>

      {/* needs action now: under the top bar */}
      <div
        className="pointer-events-none fixed inset-x-0 z-[1050] flex flex-col items-center gap-1.5 px-3"
        style={{ top }}
      >
        <AnimatePresence initial={false}>
          {by("major").map((n) => {
            const Icon = ICON[n.kind];
            return (
              <motion.output
                key={n.key}
                layout
                initial={{ opacity: 0, y: -24, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 60, transition: { duration: 0.2 } }}
                transition={spring.soft}
                {...swipe(n.key)}
                className={`pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-2xl px-3 py-2 shadow-xl ${TINT[n.kind]}`}
              >
                <Icon className="size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold leading-tight">
                    {n.title}
                  </div>
                  {n.body && (
                    <div className="truncate text-xs opacity-90">{n.body}</div>
                  )}
                </div>
                {close(n.key)}
              </motion.output>
            );
          })}
        </AnimatePresence>
      </div>

      {/* everything else: one small pill above the sheet */}
      <div
        className="pointer-events-none fixed inset-x-0 z-[640] flex flex-col-reverse items-center gap-1 px-3"
        style={{ bottom }}
      >
        <AnimatePresence initial={false}>
          {by("minor").map((n) => {
            const Icon = ICON[n.kind];
            return (
              <motion.output
                key={n.key}
                layout
                initial={{ opacity: 0, y: 12, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{
                  opacity: 0,
                  scale: 0.9,
                  transition: { duration: 0.15 },
                }}
                transition={spring.snappy}
                {...swipe(n.key)}
                className={`pointer-events-auto flex max-w-[85vw] items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium shadow-lg sm:max-w-xs ${TINT[n.kind]}`}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{n.title}</span>
              </motion.output>
            );
          })}
        </AnimatePresence>
      </div>
    </>
  );
}

/** Bell with an unread count; opens the list of everything announced. */
export function Inbox({ lang }: { lang: Lang }) {
  const { notes, markRead, clear } = useNotes();
  const [open, setOpen] = useState(false);
  const unread = notes.filter((n) => !n.read).length;
  return (
    <div className="pointer-events-auto relative">
      <motion.button
        type="button"
        whileTap={{ scale: 0.9 }}
        aria-label={t(lang, "notifications2")}
        onClick={() => {
          setOpen((o) => !o);
          markRead();
        }}
        className="relative flex size-8 items-center justify-center rounded-full bg-white/95 shadow"
      >
        <motion.span
          key={notes[0]?.key ?? "none"}
          animate={notes.length ? { rotate: [0, -18, 14, -8, 0] } : {}}
          transition={{ duration: 0.6 }}
        >
          <Bell className="size-4 text-slate-800" />
        </motion.span>
        <AnimatePresence>
          {unread > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -top-1 -right-1 flex min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white"
            >
              {unread}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={spring.snappy}
            style={{ transformOrigin: "top right" }}
            className="absolute top-10 right-0 z-10 max-h-[60dvh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl bg-white p-2 shadow-2xl ring-1 ring-black/5"
          >
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-sm font-semibold text-slate-900">
                {t(lang, "notifications2")}
              </span>
              {notes.length > 0 && (
                <button
                  type="button"
                  onClick={clear}
                  className="text-xs text-slate-500"
                >
                  {lang === "id" ? "Hapus" : "Clear"}
                </button>
              )}
            </div>
            {notes.length === 0 && (
              <p className="px-2 py-3 text-xs text-slate-500">
                {lang === "id" ? "Belum ada kabar." : "Nothing yet."}
              </p>
            )}
            {notes.map((n) => {
              const Icon = ICON[n.kind];
              return (
                <div
                  key={n.key}
                  className="flex gap-2 rounded-xl px-2 py-1.5 text-slate-900 hover:bg-slate-50"
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-slate-500" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold">
                      <span className="mr-1 font-normal text-slate-400 tabular-nums">
                        {clock(n.at)}
                      </span>
                      {n.title}
                    </div>
                    {n.body && (
                      <div className="text-[11px] text-slate-500">{n.body}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
