// One trip request → the fastest option (β = 0) and the weather-aware option
// (the user's β), each the best of transit / walking and motorcycle.

import { type Alert, planAlerts } from "./alerts";
import { DP_DEFAULTS, type DPParams } from "./dp";
import type { Network } from "./network";
import type { RainField } from "./rainfield";
import {
  costOf,
  type Itinerary,
  type PlanOptions,
  type Point,
  Router,
} from "./router";

export interface PlanResult {
  depart: number;
  params: DPParams;
  fastest: Itinerary | null;
  weatherAware: Itinerary | null;
  /** best transit itineraries at β = 0 and at β, and the motorcycle */
  options: {
    transit0: Itinerary | null;
    transitB: Itinerary | null;
    moto: Itinerary | null;
    /** ojek to a far halte, then transit (null when a halte is walkable) */
    ojekTransit: Itinerary | null;
  };
  /** true when the weather-aware choice differs from the fastest */
  shift: boolean;
  alerts: Alert[];
  explain: Explain | null;
  /** price settings used for the recommendation */
  price: { vot: number; maxOjek: number; motoOverBudget: boolean };
  /** search effort, for the "how it works" view */
  stats: {
    settled: number;
    relaxed: number;
    ms: number;
    stops: number;
    patterns: number;
  };
}

export interface Explain {
  extraMin: number;
  /** rupiah saved by the recommendation vs the fastest (negative = dearer) */
  fareSaved: number;
  doseSaved: number;
  /** % less rain than the fastest option */
  doseSavedPct: number;
  exposedSavedMin: number;
}

export function plan(
  net: Network,
  rain: RainField,
  from: Point,
  to: Point,
  depart: number,
  opt: PlanOptions = {},
): PlanResult {
  const params: DPParams = {
    beta: opt.beta ?? DP_DEFAULTS.beta,
    r0: opt.r0 ?? DP_DEFAULTS.r0,
    k: opt.k ?? DP_DEFAULTS.k,
  };
  const router = new Router(net, rain);
  const transit0 = router.transit(from, to, depart, { ...opt, beta: 0 });
  const s0 = router.stats;
  const transitB =
    params.beta === 0 ? transit0 : router.transit(from, to, depart, opt);
  const sB = router.stats;
  const stats = {
    settled: s0.settled + (params.beta === 0 ? 0 : sB.settled),
    relaxed: s0.relaxed + (params.beta === 0 ? 0 : sB.relaxed),
    ms: s0.ms + (params.beta === 0 ? 0 : sB.ms),
    stops: net.n,
    patterns: net.file.patterns.length,
  };
  const moto = opt.moto === "none" ? null : router.moto(from, to, depart, opt);
  const ojek0 = router.ojekTransit(from, to, depart, { ...opt, beta: 0 });
  const ojekB =
    params.beta === 0 ? ojek0 : router.ojekTransit(from, to, depart, opt);

  const p0 = { ...params, beta: 0 };
  const pick = (cands: (Itinerary | null)[], p: DPParams) =>
    cands
      .filter((c): c is Itinerary => !!c)
      .sort((a, b) => costOf(a, p) - costOf(b, p))[0] ?? null;
  const fastest = pick([transit0, ojek0, moto], p0);
  // the recommendation also weighs price (app option, off when vot = 0)
  const vot = opt.vot ?? 0;
  const maxOjek = opt.maxOjek ?? 0;
  const motoOverBudget =
    !!moto && moto.fare > 0 && maxOjek > 0 && moto.fare > maxOjek;
  const money = (it: Itinerary) => (vot > 0 ? it.fare / vot : 0);
  const weatherAware =
    [transitB, transit0, ojekB, ojek0, motoOverBudget ? null : moto]
      .filter((c): c is Itinerary => !!c)
      .sort(
        (a, b) => costOf(a, params) + money(a) - (costOf(b, params) + money(b)),
      )[0] ?? null;

  const same = !!fastest && !!weatherAware && sameTrip(fastest, weatherAware);
  const explain =
    fastest && weatherAware
      ? {
          extraMin: weatherAware.minutes - fastest.minutes,
          fareSaved: fastest.fare - weatherAware.fare,
          doseSaved: fastest.dose - weatherAware.dose,
          doseSavedPct:
            fastest.dose > 0.005
              ? (100 * (fastest.dose - weatherAware.dose)) / fastest.dose
              : 0,
          exposedSavedMin: fastest.exposedMin - weatherAware.exposedMin,
        }
      : null;
  return {
    depart,
    params,
    fastest,
    weatherAware,
    options: { transit0, transitB, moto, ojekTransit: ojekB ?? ojek0 },
    shift: !same,
    alerts: weatherAware ? planAlerts(weatherAware) : [],
    explain,
    price: { vot, maxOjek, motoOverBudget },
    stats,
  };
}

function sameTrip(a: Itinerary, b: Itinerary): boolean {
  if (a.type !== b.type || a.legs.length !== b.legs.length) return false;
  return a.legs.every(
    (g, i) =>
      g.kind === b.legs[i].kind &&
      g.route?.short === b.legs[i].route?.short &&
      g.to.name === b.legs[i].to.name,
  );
}
