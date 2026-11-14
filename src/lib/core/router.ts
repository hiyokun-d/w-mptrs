// Weather-aware multimodal router on the real Jakarta network.
//
// Time-dependent Dijkstra over stops. Every leg is priced with the DP model
// (dp.ts) on the forecast rain at the place and minute the traveller gets
// there (DP-ahead). β = 0 gives the fastest route, so both answers come from
// the same code.

import {
  DP_DEFAULTS,
  type DPParams,
  type LegKind,
  legCost,
  legDose,
  type WaitPlace,
} from "./dp";
import { motoFactor, ojekPickupMin, rideFactor, wib } from "./eta";
import { MinHeap } from "./heap";
import {
  haversine,
  type Network,
  type Pattern,
  type RouteInfo,
  walkSeconds,
} from "./network";
import { decodePolyline, type LatLng } from "./polyline";
import type { RainField } from "./rainfield";

export interface Point {
  lat: number;
  lng: number;
  name?: string;
}

export interface Leg {
  kind: LegKind;
  place?: WaitPlace;
  from: Point;
  to: Point;
  /** ms since epoch */
  t0: number;
  t1: number;
  minutes: number;
  /** forecast rain met on this leg (mm/h, mean) */
  rain: number;
  /** rain received (mm) */
  dose: number;
  cost: number;
  path: LatLng[];
  route?: Pick<
    RouteInfo,
    "short" | "long" | "color" | "mode" | "cat" | "mixed"
  > & {
    headsign: string;
  };
  /**
   * ride leg: what the client needs to place estimated vehicles. The bus you
   * board reaches the stop at t0; others run `headwaySec` apart.
   */
  trip?: {
    headwaySec: number;
    /** shape from a few stops upstream to the boarding stop */
    upPath: LatLng[];
    /** time a vehicle takes along upPath (traffic-scaled) */
    upSec: number;
    /** network indices: pattern, and the boarding / alighting stops */
    pattern: number;
    board: number;
    alight: number;
  };
  stops?: number;
  /** every time without a live feed is an estimate */
  estimated?: boolean;
  /** wait leg: "every ~N min" or "dep HH:MM" */
  service?: string;
}

export interface Itinerary {
  type: "transit" | "walk" | "moto";
  legs: Leg[];
  depart: number;
  arrive: number;
  minutes: number;
  dose: number;
  /** minutes outdoors where rain ≥ r0 */
  exposedMin: number;
  walkMin: number;
  cost: number;
  fare: number;
  transfers: number;
}

export interface PlanOptions extends Partial<DPParams> {
  /** max walk to/from a stop, metres */
  accessM?: number;
  /** include the motorcycle option; "own" skips the ojek pickup */
  moto?: "ojek" | "own" | "none";
  /** road route for the motorcycle (OSRM), if available */
  motoRoad?: { path: LatLng[]; seconds: number; meters: number };
  /**
   * App option, not part of the evaluated DP model: rupiah one perceived
   * minute is worth to the traveller. Fares are added to the cost as
   * fare / vot when choosing the recommendation. 0 = ignore price.
   */
  vot?: number;
  /** don't recommend an ojek costing more than this (Rp). 0 = no cap */
  maxOjek?: number;
}

export const TRANSFER_PENALTY_MIN = 3;

/**
 * A recording of one search, for the "how it works" replay. Every settled
 * stop with its final cost and the stop it was reached from; for the first
 * `TRACE_DETAIL` steps also every improved tentative cost, so the replay can
 * show the real priority queue. Node `dest` is the destination.
 */
export interface SearchTrace {
  dest: number;
  /** improvements made from the origin before the first step: [node, cost] */
  init: [number, number][];
  steps: {
    s: number;
    cost: number;
    prev: number;
    /** 0 access walk, 1 footpath, 2 ride, 3 egress */
    how: number;
    pattern: number;
    relax?: [number, number][];
  }[];
}
export const TRACE_DETAIL = 14;
const MAX_BOARDINGS = 4;

/**
 * First-mile ojek to a trunk stop. App option, not part of the evaluated DP
 * model: it only adds candidates, each still priced with the same costs.
 */
export const OJEK_FIRST_MILE = {
  /** a halte or station within this (straight-line) distance: just walk */
  walkM: 900,
  /** ride an ojek at most this far to reach one */
  maxM: 6000,
  /** trunk stops to try */
  tries: 5,
};

interface Label {
  cost: number;
  t: number;
  prev: number; // previous node, −1 = origin
  how: 0 | 1 | 2 | 3; // 0 access walk, 1 footpath, 2 ride, 3 egress
  pattern: number;
  board: number;
  alight: number;
  waitSec: number;
  rideSec: number;
  walkSec: number;
  boards: number;
  sheltered: boolean;
  service: string;
}

export class Router {
  /** search effort of the last transit() call, for the "how it works" view */
  stats = { settled: 0, relaxed: 0, ms: 0 };
  /** when set, the search is recorded for the replay (see SearchTrace) */
  trace: SearchTrace | null = null;

  constructor(
    readonly net: Network,
    readonly rain: RainField,
  ) {}

  /** best transit (or pure walking) itinerary for one β */
  transit(
    from: Point,
    to: Point,
    depart: number,
    opt: PlanOptions = {},
  ): Itinerary | null {
    const p: DPParams = {
      beta: opt.beta ?? DP_DEFAULTS.beta,
      r0: opt.r0 ?? DP_DEFAULTS.r0,
      k: opt.k ?? DP_DEFAULTS.k,
    };
    const net = this.net;
    const S = net.file.stops;
    const P = net.file.patterns;
    const R = net.file.routes;
    const accessM = opt.accessM ?? 1200;
    const DEST = net.n;
    const labels: (Label | undefined)[] = new Array(net.n + 1);
    const done = new Uint8Array(net.n + 1);
    const heap = new MinHeap();
    const day = wib(depart).day;
    const started = performance.now();
    this.stats = { settled: 0, relaxed: 0, ms: 0 };

    const tr = this.trace;
    if (tr) {
      tr.dest = DEST;
      tr.init = [];
      tr.steps = [];
    }
    const relax = (node: number, l: Label) => {
      const cur = labels[node];
      this.stats.relaxed++;
      if (!cur || l.cost < cur.cost - 1e-9) {
        labels[node] = l;
        heap.push(l.cost, node);
        if (tr && tr.steps.length <= TRACE_DETAIL) {
          const last = tr.steps.at(-1);
          if (last && !last.relax) last.relax = [];
          (last?.relax ?? tr.init).push([node, l.cost]);
        }
      }
    };
    const blank = {
      pattern: -1,
      board: -1,
      alight: -1,
      waitSec: 0,
      rideSec: 0,
      walkSec: 0,
      sheltered: false,
      service: "",
    };

    const walkCost = (
      aLat: number,
      aLng: number,
      bLat: number,
      bLng: number,
      t: number,
      sec: number,
      sheltered: boolean,
    ) => {
      const r = sheltered
        ? 0
        : this.rain.leg(aLat, aLng, bLat, bLng, t, t + sec * 1000);
      return legCost(sec / 60, "walk", r, p);
    };

    // origin → nearby stops, and straight to the destination if close
    for (const { stop, meters } of net
      .near(from.lat, from.lng, accessM)
      .slice(0, 40)) {
      const sec = walkSeconds(meters);
      relax(stop, {
        ...blank,
        cost: walkCost(
          from.lat,
          from.lng,
          S.lat[stop],
          S.lng[stop],
          depart,
          sec,
          false,
        ),
        t: depart + sec * 1000,
        prev: -1,
        how: 0,
        walkSec: sec,
        boards: 0,
      });
    }
    const direct = haversine(from.lat, from.lng, to.lat, to.lng);
    if (direct <= 3000) {
      const sec = walkSeconds(direct);
      relax(DEST, {
        ...blank,
        cost: walkCost(from.lat, from.lng, to.lat, to.lng, depart, sec, false),
        t: depart + sec * 1000,
        prev: -1,
        how: 3,
        walkSec: sec,
        boards: 0,
      });
    }
    const egress = new Map<number, number>();
    for (const { stop, meters } of net
      .near(to.lat, to.lng, accessM)
      .slice(0, 40))
      egress.set(stop, meters);

    // aggregated boarding options from one stop (common lines)
    type Opt = {
      arrive: number;
      cost: number;
      pattern: number;
      board: number;
      alight: number;
      wait: number;
      ride: number;
      service: string;
    };
    while (heap.size) {
      const s = heap.pop();
      if (done[s]) continue;
      done[s] = 1;
      this.stats.settled++;
      const L = labels[s] as Label;
      tr?.steps.push({
        s,
        cost: L.cost,
        prev: L.prev,
        how: L.how,
        pattern: L.pattern,
      });
      if (s === DEST) break;
      const t = L.t;

      const eg = egress.get(s);
      if (eg !== undefined) {
        const sec = walkSeconds(eg);
        relax(DEST, {
          ...blank,
          cost:
            L.cost +
            walkCost(S.lat[s], S.lng[s], to.lat, to.lng, t, sec, false),
          t: t + sec * 1000,
          prev: s,
          how: 3,
          walkSec: sec,
          boards: L.boards,
        });
      }

      // no two walks in a row: a footpath follows a ride
      if (L.how === 2) {
        for (const f of net.foot[s]) {
          if (done[f.to]) continue;
          relax(f.to, {
            ...blank,
            cost:
              L.cost +
              walkCost(
                S.lat[s],
                S.lng[s],
                S.lat[f.to],
                S.lng[f.to],
                t,
                f.sec,
                f.sheltered,
              ),
            t: t + f.sec * 1000,
            prev: s,
            how: 1,
            walkSec: f.sec,
            sheltered: f.sheltered,
            boards: L.boards,
          });
        }
      }

      if (L.boards >= MAX_BOARDINGS) continue;
      const sod = wib(t).secOfDay;
      const freq = new Map<
        number,
        {
          f: number;
          ride: number;
          pattern: number;
          board: number;
          alight: number;
          hw: number;
        }
      >();
      const timed = new Map<number, Opt>();
      const rainHere = this.rain.at(S.lat[s], S.lng[s], t);
      for (const { pattern, pos } of net.at[s]) {
        const pat = P[pattern];
        if (!(pat.days & (1 << day))) continue;
        const route = R[pat.route];
        const passFirst = sod - pat.offsets[pos]; // when this vehicle left the first stop
        let waitSec = -1;
        let headway = 0;
        let service = "";
        if (pat.headways) {
          const band = pat.headways.find(
            ([a, b]) => passFirst >= a && passFirst < b,
          );
          if (!band) continue;
          headway = band[2];
        } else if (pat.departures) {
          const d = pat.departures.find((x) => x >= passFirst);
          if (d === undefined) continue;
          waitSec = d - passFirst;
          service = clock(d + pat.offsets[pos]);
        } else continue;
        const fac = rideFactor(t, route.mixed, rainHere);
        for (let j = pos + 1; j < pat.stops.length; j++) {
          const target = pat.stops[j];
          if (done[target]) continue;
          const ride = (pat.offsets[j] - pat.offsets[pos]) * fac;
          if (headway > 0) {
            const a = freq.get(target);
            if (!a)
              freq.set(target, {
                f: 1 / headway,
                ride,
                pattern,
                board: pos,
                alight: j,
                hw: headway,
              });
            else {
              a.f += 1 / headway;
              if (ride < a.ride)
                Object.assign(a, { ride, pattern, board: pos, alight: j });
            }
          } else {
            const arrive = waitSec + ride;
            const cur = timed.get(target);
            if (!cur || arrive < cur.arrive)
              timed.set(target, {
                arrive,
                cost: 0,
                pattern,
                board: pos,
                alight: j,
                wait: waitSec,
                ride,
                service,
              });
          }
        }
      }
      const penalty = L.boards > 0 ? TRANSFER_PENALTY_MIN : 0;
      const boardCost = (wait: number, ride: number) =>
        penalty +
        legCost(wait / 60, "wait", 0, p) +
        legCost(ride / 60, "ride", 0, p);
      for (const [target, a] of freq) {
        const wait = 0.5 / a.f;
        const tm = timed.get(target);
        if (tm && tm.arrive <= wait + a.ride) continue;
        relax(target, {
          ...blank,
          cost: L.cost + boardCost(wait, a.ride),
          t: t + (wait + a.ride) * 1000,
          prev: s,
          how: 2,
          pattern: a.pattern,
          board: a.board,
          alight: a.alight,
          waitSec: wait,
          rideSec: a.ride,
          boards: L.boards + 1,
          service: `~${Math.max(1, Math.round(1 / a.f / 60))}`,
        });
      }
      for (const [target, o] of timed) {
        const fa = freq.get(target);
        if (fa && 0.5 / fa.f + fa.ride < o.arrive) continue;
        relax(target, {
          ...blank,
          cost: L.cost + boardCost(o.wait, o.ride),
          t: t + o.arrive * 1000,
          prev: s,
          how: 2,
          pattern: o.pattern,
          board: o.board,
          alight: o.alight,
          waitSec: o.wait,
          rideSec: o.ride,
          boards: L.boards + 1,
          service: o.service,
        });
      }
    }
    this.stats.ms = performance.now() - started;
    if (!labels[DEST]) return null;
    return this.build(labels as Label[], DEST, from, to, depart, p);
  }

  private build(
    labels: Label[],
    dest: number,
    from: Point,
    to: Point,
    depart: number,
    p: DPParams,
  ): Itinerary {
    const net = this.net;
    const S = net.file.stops;
    const chain: { node: number; l: Label }[] = [];
    for (let n = dest; n !== -1; n = labels[n].prev)
      chain.unshift({ node: n, l: labels[n] });
    const pt = (stop: number): Point => ({
      lat: S.lat[stop],
      lng: S.lng[stop],
      name: S.name[stop],
    });
    const legs: Leg[] = [];
    let t = depart;
    let here: Point = from;
    for (const { node, l } of chain) {
      const target = node === dest ? to : pt(node);
      if (l.how === 2) {
        const pat = net.file.patterns[l.pattern];
        const route = net.file.routes[pat.route];
        const boardStop = pat.stops[l.board];
        const kind = S.kind[boardStop];
        const place: WaitPlace =
          kind === 0 ? "halte" : kind === 1 ? "roadside" : "station";
        legs.push(
          this.leg(
            "wait",
            here,
            here,
            t,
            l.waitSec,
            p,
            [[here.lat, here.lng]],
            {
              place,
              estimated: !pat.departures,
              service: pat.departures
                ? `dep ${l.service}`
                : `every ${l.service} min`,
            },
          ),
        );
        t += l.waitSec * 1000;
        const full = decodePolyline(pat.shape);
        const shape = full.slice(pat.cut[l.board], pat.cut[l.alight] + 1);
        const sched = Math.max(1, pat.offsets[l.alight] - pat.offsets[l.board]);
        const scale = Math.max(0.5, l.rideSec / sched);
        const up = Math.max(0, l.board - 6);
        const upPath = full.slice(pat.cut[up], pat.cut[l.board] + 1);
        const upSec = (pat.offsets[l.board] - pat.offsets[up]) * scale;
        legs.push(
          this.leg(
            "ride",
            here,
            target,
            t,
            l.rideSec,
            p,
            shape.length >= 2
              ? shape
              : [
                  [here.lat, here.lng],
                  [target.lat, target.lng],
                ],
            {
              route: {
                short: route.short,
                long: route.long,
                color: route.color,
                mode: route.mode,
                cat: route.cat,
                mixed: route.mixed,
                headsign: pat.headsign,
              },
              stops: l.alight - l.board,
              estimated: true,
              trip: {
                headwaySec: headwayAt(pat, t - pat.offsets[l.board] * 1000),
                upPath: upPath.length >= 2 ? upPath : [[here.lat, here.lng]],
                upSec,
                pattern: l.pattern,
                board: pat.stops[l.board],
                alight: pat.stops[l.alight],
              },
            },
          ),
        );
        t += l.rideSec * 1000;
      } else {
        legs.push(
          this.leg(
            "walk",
            here,
            target,
            t,
            l.walkSec,
            p,
            [
              [here.lat, here.lng],
              [target.lat, target.lng],
            ],
            {
              place: l.sheltered ? "station" : "none",
            },
          ),
        );
        t += l.walkSec * 1000;
      }
      here = target;
    }
    return summarise(
      legs.filter((g) => g.minutes > 0.05 || g.kind === "ride"),
      net,
      "transit",
      p,
    );
  }

  private leg(
    kind: LegKind,
    from: Point,
    to: Point,
    t0: number,
    sec: number,
    p: DPParams,
    path: LatLng[],
    extra: Partial<Leg> = {},
  ): Leg {
    const t1 = t0 + sec * 1000;
    const sheltered = kind === "walk" && extra.place === "station";
    const rain = sheltered ? 0 : this.pathRain(path, t0, t1);
    const minutes = sec / 60;
    return {
      kind,
      from,
      to,
      t0,
      t1,
      minutes,
      rain,
      dose: legDose(
        minutes,
        kind,
        kind === "walk" ? "none" : (extra.place ?? "none"),
        rain,
      ),
      cost: legCost(minutes, kind, rain, p),
      path,
      ...extra,
    };
  }

  pathRain(path: LatLng[], t0: number, t1: number): number {
    return pathRain(this.rain, path, t0, t1);
  }

  /** door-to-door motorcycle (own or ojek), split into ~1 km legs for rain */
  moto(
    from: Point,
    to: Point,
    depart: number,
    opt: PlanOptions = {},
  ): Itinerary {
    const p: DPParams = {
      beta: opt.beta ?? DP_DEFAULTS.beta,
      r0: opt.r0 ?? DP_DEFAULTS.r0,
      k: opt.k ?? DP_DEFAULTS.k,
    };
    const road = opt.motoRoad ?? {
      path: [
        [from.lat, from.lng],
        [to.lat, to.lng],
      ] as LatLng[],
      meters: haversine(from.lat, from.lng, to.lat, to.lng) * 1.4,
      seconds:
        (haversine(from.lat, from.lng, to.lat, to.lng) * 1.4) / (30 / 3.6),
    };
    const legs: Leg[] = [];
    let t = depart;
    if (opt.moto !== "own") {
      const r = this.rain.at(from.lat, from.lng, t);
      legs.push(
        this.leg(
          "wait",
          from,
          from,
          t,
          ojekPickupMin(r) * 60,
          p,
          [[from.lat, from.lng]],
          { place: "none", estimated: true, service: "ojek pickup" },
        ),
      );
      t = legs[0].t1;
    }
    const chunks = splitPath(road.path, 1000);
    const perM = road.seconds / (road.meters || 1);
    for (const c of chunks) {
      const r = this.rain.leg(
        c[0][0],
        c[0][1],
        c[c.length - 1][0],
        c[c.length - 1][1],
        t,
        t + 60_000,
      );
      const sec = c.meters * perM * motoFactor(t, r);
      const a = { lat: c[0][0], lng: c[0][1] };
      const b = { lat: c[c.length - 1][0], lng: c[c.length - 1][1] };
      legs.push(this.leg("moto", a, b, t, sec, p, c, { estimated: true }));
      t += sec * 1000;
    }
    // you order an ojek from indoors, so the pickup wait is not exposed
    // merge the chunks back into one riding leg for display, keeping the rain detail
    const ride = legs.filter((g) => g.kind === "moto");
    const merged: Leg = {
      ...ride[0],
      from,
      to,
      t1: ride[ride.length - 1].t1,
      minutes: ride.reduce((a, g) => a + g.minutes, 0),
      rain:
        ride.reduce((a, g) => a + g.rain * g.minutes, 0) /
        Math.max(
          1e-9,
          ride.reduce((a, g) => a + g.minutes, 0),
        ),
      dose: ride.reduce((a, g) => a + g.dose, 0),
      cost: ride.reduce((a, g) => a + g.cost, 0),
      path: road.path,
    };
    const it = summarise(
      [...legs.filter((g) => g.kind !== "moto"), merged],
      this.net,
      "moto",
      p,
    );
    it.exposedMin = ride
      .filter((g) => g.rain >= p.r0)
      .reduce((a, g) => a + g.minutes, 0);
    it.fare =
      opt.moto === "own"
        ? 0
        : Math.round((10_000 + 2_500 * (road.meters / 1000)) / 1000) * 1000;
    return it;
  }

  /**
   * First-mile ojek: when no halte or station is within walking distance,
   * ride an ojek (or your own motorcycle) to a BRT halte or rail station a
   * few km away, then continue by transit. Returns the cheapest such trip
   * under β, or null when a trunk stop is close enough to walk to.
   */
  ojekTransit(
    from: Point,
    to: Point,
    depart: number,
    opt: PlanOptions = {},
  ): Itinerary | null {
    if (opt.moto === "none") return null;
    const p: DPParams = {
      beta: opt.beta ?? DP_DEFAULTS.beta,
      r0: opt.r0 ?? DP_DEFAULTS.r0,
      k: opt.k ?? DP_DEFAULTS.k,
    };
    const S = this.net.file.stops;
    // BRT halte and rail stations: roofed, frequent, worth riding to
    const trunk = (i: number) => S.kind[i] !== 1;
    const close = this.net
      .near(from.lat, from.lng, OJEK_FIRST_MILE.walkM)
      .some((x) => trunk(x.stop));
    if (close) return null;
    // the nearest few trunk stops, one per halte complex
    const seen = new Set<number>();
    const cands = this.net
      .near(from.lat, from.lng, OJEK_FIRST_MILE.maxM)
      .filter((x) => trunk(x.stop))
      .sort((a, b) => a.meters - b.meters)
      .filter((x) => {
        const key = S.parent[x.stop] >= 0 ? S.parent[x.stop] : x.stop;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, OJEK_FIRST_MILE.tries);
    const stats = { ...this.stats };
    let best: { it: Itinerary; cost: number } | null = null;
    for (const c of cands) {
      const stop: Point = {
        lat: S.lat[c.stop],
        lng: S.lng[c.stop],
        name: S.name[c.stop],
      };
      const first = this.moto(from, stop, depart, {
        ...opt,
        motoRoad: undefined,
      });
      // board at that stop: only a short walk around it
      const rest = this.transit(stop, to, first.arrive, {
        ...opt,
        accessM: 250,
      });
      stats.settled += this.stats.settled;
      stats.relaxed += this.stats.relaxed;
      stats.ms += this.stats.ms;
      if (!rest || !rest.legs.some((g) => g.kind === "ride")) continue;
      // standing on the stop: drop the zero-length access walk
      const legs = [
        ...first.legs,
        ...rest.legs.filter(
          (g, k) => !(k === 0 && g.kind === "walk" && g.minutes < 0.2),
        ),
      ];
      const it = summarise(legs, this.net, "transit", p);
      it.fare += first.fare;
      it.exposedMin += first.exposedMin;
      // the ojek counts as a boarding: one more transfer than the transit part
      it.transfers += 1;
      it.cost += TRANSFER_PENALTY_MIN;
      const cost = costOf(it, p);
      if (!best || cost < best.cost) best = { it, cost };
    }
    this.stats = stats;
    return best?.it ?? null;
  }
}

/** mean forecast rain along a path, sampled at the time each point is passed */
export function pathRain(
  rain: RainField,
  path: LatLng[],
  t0: number,
  t1: number,
): number {
  if (path.length === 1) return rain.at(path[0][0], path[0][1], (t0 + t1) / 2);
  const cum = [0];
  for (let i = 1; i < path.length; i++)
    cum.push(
      cum[i - 1] +
        haversine(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]),
    );
  const total = cum[cum.length - 1] || 1;
  const n = Math.min(12, Math.max(2, Math.ceil(total / 400)));
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const d = ((k + 0.5) / n) * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const f = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    const lat = path[i - 1][0] + (path[i][0] - path[i - 1][0]) * f;
    const lng = path[i - 1][1] + (path[i][1] - path[i - 1][1]) * f;
    sum += rain.at(lat, lng, t0 + (t1 - t0) * ((k + 0.5) / n));
  }
  return sum / n;
}

/** Re-score a planned trip on a newer forecast (same legs and times). */
export function rescore(
  it: Itinerary,
  rain: RainField,
  p: DPParams = DP_DEFAULTS,
): Itinerary {
  const legs = it.legs.map((g) => {
    const sheltered = g.kind === "walk" && g.place === "station";
    const r = sheltered ? 0 : pathRain(rain, g.path, g.t0, g.t1);
    return {
      ...g,
      rain: r,
      dose: legDose(
        g.minutes,
        g.kind,
        g.kind === "walk" ? "none" : (g.place ?? "none"),
        r,
      ),
      cost: legCost(g.minutes, g.kind, r, p),
    };
  });
  return {
    ...it,
    legs,
    dose: legs.reduce((a, g) => a + g.dose, 0),
    exposedMin: legs
      .filter(
        (g) =>
          (g.kind === "walk" && g.place !== "station") || g.kind === "moto",
      )
      .filter((g) => g.rain >= p.r0)
      .reduce((a, g) => a + g.minutes, 0),
  };
}

function splitPath(
  path: LatLng[],
  step: number,
): (LatLng[] & { meters: number })[] {
  const out: (LatLng[] & { meters: number })[] = [];
  let cur = [path[0]] as LatLng[] & { meters: number };
  cur.meters = 0;
  for (let i = 1; i < path.length; i++) {
    const d = haversine(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
    cur.push(path[i]);
    cur.meters += d;
    if (cur.meters >= step && i < path.length - 1) {
      out.push(cur);
      cur = [path[i]] as LatLng[] & { meters: number };
      cur.meters = 0;
    }
  }
  if (cur.length >= 2) out.push(cur);
  return out.length
    ? out
    : [
        Object.assign([path[0], path[path.length - 1]] as LatLng[], {
          meters: 0,
        }),
      ];
}

function clock(sec: number): string {
  const s = ((sec % 86400) + 86400) % 86400;
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}

/** Fare estimate in IDR. TJ: one fare per 3 h journey; rail: distance based. */
function fareOf(legs: Leg[]): number {
  let fare = 0;
  let tjPaid = 0;
  for (const g of legs) {
    if (g.kind !== "ride" || !g.route) continue;
    const km =
      g.path.reduce(
        (a, q, i) =>
          i ? a + haversine(g.path[i - 1][0], g.path[i - 1][1], q[0], q[1]) : 0,
        0,
      ) / 1000;
    switch (g.route.mode) {
      case "transjakarta": {
        const f =
          g.route.cat === "Royaltrans"
            ? 20_000
            : g.route.cat === "Mikrotrans"
              ? 0
              : 3_500;
        if (f > tjPaid) {
          fare += f - tjPaid;
          tjPaid = f;
        }
        break;
      }
      case "krl":
        fare +=
          g.route.cat === "Airport rail"
            ? 70_000
            : 3_000 + 1_000 * Math.max(0, Math.ceil((km - 25) / 10));
        break;
      case "mrt":
        fare += Math.min(14_000, 3_000 + 1_000 * Math.round(km));
        break;
      case "lrt":
        fare +=
          g.route.short === "LRT Jakarta"
            ? 5_000
            : Math.min(20_000, 5_000 + Math.round(700 * km));
        break;
    }
  }
  return Math.round(fare / 500) * 500;
}

/** Generalised cost of an itinerary under other DP parameters. */
/** Seconds between vehicles of a pattern around time t (ms), for display. */
export function headwayAt(pat: Pattern, t: number): number {
  const sec = wib(t).secOfDay;
  if (pat.headways?.length) {
    const band =
      pat.headways.find(([a, b]) => sec >= a && sec < b) ??
      pat.headways[pat.headways.length - 1];
    return band[2];
  }
  if (pat.departures?.length) {
    const d = pat.departures;
    const i = d.findIndex((x) => x >= sec - 30);
    if (i >= 0 && i + 1 < d.length) return Math.max(120, d[i + 1] - d[i]);
    if (i > 0) return Math.max(120, d[i] - d[i - 1]);
  }
  return 600;
}

export function costOf(it: Itinerary, p: DPParams): number {
  return (
    it.legs.reduce((a, g) => a + legCost(g.minutes, g.kind, g.rain, p), 0) +
    TRANSFER_PENALTY_MIN * it.transfers
  );
}

function summarise(
  legs: Leg[],
  _net: Network,
  type: Itinerary["type"],
  p: DPParams,
): Itinerary {
  const depart = legs[0]?.t0 ?? 0;
  const arrive = legs[legs.length - 1]?.t1 ?? depart;
  const rides = legs.filter((g) => g.kind === "ride").length;
  return {
    type: type === "transit" && rides === 0 ? "walk" : type,
    legs,
    depart,
    arrive,
    minutes: (arrive - depart) / 60_000,
    dose: legs.reduce((a, g) => a + g.dose, 0),
    exposedMin: legs
      .filter(
        (g) => g.kind === "walk" && g.place !== "station" && g.rain >= p.r0,
      )
      .reduce((a, g) => a + g.minutes, 0),
    walkMin: legs
      .filter((g) => g.kind === "walk")
      .reduce((a, g) => a + g.minutes, 0),
    cost:
      legs.reduce((a, g) => a + g.cost, 0) +
      TRANSFER_PENALTY_MIN * Math.max(0, rides - 1),
    fare: fareOf(legs),
    transfers: Math.max(0, rides - 1),
  };
}
