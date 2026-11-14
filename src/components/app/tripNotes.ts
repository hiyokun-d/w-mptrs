"use client";

import { useEffect } from "react";
import { type Alert, alertText } from "@/lib/core/alerts";
import { arrivalRange, exposedChances } from "@/lib/core/predict";
import type { RainField } from "@/lib/core/rainfield";
import type { Itinerary } from "@/lib/core/router";
import { nextArrivalSec } from "@/lib/core/vehicles";
import type { Lang } from "@/lib/i18n";
import { type Note, useNotes } from "@/lib/store/notify";
import { clock, legTitle, mm } from "./format";

/**
 * Turns the trip clock into in-app notes: what to do next, when the bus is
 * close, when to get off, raincoat alerts and the arrival prediction. Each
 * note has a key, so it is announced once.
 */
export function useTripNotes(
  it: Itinerary | null,
  alerts: Alert[],
  now: number,
  active: boolean,
  lang: Lang,
) {
  const push = useNotes((s) => s.push);
  useEffect(() => {
    if (!it || !active) return;
    const id = (en: string, idn: string) => (lang === "id" ? idn : en);
    const legs = it.legs;

    // arrival prediction, re-announced only when it moves by 2+ minutes
    const r = arrivalRange(it);
    push({
      key: `eta-${Math.round(r.p50 / 120_000)}`,
      kind: "predict",
      at: now,
      title: id(`Arrive ~${clock(r.p50)}`, `Tiba ~${clock(r.p50)}`),
      body: id(
        `Between ${clock(r.p10)} and ${clock(r.p90)} (estimate)`,
        `Antara ${clock(r.p10)} dan ${clock(r.p90)} (perkiraan)`,
      ),
    });

    legs.forEach((g, i) => {
      // two minutes before each leg: what to do
      if (i > 0 && now >= g.t0 - 120_000 && now < g.t1 && g.kind !== "ride") {
        push({
          key: `leg-${g.t0}-${g.kind}`,
          kind: "action",
          at: g.t0,
          title: legTitle(g, lang),
          body: id(`At ${clock(g.t0)}`, `Pukul ${clock(g.t0)}`),
        });
      }
      if (g.kind === "ride") {
        // the bus is close: count down in whole minutes (3, 2, 1, now)
        const wait = legs[i - 1];
        const waiting =
          now >= (wait?.t0 ?? g.t0) - 60_000 && now < g.t0 + 30_000;
        const eta = nextArrivalSec(g, now);
        if (waiting && eta !== null && eta <= 180) {
          const m = Math.max(0, Math.ceil(eta / 60));
          push({
            key: `veh-${g.t0}-${m}`,
            kind: "vehicle",
            level: m === 0 ? "major" : "minor",
            at: now,
            title:
              m === 0
                ? id(
                    `${g.route?.short} is here — board now`,
                    `${g.route?.short} tiba — naik sekarang`,
                  )
                : id(
                    `${g.route?.short} arrives in ~${m} min`,
                    `${g.route?.short} tiba ~${m} menit lagi`,
                  ),
            body: id(
              `At ${g.from.name ?? "your stop"} · towards ${g.route?.headsign} · estimated position`,
              `Di ${g.from.name ?? "halte Anda"} · arah ${g.route?.headsign} · posisi perkiraan`,
            ),
          });
        }
        // get off soon
        if (now >= g.t1 - 120_000 && now < g.t1) {
          push({
            key: `off-${g.t1}`,
            kind: "action",
            level: "major",
            at: now,
            title: id(
              `Get off at ${g.to.name ?? "the next stop"}`,
              `Turun di ${g.to.name ?? "halte berikutnya"}`,
            ),
            body: id(
              `In about ${Math.max(1, Math.round((g.t1 - now) / 60_000))} min`,
              `Sekitar ${Math.max(1, Math.round((g.t1 - now) / 60_000))} menit lagi`,
            ),
          });
        }
      }
    });

    for (const a of alerts) {
      if (now >= a.issueAt && now <= a.until) {
        const tx = alertText(a, now, lang);
        // the trip banner already shows it; keep a copy in the inbox
        // very heavy rain (BMKG > 20 mm/h) where you'll be out in it is an
        // emergency; anything lighter the trip banner already covers
        const danger = a.peak >= 20 && !a.covered;
        push(
          {
            key: `alert-${a.issueAt}`,
            kind: "rain",
            level: danger ? "emergency" : "minor",
            at: now,
            title: tx.headline,
            body: tx.advice,
          },
          { toast: danger },
        );
      }
    }

    if (now >= it.arrive) {
      push({
        key: `arrive-${it.arrive}`,
        kind: "arrive",
        at: it.arrive,
        title: id("You have arrived", "Anda sudah sampai"),
        body: id(
          `${mm(it.dose)} of rain on the way`,
          `${mm(it.dose)} hujan selama perjalanan`,
        ),
      });
    }
  }, [it, alerts, now, active, lang, push]);
}

/** The prediction note announced after every plan: when you'll likely arrive
 * and the chance of rain on the legs where rain reaches you. */
export function predictionNote(
  it: Itinerary,
  field: RainField,
  lang: Lang,
): Omit<Note, "posted" | "read"> {
  const id = (en: string, idn: string) => (lang === "id" ? idn : en);
  const r = arrivalRange(it);
  const wet = exposedChances(it, field).sort(
    (a, b) => b.c.chance - a.c.chance,
  )[0];
  const rain = wet
    ? id(
        ` · ${Math.round(wet.c.chance * 100)}% chance of rain while you ${wet.leg.kind === "moto" ? "ride" : wet.leg.kind === "walk" ? "walk" : "wait"} (${wet.c.wet}/${wet.c.samples} forecast samples)`,
        ` · ${Math.round(wet.c.chance * 100)}% peluang hujan saat ${wet.leg.kind === "moto" ? "naik ojek" : wet.leg.kind === "walk" ? "berjalan" : "menunggu"} (${wet.c.wet}/${wet.c.samples} sampel prakiraan)`,
      )
    : "";
  return {
    key: `plan-${it.depart}-${it.arrive}-${Math.round(it.dose * 100)}`,
    kind: "predict",
    at: Date.now(),
    title: `${id("Arrive", "Tiba")} ${clock(r.p10)}–${clock(r.p90)}${wet && wet.c.chance > 0 ? ` · ☂ ${Math.round(wet.c.chance * 100)}%` : ""}`,
    body: id(
      `Most likely ${clock(r.p50)} (±${r.sigmaMin.toFixed(1)} min)${rain}`,
      `Paling mungkin ${clock(r.p50)} (±${r.sigmaMin.toFixed(1)} mnt)${rain}`,
    ),
  };
}
