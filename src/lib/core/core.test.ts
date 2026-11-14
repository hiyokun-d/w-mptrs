// Run with `bun test`. Checks the DP model against the Go reference
// (wmptrs-sim/internal/model), the rain field, the ETA bounds, the alerts and
// the router on the real network file.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { alertText, planAlerts } from "./alerts";
import { DP_DEFAULTS, legCost, legDose, phi } from "./dp";
import { motoFactor, rideFactor, trafficFactor } from "./eta";
import { Network, type NetworkFile } from "./network";
import { plan } from "./plan";
import { RainField, type RainGrid } from "./rainfield";
import type { Itinerary, Leg } from "./router";

const p = { ...DP_DEFAULTS };

describe("phi (Go parity)", () => {
  // printed from model.Phi with model.Default()
  const ref: [number, number][] = [
    [0, 0],
    [1, 0.025760509019],
    [3, 0.165288312532],
    [5, 0.487638236765],
    [7.5, 0.860767845825],
    [15, 0.999374017549],
    [30, 0.999999990534],
  ];
  for (const [r, want] of ref)
    test(`phi(${r})`, () => expect(phi(r)).toBeCloseTo(want, 10));

  test("monotone", () => {
    for (let r = 0; r < 40; r += 0.5)
      expect(phi(r + 0.5)).toBeGreaterThanOrEqual(phi(r));
  });
});

describe("leg cost", () => {
  test("dry cost is time × weight", () => {
    expect(legCost(10, "walk", 0, p)).toBeCloseTo(15);
    expect(legCost(10, "ride", 0, p)).toBeCloseTo(10);
  });
  test("A3 walk in rain (Go TestA3DP)", () => {
    expect(legCost(10, "walk", 7.5, p)).toBeCloseTo(15 * (1 + phi(7.5)));
  });
  test("waits and rides are not priced (A4)", () => {
    expect(legCost(10, "wait", 30, p)).toBeCloseTo(15);
    expect(legCost(10, "ride", 30, p)).toBeCloseTo(10);
  });
  test("dose uses true exposure", () => {
    expect(legDose(60, "wait", "halte", 10)).toBeCloseTo(4);
    expect(legDose(60, "wait", "station", 10)).toBeCloseTo(1);
    expect(legDose(60, "ride", "none", 10)).toBe(0);
  });
});

const T0 = Date.UTC(2026, 10, 16, 1, 0); // Mon 08:00 WIB
const grid = (fn: (step: number) => number): RainGrid => {
  const nLat = 3;
  const nLng = 3;
  const nt = 4;
  const values: number[] = [];
  for (let s = 0; s < nt; s++)
    for (let i = 0; i < nLat * nLng; i++) values.push(fn(s));
  return {
    issuedAt: T0,
    source: "test",
    lat0: -6.7,
    lng0: 106.4,
    dLat: 0.4,
    dLng: 0.4,
    nLat,
    nLng,
    t0: T0,
    dt: 15 * 60_000,
    nt,
    values,
  };
};

describe("rain field", () => {
  test("linear in time between steps", () => {
    const f = new RainField(grid((s) => s * 4));
    expect(f.at(-6.2, 106.8, T0)).toBeCloseTo(0);
    expect(f.at(-6.2, 106.8, T0 + 7.5 * 60_000)).toBeCloseTo(2);
    expect(f.at(-6.2, 106.8, T0 + 15 * 60_000)).toBeCloseTo(4);
  });
  test("no grid, no rain", () => {
    expect(new RainField(null).at(-6.2, 106.8, T0)).toBe(0);
  });
});

describe("eta", () => {
  test("factors stay in sane bounds all week", () => {
    for (let h = 0; h < 24 * 7; h++) {
      const t = T0 + h * 3_600_000;
      const tf = trafficFactor(t);
      expect(tf).toBeGreaterThan(0.5);
      expect(tf).toBeLessThan(2.5);
      expect(rideFactor(t, 0, 0)).toBeCloseTo(1);
      expect(rideFactor(t, 1, 30)).toBeLessThan(2.5);
      expect(motoFactor(t, 30)).toBeLessThan(2.5);
    }
  });
  test("rain never speeds things up", () => {
    expect(motoFactor(T0, 15)).toBeGreaterThan(motoFactor(T0, 0));
  });
});

const pt = (lat: number, lng: number, name?: string) => ({ lat, lng, name });
const leg = (
  kind: Leg["kind"],
  t0min: number,
  t1min: number,
  rain: number,
  place?: Leg["place"],
): Leg => ({
  kind,
  place,
  from: pt(-6.2, 106.8, `${kind}${t0min}`),
  to: pt(-6.2, 106.81),
  t0: T0 + t0min * 60_000,
  t1: T0 + t1min * 60_000,
  minutes: t1min - t0min,
  rain,
  dose: 0,
  cost: 0,
  path: [],
});
const itin = (legs: Leg[]): Itinerary => ({
  type: "transit",
  legs,
  depart: legs[0].t0,
  arrive: legs[legs.length - 1].t1,
  minutes: 0,
  dose: 0,
  exposedMin: 0,
  walkMin: 0,
  cost: 0,
  fare: 0,
  transfers: 0,
});

describe("alerts", () => {
  test("dry trip, no alerts", () => {
    expect(planAlerts(itin([leg("walk", 0, 10, 0)]))).toHaveLength(0);
  });
  test("rain on the last walk is announced before it", () => {
    const it = itin([
      leg("walk", 0, 5, 0),
      leg("ride", 5, 40, 12),
      leg("walk", 40, 48, 12),
    ]);
    const a = planAlerts(it);
    expect(a.length).toBeGreaterThan(0);
    expect(a[0].covered).toBe(false);
    expect(a[0].issueAt).toBeLessThan(T0 + 40 * 60_000);
  });
  test("on the bus the text says you are sheltered", () => {
    const it = itin([
      leg("walk", 0, 5, 12),
      leg("ride", 5, 40, 12),
      leg("walk", 40, 48, 12),
    ]);
    const [a] = planAlerts(it);
    const tx = alertText(a, T0 + 20 * 60_000, "en");
    expect(tx.headline).toContain("under cover");
    expect(tx.advice).toContain("Back outside in 20 min");
  });
  test("rain only while riding is covered", () => {
    const it = itin([
      leg("walk", 0, 5, 0),
      leg("ride", 5, 40, 12),
      leg("walk", 40, 48, 0),
    ]);
    for (const a of planAlerts(it)) expect(a.covered).toBe(true);
  });
});

describe("router on the real network", () => {
  const file = JSON.parse(
    gunzipSync(readFileSync("public/network/network.json.gz")).toString(),
  ) as NetworkFile;
  const net = new Network(file);
  const blokM = pt(-6.2436, 106.8007, "Blok M");
  const monas = pt(-6.1766, 106.823, "Monas");
  const dry = new RainField(null);

  test("dry weather: weather-aware equals fastest", () => {
    const r = plan(net, dry, blokM, monas, T0, { beta: 4, moto: "none" });
    expect(r.fastest).not.toBeNull();
    expect(r.shift).toBe(false);
    expect(r.weatherAware?.minutes).toBeCloseTo(r.fastest?.minutes ?? 0);
  });

  test("β = 0 never shifts", () => {
    const wet = new RainField(grid(() => 15));
    const r = plan(net, wet, blokM, monas, T0, { beta: 0 });
    expect(r.shift).toBe(false);
  });

  test("heavy rain: the weather-aware route is no wetter", () => {
    const wet = new RainField(grid(() => 15));
    const r = plan(net, wet, blokM, monas, T0, { beta: 4 });
    expect(r.weatherAware).not.toBeNull();
    expect(r.weatherAware?.dose ?? 0).toBeLessThanOrEqual(
      (r.fastest?.dose ?? 0) + 1e-9,
    );
  });

  test("plans in well under a second", () => {
    const t = performance.now();
    plan(net, dry, blokM, monas, T0, { moto: "none" });
    expect(performance.now() - t).toBeLessThan(1000);
  });
});
