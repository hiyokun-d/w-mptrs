// Raincoat alerts: a port of PlanAlerts / advice from
// wmptrs-sim/internal/sim/ahead.go. One alert per spell of rain ≥ 1 mm/h
// met on the route, issued up to 15 min ahead. It names the last sheltered
// point to put on a raincoat, and stays informational while you are inside.

import { exposure, rainCategory } from "./dp";
import type { Itinerary, Leg, Point } from "./router";

export const ALERT_THRESHOLD = 1;
export const ALERT_HORIZON_MIN = 15;

export interface Alert {
  issueAt: number;
  meetAt: number;
  prepAt: number;
  prep: Point;
  until: number;
  peak: number;
  kind: Leg["kind"];
  place?: Leg["place"];
  covered: boolean;
  /** exposed parts of the spell [t0, t1] — what "minutes in the rain" counts */
  exposed: [number, number][];
}

function legExposure(g: Leg): number {
  if (g.kind === "walk" && g.place === "station") return 0;
  return exposure(g.kind, g.place ?? "none");
}

export function planAlerts(
  it: Itinerary,
  horizonMin = ALERT_HORIZON_MIN,
): Alert[] {
  const out: Alert[] = [];
  const tl = it.legs;
  for (let i = 0; i < tl.length; i++) {
    if (tl[i].rain < ALERT_THRESHOLD || tl[i].t1 <= tl[i].t0) continue;
    let j = i;
    const a: Alert = {
      issueAt: 0,
      meetAt: tl[i].t0,
      prepAt: 0,
      prep: tl[i].from,
      until: tl[i].t1,
      peak: 0,
      kind: tl[i].kind,
      place: tl[i].place,
      covered: true,
      exposed: [],
    };
    for (
      ;
      j < tl.length && (tl[j].rain >= ALERT_THRESHOLD || tl[j].t1 === tl[j].t0);
      j++
    ) {
      if (legExposure(tl[j]) > 0 && tl[j].t1 > tl[j].t0) {
        if (a.covered) {
          a.kind = tl[j].kind;
          a.place = tl[j].place;
          a.meetAt = tl[j].t0;
        }
        a.covered = false;
        a.peak = Math.max(a.peak, tl[j].rain);
        a.exposed.push([tl[j].t0, tl[j].t1]);
      }
      a.until = tl[j].t1;
    }
    if (a.covered)
      for (let k = i; k < j; k++) a.peak = Math.max(a.peak, tl[k].rain);
    i = j - 1;
    a.issueAt = Math.max(it.depart, a.meetAt - horizonMin * 60_000);
    // where to prepare: the last sheltered point before the rain
    a.prepAt = Math.max(it.depart, a.meetAt - 60_000);
    let prep = -1;
    for (let k = 0; k < tl.length && tl[k].t0 <= a.meetAt; k++) {
      if (legExposure(tl[k]) === 0 && tl[k].t1 <= a.meetAt) prep = k;
    }
    if (prep >= 0 && a.kind === "walk" && a.meetAt - tl[prep].t1 < 3 * 60_000) {
      a.prepAt = tl[prep].t1;
      a.prep = tl[prep].to;
    } else {
      a.prep = positionAt(it, a.prepAt);
    }
    out.push(a);
  }
  return out;
}

/** traveller's position at time t, interpolated along the leg paths */
export function positionAt(it: Itinerary, t: number): Point {
  for (const g of it.legs) {
    if (t <= g.t1 && g.t1 > g.t0) {
      const f = Math.min(1, Math.max(0, (t - g.t0) / (g.t1 - g.t0)));
      const path = g.path;
      if (path.length < 2)
        return {
          lat: g.from.lat + f * (g.to.lat - g.from.lat),
          lng: g.from.lng + f * (g.to.lng - g.from.lng),
        };
      const k = f * (path.length - 1);
      const i = Math.min(path.length - 2, Math.floor(k));
      const w = k - i;
      return {
        lat: path[i][0] + (path[i + 1][0] - path[i][0]) * w,
        lng: path[i][1] + (path[i + 1][1] - path[i][1]) * w,
      };
    }
  }
  const last = it.legs[it.legs.length - 1];
  return last ? last.to : { lat: 0, lng: 0 };
}

export type Lang = "en" | "id";

const WORD: Record<Lang, Record<string, string>> = {
  en: {
    none: "drizzle",
    light: "light rain",
    moderate: "moderate rain",
    heavy: "heavy rain",
    very_heavy: "very heavy rain",
  },
  id: {
    none: "gerimis",
    light: "hujan ringan",
    moderate: "hujan sedang",
    heavy: "hujan lebat",
    very_heavy: "hujan sangat lebat",
  },
};

/** Headline and advice relative to the current time (counts down as you go). */
export function alertText(
  a: Alert,
  now: number,
  lang: Lang = "id",
): { headline: string; advice: string } {
  const L = (en: string, id: string) => (lang === "id" ? id : en);
  const word = WORD[lang][rainCategory(a.peak)];
  const inMin = Math.round((a.meetAt - now) / 60_000);
  const mmh = a.peak.toFixed(0);
  if (a.covered) {
    return {
      headline:
        inMin >= 1
          ? L(
              `${cap(word)} on your route in ${inMin} min — you'll be under cover`,
              `${cap(word)} di rute Anda dalam ${inMin} menit — Anda terlindung`,
            )
          : L(
              `${cap(word)} outside — you're under cover`,
              `${cap(word)} di luar — Anda terlindung`,
            ),
      advice: L(
        "You will be inside when it rains. No action needed.",
        "Anda berada di dalam saat hujan. Tidak perlu tindakan.",
      ),
    };
  }
  const headline =
    inMin >= 1
      ? L(
          `${cap(word)} ahead in ${inMin} min (${mmh} mm/h)`,
          `${cap(word)} di depan dalam ${inMin} menit (${mmh} mm/jam)`,
        )
      : L(
          `You are in ${word} (${mmh} mm/h)`,
          `Anda berada dalam ${word} (${mmh} mm/jam)`,
        );
  const prepMin = Math.round((a.prepAt - now) / 60_000);
  const left = Math.max(
    1,
    Math.round(
      a.exposed.reduce(
        (m, [t0, t1]) => m + Math.max(0, t1 - Math.max(t0, now)),
        0,
      ) / 60_000,
    ),
  );
  // inside the alert window but sheltered right now (e.g. on the bus)
  const outside = a.exposed.some(([t0, t1]) => now >= t0 && now < t1);
  const nextOut = a.exposed.find(([t0]) => t0 > now);
  if (now >= a.meetAt && !outside && nextOut) {
    const inNext = Math.max(1, Math.round((nextOut[0] - now) / 60_000));
    return {
      headline: L(
        `${cap(word)} outside — you're under cover now`,
        `${cap(word)} di luar — Anda sedang terlindung`,
      ),
      advice: L(
        `Back outside in ${inNext} min, about ${left} min in the rain. Keep your raincoat ready.`,
        `Keluar lagi dalam ${inNext} menit, sekitar ${left} menit kena hujan. Siapkan jas hujan.`,
      ),
    };
  }
  const where = a.prep.name
    ? L(` at ${a.prep.name}`, ` di ${a.prep.name}`)
    : "";
  let advice: string;
  if (now >= a.meetAt)
    advice = L(
      `Raincoat on. About ${left} min more outside in the rain.`,
      `Jas hujan dipakai. Sekitar ${left} menit lagi di luar saat hujan.`,
    );
  else if (prepMin < 1)
    advice =
      a.kind === "moto"
        ? L(
            "Pull over now and put on your raincoat before continuing.",
            "Menepilah sekarang dan pakai jas hujan sebelum melanjutkan.",
          )
        : L(
            `Put on your raincoat or open your umbrella now${where}.`,
            `Pakai jas hujan atau buka payung sekarang${where}.`,
          );
  else if (a.kind === "moto")
    advice = L(
      `Pull over in about ${prepMin} min and put on your raincoat before continuing.`,
      `Menepilah dalam sekitar ${prepMin} menit dan pakai jas hujan sebelum melanjutkan.`,
    );
  else if (a.kind === "wait" && a.place === "halte")
    advice = L(
      `Your halte is only partly covered. Raincoat on before the stop, in ${prepMin} min.`,
      `Halte Anda hanya sebagian beratap. Pakai jas hujan sebelum sampai halte, dalam ${prepMin} menit.`,
    );
  else
    advice = L(
      `Get your raincoat or umbrella ready${where}, in ${prepMin} min. About ${left} min outside in the rain.`,
      `Siapkan jas hujan atau payung${where}, dalam ${prepMin} menit. Sekitar ${left} menit di luar saat hujan.`,
    );
  return { headline, advice };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
