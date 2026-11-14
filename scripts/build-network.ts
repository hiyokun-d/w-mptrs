/**
 * Build the routing network from real data into public/network/.
 *
 *   bun scripts/build-network.ts [path/to/transjakarta-gtfs.zip]
 *
 * Sources
 *   TransJakarta  official GTFS  https://gtfs.transjakarta.co.id/files/file_gtfs.zip
 *   KRL           snapshot from scripts/fetch-krl.ts (Comuline API)
 *   MRT / LRT     scripts/data/rail-lines.ts (published run times and headways)
 *   coordinates   scripts/data/rail-stations.json
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { gzipSync } from "node:zlib";
import AdmZip from "adm-zip";
import Papa from "papaparse";
import {
  haversine,
  Network,
  type NetworkFile,
  type Pattern,
  type RouteInfo,
  type Source,
  type StopKind,
} from "../src/lib/core/network";
import {
  encodePolyline,
  type LatLng,
  simplify,
} from "../src/lib/core/polyline";
import { KRL_LINES, RAIL_LINES } from "./data/rail-lines";

const TJ_URL = "https://gtfs.transjakarta.co.id/files/file_gtfs.zip";
const OUT_DIR = "public/network";

type Row = Record<string, string>;
const csv = (text: string): Row[] =>
  Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  }).data;

const hms = (t: string) => {
  const [h, m, s] = t.split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
};

// ── stop table ───────────────────────────────────────────────────────────────
const stops = {
  id: [] as string[],
  name: [] as string[],
  lat: [] as number[],
  lng: [] as number[],
  kind: [] as StopKind[],
  parent: [] as number[],
};
const stopIndex = new Map<string, number>();
function addStop(
  id: string,
  name: string,
  lat: number,
  lng: number,
  kind: StopKind,
): number {
  const have = stopIndex.get(id);
  if (have !== undefined) return have;
  const i = stops.id.length;
  stops.id.push(id);
  stops.name.push(name);
  stops.lat.push(Math.round(lat * 1e6) / 1e6);
  stops.lng.push(Math.round(lng * 1e6) / 1e6);
  stops.kind.push(kind);
  stops.parent.push(-1);
  stopIndex.set(id, i);
  return i;
}

const routes: RouteInfo[] = [];
const patterns: Pattern[] = [];
const transfers: [number, number, number, number][] = [];
const sources: Source[] = [];

/**
 * Snap each stop to a shape vertex, in order. A dynamic programme over a few
 * candidate vertices per stop minimises snap distance plus any shape length
 * beyond 1.5× the straight stop spacing, so a stop on a loop route snaps to
 * the pass the bus actually serves instead of the far side of the loop.
 */
function matchStops(shape: LatLng[], pts: LatLng[]): number[] | null {
  const cum = [0];
  for (let v = 1; v < shape.length; v++)
    cum.push(
      cum[v - 1] +
        haversine(shape[v - 1][0], shape[v - 1][1], shape[v][0], shape[v][1]),
    );
  const cands = pts.map(([la, lo]) => {
    const d = shape.map(
      ([a, b], v) => [haversine(la, lo, a, b), v] as [number, number],
    );
    // local minima within 400 m, plus the nearest few as a fallback
    const near = d.filter(
      ([x, v]) =>
        x < 400 &&
        (v === 0 || x <= d[v - 1][0]) &&
        (v === d.length - 1 || x <= d[v + 1][0]),
    );
    const best = [...d].sort((x, y) => x[0] - y[0]).slice(0, 4);
    const m = new Map<number, number>();
    for (const [x, v] of [...near, ...best]) m.set(v, x);
    return [...m.entries()].sort((x, y) => x[0] - y[0]);
  });
  const cost: number[][] = [];
  const back: number[][] = [];
  cands.forEach((cs, k) => {
    cost.push([]);
    back.push([]);
    for (const [v, dist] of cs) {
      if (k === 0) {
        cost[0].push(dist);
        back[0].push(-1);
        continue;
      }
      const direct = haversine(
        pts[k - 1][0],
        pts[k - 1][1],
        pts[k][0],
        pts[k][1],
      );
      let bc = Number.POSITIVE_INFINITY;
      let bi = -1;
      cands[k - 1].forEach(([u], j) => {
        if (u > v || !Number.isFinite(cost[k - 1][j])) return;
        const c =
          cost[k - 1][j] + Math.max(0, cum[v] - cum[u] - 1.5 * direct - 200);
        if (c < bc) {
          bc = c;
          bi = j;
        }
      });
      cost[k].push(bc + dist);
      back[k].push(bi);
    }
  });
  const last = cost.length - 1;
  let j = cost[last].indexOf(Math.min(...cost[last]));
  if (!Number.isFinite(cost[last][j])) {
    return null; // no monotone match (shape drawn backwards)
  }
  const out: number[] = new Array(pts.length);
  for (let k = last; k >= 0; k--) {
    out[k] = cands[k][j][0];
    j = back[k][j];
  }
  return out;
}

function straightShape(idx: number[]): { shape: string; cut: number[] } {
  const pts: LatLng[] = idx.map((i) => [stops.lat[i], stops.lng[i]]);
  return { shape: encodePolyline(pts), cut: idx.map((_, k) => k) };
}

// ── TransJakarta ─────────────────────────────────────────────────────────────
const MIXED: Record<string, number> = {
  BRT: 0.15, // dedicated busway, but junctions and lane intrusions remain
  Royaltrans: 0.5, // mostly toll road
  Transjabodetabek: 0.6,
};

async function loadTransJakarta(zipPath?: string) {
  let buf: Buffer;
  let fetched = new Date().toISOString();
  let note = "";
  if (zipPath) {
    buf = readFileSync(zipPath);
    note = `local copy (${basename(zipPath)})`;
  } else {
    const res = await fetch(TJ_URL, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`TJ GTFS download failed: ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    note = `Last-Modified ${res.headers.get("last-modified")}, ETag ${res.headers.get("etag")}`;
    fetched = new Date().toISOString();
  }
  const zip = new AdmZip(buf);
  const read = (n: string) => {
    const e = zip.getEntry(n);
    return e ? csv(e.getData().toString("utf8")) : [];
  };

  const gStops = read("stops.txt");
  for (const s of gStops) {
    const lat = Number(s.stop_lat);
    const lng = Number(s.stop_lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // H = halte (station), G = platform inside a halte, B = roadside stop
    const halte =
      s.location_type === "1" ||
      s.stop_id.startsWith("H") ||
      s.parent_station.startsWith("H");
    addStop(`tj:${s.stop_id}`, s.stop_name, lat, lng, halte ? 0 : 1);
  }
  for (const s of gStops) {
    if (!s.parent_station) continue;
    const i = stopIndex.get(`tj:${s.stop_id}`);
    const p = stopIndex.get(`tj:${s.parent_station}`);
    if (i !== undefined && p !== undefined) stops.parent[i] = p;
  }
  // a halte is its own parent, so its platforms and the station node link up
  for (let i = 0; i < stops.id.length; i++) {
    if (
      stops.kind[i] === 0 &&
      stops.parent[i] < 0 &&
      stops.id[i].startsWith("tj:H")
    )
      stops.parent[i] = i;
  }

  const fareById = new Map(
    read("fare_attributes.txt").map((f) => [f.fare_id, Number(f.price)]),
  );
  const fareByRoute = new Map(
    read("fare_rules.txt").map((f) => [
      f.route_id,
      fareById.get(f.fare_id) ?? 3500,
    ]),
  );
  const routeIdx = new Map<string, number>();
  for (const r of read("routes.txt")) {
    routeIdx.set(r.route_id, routes.length);
    routes.push({
      id: `tj:${r.route_id}`,
      short: r.route_short_name || r.route_id,
      long: r.route_long_name,
      mode: "transjakarta",
      cat: r.route_desc || "TransJakarta",
      color: `#${r.route_color || "D71920"}`,
      fare: fareByRoute.get(r.route_id) ?? 3500,
      mixed: MIXED[r.route_desc] ?? 1,
    });
  }

  const dayMask = new Map<string, number>();
  const DAYS = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];
  for (const c of read("calendar.txt")) {
    if (Number(c.end_date) < 20260101) continue; // expired services
    dayMask.set(
      c.service_id,
      DAYS.reduce((m, d, k) => m | (c[d] === "1" ? 1 << k : 0), 0),
    );
  }

  const shapes = new Map<string, LatLng[]>();
  for (const p of read("shapes.txt")) {
    const pts = shapes.get(p.shape_id) ?? [];
    pts[Number(p.shape_pt_sequence)] = [
      Number(p.shape_pt_lat),
      Number(p.shape_pt_lon),
    ];
    shapes.set(p.shape_id, pts);
  }

  const times = new Map<string, Row[]>();
  for (const st of read("stop_times.txt")) {
    const a = times.get(st.trip_id) ?? [];
    a.push(st);
    times.set(st.trip_id, a);
  }
  const freq = new Map<string, [number, number, number][]>();
  for (const f of read("frequencies.txt")) {
    const a = freq.get(f.trip_id) ?? [];
    a.push([hms(f.start_time), hms(f.end_time), Number(f.headway_secs)]);
    freq.set(f.trip_id, a);
  }

  let skipped = 0;
  for (const t of read("trips.txt")) {
    const route = routeIdx.get(t.route_id);
    const days = dayMask.get(t.service_id);
    const st = times.get(t.trip_id);
    const hw = freq.get(t.trip_id);
    if (route === undefined || !days || !st || st.length < 2 || !hw) {
      skipped++;
      continue;
    }
    st.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    const idx = st.map((s) => stopIndex.get(`tj:${s.stop_id}`));
    if (idx.some((i) => i === undefined)) {
      skipped++;
      continue;
    }
    const sIdx = idx as number[];
    const t0 = hms(st[0].departure_time || st[0].arrival_time);
    const offsets = st.map((s) => hms(s.arrival_time || s.departure_time) - t0);
    for (let k = 1; k < offsets.length; k++)
      offsets[k] = Math.max(offsets[k], offsets[k - 1]);

    const raw = (shapes.get(t.shape_id) ?? []).filter(Boolean);
    let shape: string;
    let cut: number[];
    if (raw.length >= 2) {
      const simple = simplify(raw, 8);
      const m = matchStops(
        simple,
        sIdx.map((i) => [stops.lat[i], stops.lng[i]] as LatLng),
      );
      if (m) {
        cut = m;
        shape = encodePolyline(simple);
      } else ({ shape, cut } = straightShape(sIdx));
    } else {
      ({ shape, cut } = straightShape(sIdx));
    }
    hw.sort((a, b) => a[0] - b[0]);
    patterns.push({
      route,
      headsign: t.trip_headsign,
      days,
      stops: sIdx,
      offsets,
      shape,
      cut,
      headways: hw,
    });
  }

  for (const tr of read("transfers.txt")) {
    const a = stopIndex.get(`tj:${tr.from_stop_id}`);
    const b = stopIndex.get(`tj:${tr.to_stop_id}`);
    if (a !== undefined && b !== undefined)
      transfers.push([a, b, Number(tr.min_transfer_time) || 120, 0]);
  }

  sources.push({
    name: "TransJakarta GTFS (official)",
    url: TJ_URL,
    fetchedAt: fetched,
    note: `${note}; ${patterns.length} trip patterns, ${skipped} skipped (expired or incomplete)`,
  });
}

// ── rail coordinates ─────────────────────────────────────────────────────────
type StationRec = { id?: string; name: string; lat: number; lng: number };
const rail = JSON.parse(
  readFileSync("scripts/data/rail-stations.json", "utf8"),
) as {
  krl: Record<string, StationRec>;
  mrt: StationRec[];
  lrt_jakarta: StationRec[];
  lrt_jabodebek: StationRec[];
};

// ── KRL (timetable) ──────────────────────────────────────────────────────────
function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
}

function loadKrl() {
  const snap = JSON.parse(
    readFileSync("scripts/data/krl-trains.json", "utf8"),
  ) as {
    source: string;
    fetchedAt: string;
    dataUpdatedAt: string;
    trains: {
      id: string;
      line: string;
      route: string;
      color: string;
      stops: [string, number][];
    }[];
  };
  const lineRoute = new Map<string, number>();
  const groups = new Map<
    string,
    { line: string; seq: number[]; deps: number[]; offs: number[][] }
  >();
  let dropped = 0;
  for (const t of snap.trains) {
    const seq: number[] = [];
    const tt: number[] = [];
    for (const [code, sec] of t.stops) {
      const c = rail.krl[code];
      if (!c) continue;
      const i = addStop(`krl:${code}`, c.name, c.lat, c.lng, 2);
      if (seq[seq.length - 1] === i) continue;
      seq.push(i);
      tt.push(sec);
    }
    if (seq.length < 2) {
      dropped++;
      continue;
    }
    const key = `${t.line}|${seq.join(",")}`;
    const g = groups.get(key) ?? { line: t.line, seq, deps: [], offs: [] };
    g.deps.push(tt[0]);
    g.offs.push(tt.map((x) => x - tt[0]));
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    let route = lineRoute.get(g.line);
    if (route === undefined) {
      const meta = KRL_LINES[g.line] ?? { short: g.line, color: "#E30A16" };
      route = routes.length;
      lineRoute.set(g.line, route);
      const airport = g.line.endsWith("BST");
      routes.push({
        id: `krl:${g.line}`,
        short: meta.short,
        long: g.line.replace("COMMUTER LINE", "Commuter Line"),
        mode: "krl",
        cat: airport ? "Airport rail" : "KRL",
        color: meta.color,
        fare: airport ? 70000 : 3000,
        mixed: 0,
      });
    }
    const offsets = g.seq.map((_, k) => median(g.offs.map((o) => o[k])));
    const { shape, cut } = straightShape(g.seq);
    patterns.push({
      route,
      headsign: stops.name[g.seq[g.seq.length - 1]],
      days: 127, // the snapshot has no weekday/weekend split
      stops: g.seq,
      offsets,
      shape,
      cut,
      departures: g.deps.sort((a, b) => a - b),
    });
  }
  sources.push({
    name: "KRL Commuter Line timetable (Comuline API, from KAI Commuter)",
    url: "https://api.comuline.com",
    fetchedAt: snap.fetchedAt,
    note: `timetable data last updated ${snap.dataUpdatedAt}; ${snap.trains.length - dropped} trains in ${groups.size} stopping patterns`,
  });
}

// ── MRT / LRT (headways) ─────────────────────────────────────────────────────
function loadMetro() {
  const byId = new Map<string, StationRec>();
  for (const s of [...rail.mrt, ...rail.lrt_jakarta, ...rail.lrt_jabodebek])
    if (s.id) byId.set(s.id, s);
  const DWELL = 30;
  for (const line of RAIL_LINES) {
    const route = routes.length;
    routes.push({
      id: line.id,
      short: line.short,
      long: line.long,
      mode: line.mode,
      cat: line.mode.toUpperCase(),
      color: line.color,
      fare: line.fare,
      mixed: 0,
    });
    const idx = line.stations.map((id) => {
      const s = byId.get(id);
      if (!s || s.lat == null) throw new Error(`missing coordinates for ${id}`);
      return addStop(
        `${line.mode}:${id}`,
        s.name,
        s.lat,
        s.lng,
        line.mode === "mrt" ? 3 : 4,
      );
    });
    for (const dir of [idx, [...idx].reverse()]) {
      // run time shared out by distance, plus a fixed dwell per stop
      const seg = dir
        .slice(1)
        .map((s, k) =>
          haversine(
            stops.lat[dir[k]],
            stops.lng[dir[k]],
            stops.lat[s],
            stops.lng[s],
          ),
        );
      const total = seg.reduce((a, b) => a + b, 0);
      const moving = line.minutes * 60 - DWELL * (dir.length - 2);
      const offsets = [0];
      seg.forEach((d, k) => {
        offsets.push(offsets[k] + (moving * d) / total + (k > 0 ? DWELL : 0));
      });
      const bands = (b: [number, number, number][]) =>
        b.map(
          ([h0, h1, m]) =>
            [Math.round(h0 * 3600), Math.round(h1 * 3600), m * 60] as [
              number,
              number,
              number,
            ],
        );
      const { shape, cut } = straightShape(dir);
      const common = {
        route,
        headsign: stops.name[dir[dir.length - 1]],
        stops: dir,
        offsets: offsets.map(Math.round),
        shape,
        cut,
      };
      patterns.push({
        ...common,
        days: 0b0011111,
        headways: bands(line.weekday),
      });
      patterns.push({
        ...common,
        days: 0b1100000,
        headways: bands(line.weekend),
      });
    }
  }
  sources.push({
    name: "MRT Jakarta, LRT Jakarta, LRT Jabodebek",
    url: "scripts/data/rail-lines.ts",
    fetchedAt: new Date().toISOString(),
    note: "published end-to-end run times and headways by time of day (approximate); MRT Phase 1 only (Phase 2A opens late 2027)",
  });
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  await loadTransJakarta(process.argv[2]);
  loadKrl();
  loadMetro();

  const body = { stops, routes, patterns, transfers, sources };
  const version = createHash("sha1")
    .update(JSON.stringify(body))
    .digest("hex")
    .slice(0, 10);
  const file: NetworkFile = {
    version,
    builtAt: new Date().toISOString(),
    ...body,
  };

  // connectivity check from Dukuh Atas (walking + any transit, ignoring time)
  const net = new Network(file);
  const start = net.near(-6.2014, 106.8229, 300)[0]?.stop ?? 0;
  const seen = new Uint8Array(net.n);
  const q = [start];
  seen[start] = 1;
  while (q.length) {
    const s = q.pop() as number;
    const next = [
      ...net.foot[s].map((f) => f.to),
      ...net.at[s].flatMap(({ pattern, pos }) =>
        file.patterns[pattern].stops.slice(pos + 1),
      ),
    ];
    for (const t of next)
      if (!seen[t]) {
        seen[t] = 1;
        q.push(t);
      }
  }
  const served = new Set(file.patterns.flatMap((p) => p.stops));
  const reach = [...served].filter((s) => seen[s]).length;

  mkdirSync(OUT_DIR, { recursive: true });
  const json = JSON.stringify(file);
  const gz = gzipSync(json, { level: 9 });
  writeFileSync(`${OUT_DIR}/network.json.gz`, gz);
  writeFileSync(
    `${OUT_DIR}/manifest.json`,
    JSON.stringify(
      {
        version,
        builtAt: file.builtAt,
        bytes: gz.length,
        counts: {
          stops: stops.id.length,
          routes: routes.length,
          patterns: file.patterns.length,
        },
        sources,
      },
      null,
      1,
    ),
  );

  const count = (m: string) =>
    file.patterns.filter((p) => routes[p.route].mode === m).length;
  console.log(`network ${version}`);
  console.log(
    `  stops     ${stops.id.length} (served by a pattern: ${served.size})`,
  );
  console.log(`  routes    ${routes.length}`);
  console.log(
    `  patterns  ${file.patterns.length}  (TJ ${count("transjakarta")}, KRL ${count("krl")}, MRT ${count("mrt")}, LRT ${count("lrt")})`,
  );
  console.log(
    `  footpaths ${net.foot.reduce((a, f) => a + f.length, 0)} (≤ 400 m, computed at load)`,
  );
  console.log(
    `  reachable from Dukuh Atas: ${((100 * reach) / served.size).toFixed(1)} % of served stops`,
  );
  console.log(
    `  size      ${(json.length / 1e6).toFixed(1)} MB json, ${(gz.length / 1e6).toFixed(2)} MB gzip`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
