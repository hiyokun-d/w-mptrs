import { type NextRequest, NextResponse } from "next/server";
import { exposure, type LegKind, type WaitPlace } from "@/lib/core/dp";
import { db } from "@/lib/db";

// Vercel Cron (vercel.json): re-scores logged trips on the rain that actually
// fell, so forecast-time choices can be judged against what happened.
// "Observed" = Open-Meteo past 15-minute precipitation (best-estimate model
// analysis, not gauges), sampled at each leg's rounded midpoint and mid-time.

export const maxDuration = 60;

const BATCH = 40;
const SETTLE_MS = 3 * 3_600_000; // wait until the trip and its rain are in the past
const MAX_AGE_MS = 2 * 24 * 3_600_000; // Open-Meteo past_days=2

interface LegLog {
  kind: LegKind;
  place?: WaitPlace;
  minutes: number;
  t0: number;
  lat: number;
  lng: number;
}
interface ItLog {
  legs: LegLog[];
}

type Series = { t: number[]; v: number[] };

async function pastRain(points: [number, number][]): Promise<Series[]> {
  const url =
    "https://api.open-meteo.com/v1/forecast?" +
    new URLSearchParams({
      latitude: points.map((p) => p[0]).join(","),
      longitude: points.map((p) => p[1]).join(","),
      minutely_15: "precipitation",
      past_days: "2",
      forecast_days: "1",
      timezone: "GMT",
    });
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const body = await res.json();
  const list = (Array.isArray(body) ? body : [body]) as {
    minutely_15: { time: string[]; precipitation: (number | null)[] };
  }[];
  return list.map((r) => ({
    t: r.minutely_15.time.map((s) => Date.parse(`${s}Z`)),
    // mm per 15 min → mm/h
    v: r.minutely_15.precipitation.map((x) => (x ?? 0) * 4),
  }));
}

function at(s: Series, t: number): number {
  const { t: ts, v } = s;
  if (!ts.length || t <= ts[0]) return v[0] ?? 0;
  for (let i = 1; i < ts.length; i++)
    if (t <= ts[i]) {
      const f = (t - ts[i - 1]) / (ts[i] - ts[i - 1]);
      return v[i - 1] + f * (v[i] - v[i - 1]);
    }
  return v[v.length - 1];
}

const key = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

function dose(it: ItLog | null, rain: Map<string, Series>): number | null {
  if (!it?.legs?.length) return null;
  let mm = 0;
  for (const g of it.legs) {
    const s = rain.get(key(g.lat, g.lng));
    if (!s) return null;
    const r = at(s, g.t0 + (g.minutes * 60_000) / 2);
    mm += (g.minutes * exposure(g.kind, g.place ?? "none") * r) / 60;
  }
  return mm;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const now = Date.now();
  const rows = await db.planLog.findMany({
    where: {
      realisedAt: null,
      scenario: "live", // demo storms have no real counterpart
      depart: { lt: new Date(now - SETTLE_MS), gt: new Date(now - MAX_AGE_MS) },
    },
    orderBy: { depart: "asc" },
    take: BATCH,
  });
  if (!rows.length) return NextResponse.json({ realised: 0 });

  const pts = new Map<string, [number, number]>();
  for (const r of rows)
    for (const it of [r.fastest, r.weatherAware] as unknown as (ItLog | null)[])
      for (const g of it?.legs ?? [])
        pts.set(key(g.lat, g.lng), [g.lat, g.lng]);

  const list = [...pts.entries()];
  const rain = new Map<string, Series>();
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const series = await pastRain(chunk.map(([, p]) => p));
    chunk.forEach(([k], j) => {
      rain.set(k, series[j]);
    });
  }

  let realised = 0;
  for (const r of rows) {
    const f = dose(r.fastest as unknown as ItLog | null, rain);
    const w = dose(r.weatherAware as unknown as ItLog | null, rain);
    await db.planLog.update({
      where: { id: r.id },
      data: {
        realisedAt: new Date(),
        realisedFastestDose: f,
        realisedWeatherDose: w,
      },
    });
    realised++;
  }
  return NextResponse.json({ realised, points: list.length });
}
