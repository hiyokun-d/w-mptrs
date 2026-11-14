"use client";

import type { Alert } from "@/lib/core/alerts";
import { Network, type NetworkFile } from "@/lib/core/network";
import { type PlanResult, plan } from "@/lib/core/plan";
import { RainField, type RainGrid, type StormCell } from "@/lib/core/rainfield";
import {
  type Itinerary,
  type Point,
  Router,
  type SearchTrace,
} from "@/lib/core/router";
import {
  type RainReport,
  reportCells,
  type Scenario,
  scenarioCells,
} from "@/lib/core/scenarios";
import { db, deviceId } from "./db";

export interface PlanResponse extends PlanResult {
  network: { version: string; builtAt: string };
  rain: { source: string; issuedAt: number | null };
  scenario: Scenario;
  cells: StormCell[];
  offline?: boolean;
}

export interface PlanInput {
  from: Point;
  to: Point;
  depart?: number;
  beta: number;
  moto: "ojek" | "own" | "none";
  scenario: Scenario;
  /** rupiah per perceived minute (0 = ignore price), ojek budget (0 = none) */
  vot?: number;
  maxOjek?: number;
  /** storms to use instead of the scenario's (a re-plan mid-trip) */
  cells?: StormCell[];
  /** travellers' rain reports this session */
  reports?: RainReport[];
  /** false for what-if plans (leave later), which are not research data */
  log?: boolean;
}

/** Server first; if the network is down, route on this device. */
export async function planTrip(input: PlanInput): Promise<PlanResponse> {
  const depart = input.depart ?? Date.now();
  try {
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, log: undefined, depart }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status >= 400 && res.status < 500)
      throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
    if (!res.ok) throw new TypeError(`HTTP ${res.status}`);
    const out = (await res.json()) as PlanResponse;
    if (input.log !== false) void enqueueLog(input, out);
    void refreshCaches(out.network.version);
    return out;
  } catch (e) {
    if (!(e instanceof TypeError) && !(e instanceof DOMException)) throw e;
    const out = await planLocally(input, depart);
    if (input.log !== false) void enqueueLog(input, out);
    return out;
  }
}

// ── offline network + rain cache ─────────────────────────────────────────────

let netPromise: Promise<Network | null> | null = null;

async function loadCachedNetwork(): Promise<Network | null> {
  const blob = await db.blobs.get("network");
  return blob ? new Network(JSON.parse(blob.data) as NetworkFile) : null;
}

/** The cached network for client-side work (vehicles, the search replay). */
export async function localNetwork(): Promise<Network | null> {
  netPromise ??= loadCachedNetwork();
  if (!(await netPromise)) {
    await refreshCaches();
    netPromise = loadCachedNetwork();
  }
  return netPromise;
}

/**
 * Re-runs one transit search on this device and records the order in which
 * stops were settled, so the presentation can show Dijkstra's front growing.
 */
export async function traceSearch(
  from: Point,
  to: Point,
  depart: number,
  beta: number,
  field: RainField,
) {
  const net = await localNetwork();
  if (!net) return null;
  const r = new Router(net, field);
  const trace: SearchTrace = { dest: net.n, init: [], steps: [] };
  r.trace = trace;
  const it = r.transit(from, to, depart, { beta });
  return { trace, it, ms: r.stats.ms, relaxed: r.stats.relaxed };
}

export async function refreshCaches(serverVersion?: string): Promise<void> {
  try {
    const have = await db.blobs.get("network");
    const manifest = serverVersion
      ? { version: serverVersion }
      : ((await (
          await fetch("/network/manifest.json", { cache: "no-cache" })
        ).json()) as { version: string });
    if (have?.version !== manifest.version) {
      const res = await fetch(`/network/network.json.gz?v=${manifest.version}`);
      if (res.ok && res.body) {
        const text = await new Response(
          res.body.pipeThrough(new DecompressionStream("gzip")),
        ).text();
        await db.blobs.put({
          key: "network",
          version: manifest.version,
          data: text,
          savedAt: Date.now(),
        });
        netPromise = null;
      }
    }
    const rain = await fetch("/api/rain");
    if (rain.ok) {
      const g = await rain.text();
      await db.blobs.put({
        key: "rain",
        version: "latest",
        data: g,
        savedAt: Date.now(),
      });
    }
  } catch {
    // offline: keep what we have
  }
}

async function planLocally(
  input: PlanInput,
  depart: number,
): Promise<PlanResponse> {
  netPromise ??= loadCachedNetwork();
  const net = await netPromise;
  if (!net) throw new Error("offline and no cached network yet");
  const rb = await db.blobs.get("rain");
  const grid = rb ? (JSON.parse(rb.data) as RainGrid) : null;
  const cells = [
    ...(input.cells ?? scenarioCells(input.scenario, input.from, input.to)),
    ...reportCells(input.reports ?? [], depart),
  ];
  const result = plan(
    net,
    new RainField(grid, cells, depart),
    input.from,
    input.to,
    depart,
    {
      beta: input.beta,
      moto: input.moto,
      vot: input.vot,
      maxOjek: input.maxOjek,
    },
  );
  return {
    ...result,
    network: { version: net.file.version, builtAt: net.file.builtAt },
    rain: grid
      ? { source: `${grid.source} (cached)`, issuedAt: grid.issuedAt }
      : { source: "none", issuedAt: null },
    scenario: input.scenario,
    cells,
    offline: true,
  };
}

// ── research log queue ───────────────────────────────────────────────────────

const round3 = (x: number) => Math.round(x * 1000) / 1000;

function summary(it: Itinerary | null) {
  if (!it) return null;
  return {
    type: it.type,
    minutes: +it.minutes.toFixed(2),
    dose: +it.dose.toFixed(4),
    exposedMin: +it.exposedMin.toFixed(2),
    walkMin: +it.walkMin.toFixed(2),
    transfers: it.transfers,
    fare: it.fare,
    legs: it.legs.map((g) => ({
      kind: g.kind,
      place: g.place,
      route: g.route?.short,
      minutes: +g.minutes.toFixed(2),
      rain: +g.rain.toFixed(2),
      t0: g.t0,
      // midpoint only, rounded (~100 m): enough to re-score with observed rain
      lat: round3((g.from.lat + g.to.lat) / 2),
      lng: round3((g.from.lng + g.to.lng) / 2),
    })),
  };
}

async function enqueueLog(input: PlanInput, out: PlanResponse): Promise<void> {
  try {
    await db.logQueue.add({
      createdAt: Date.now(),
      payload: {
        deviceId: await deviceId(),
        depart: out.depart,
        beta: input.beta,
        moto: input.moto,
        vot: input.vot ?? 0,
        maxOjek: input.maxOjek ?? 0,
        scenario: out.scenario,
        originLat: round3(input.from.lat),
        originLng: round3(input.from.lng),
        destLat: round3(input.to.lat),
        destLng: round3(input.to.lng),
        rainSource: out.rain.source,
        rainIssuedAt: out.rain.issuedAt,
        networkVersion: out.network.version,
        offline: !!out.offline,
        shift: out.shift,
        fastest: summary(out.fastest),
        weatherAware: summary(out.weatherAware),
      },
    });
    void flushLog();
  } catch {
    // storage unavailable: skip logging
  }
}

let flushing = false;
export async function flushLog(): Promise<void> {
  if (flushing || (typeof navigator !== "undefined" && !navigator.onLine))
    return;
  flushing = true;
  try {
    const rows = await db.logQueue.orderBy("createdAt").limit(50).toArray();
    if (!rows.length) return;
    const res = await fetch("/api/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows: rows.map((r) => r.payload) }),
    });
    if (res.ok) await db.logQueue.bulkDelete(rows.map((r) => r.id as number));
  } catch {
    // retry later
  } finally {
    flushing = false;
  }
}

export type { Alert, Itinerary };
