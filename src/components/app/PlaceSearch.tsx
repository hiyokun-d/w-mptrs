"use client";

import {
  ArrowLeft,
  Briefcase,
  Clock,
  House,
  LocateFixed,
  MapPin,
  Star,
  TrainFront,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Point } from "@/lib/core/router";
import { t } from "@/lib/i18n";
import { db, type Place, rememberRecent } from "@/lib/local/db";
import { useApp } from "@/lib/store/app";

interface Hit {
  name: string;
  detail: string;
  lat: number;
  lng: number;
  kind: string;
}

const placeIcon = (k: Place["kind"]) =>
  k === "home" ? (
    <House className="size-4" />
  ) : k === "work" ? (
    <Briefcase className="size-4" />
  ) : k === "saved" ? (
    <Star className="size-4" />
  ) : (
    <Clock className="size-4" />
  );

export function PlaceSearch() {
  const { lang, editing, setPoint, set } = useApp();
  const origin = useApp((s) => s.searchOrigin);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [locating, setLocating] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    db.places
      .orderBy("updatedAt")
      .reverse()
      .toArray()
      .then(setPlaces)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/geocode?q=${encodeURIComponent(q.trim())}`, {
        signal: ctl.signal,
      })
        .then((r) => r.json())
        .then(setHits)
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
  }, [q]);

  if (!editing) return null;
  const ox = origin?.x ?? 60;
  const oy = origin?.y ?? 40;
  const choose = (p: Point & { detail?: string }) => {
    setPoint(editing, { lat: p.lat, lng: p.lng, name: p.name });
    if (p.name)
      void rememberRecent({
        name: p.name,
        detail: p.detail,
        lat: p.lat,
        lng: p.lng,
      });
    set({ editing: null, sheet: "home" });
  };
  const locate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        choose({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          name: t(lang, "myLocation"),
        });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const saved = places.filter((p) => p.kind !== "recent");
  const recent = places.filter((p) => p.kind === "recent").slice(0, 6);

  return (
    // opens as a circle growing out of the field you tapped, closes back into it
    <motion.div
      initial={{ clipPath: `circle(0px at ${ox}px ${oy}px)` }}
      animate={{ clipPath: `circle(150% at ${ox}px ${oy}px)` }}
      exit={{ clipPath: `circle(0px at ${ox}px ${oy}px)` }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-auto absolute inset-0 z-[1000] flex flex-col bg-white dark:bg-slate-950"
    >
      <div className="flex items-center gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
        <button
          type="button"
          aria-label={t(lang, "back")}
          onClick={() => set({ editing: null, sheet: "home" })}
          className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="size-5" />
        </button>
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t(lang, "searchPlace")}
          className="h-11 flex-1 rounded-xl bg-slate-100 px-4 text-base outline-none focus:ring-2 focus:ring-sky-500 dark:bg-slate-900"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="flex gap-2 p-3">
          <button
            type="button"
            onClick={locate}
            className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
          >
            <LocateFixed className="size-4 text-sky-600" />
            {locating ? "…" : t(lang, "myLocation")}
          </button>
          <button
            type="button"
            onClick={() =>
              set({ pickOnMap: editing, editing: null, sheet: "home" })
            }
            className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
          >
            <MapPin className="size-4 text-rose-600" />
            {t(lang, "pickOnMap")}
          </button>
        </div>
        {hits.length > 0 && (
          <ul>
            {hits.map((h, i) => (
              <li key={`${h.name}${i}`}>
                <button
                  type="button"
                  onClick={() => choose(h)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-900"
                >
                  {h.kind === "stop" ? (
                    <TrainFront className="mt-0.5 size-4 shrink-0 text-sky-600" />
                  ) : (
                    <MapPin className="mt-0.5 size-4 shrink-0 text-slate-400" />
                  )}
                  <span>
                    <span className="block font-medium">{h.name}</span>
                    <span className="block text-sm text-slate-500">
                      {h.detail}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {hits.length === 0 &&
          [
            [t(lang, "saved"), saved],
            [t(lang, "recent"), recent],
          ].map(([title, list]) =>
            (list as Place[]).length ? (
              <section key={title as string}>
                <h3 className="px-4 pt-4 pb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  {title as string}
                </h3>
                <ul>
                  {(list as Place[]).map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => choose(p)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-900"
                      >
                        <span className="text-slate-500">
                          {placeIcon(p.kind)}
                        </span>
                        <span>
                          <span className="block font-medium">
                            {p.kind === "home"
                              ? t(lang, "home")
                              : p.kind === "work"
                                ? t(lang, "work")
                                : p.name}
                          </span>
                          {p.detail && (
                            <span className="block text-sm text-slate-500">
                              {p.detail}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null,
          )}
      </div>
    </motion.div>
  );
}
