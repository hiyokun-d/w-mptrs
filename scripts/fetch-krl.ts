/**
 * Snapshot KRL Commuter Line Jabodetabek timetables from the Comuline API
 * (https://api.comuline.com, unofficial, synced from KAI) into
 * scripts/data/krl-trains.json. build-network.ts reads the snapshot, so the
 * app never depends on Comuline at runtime.
 *
 *   bun scripts/fetch-krl.ts
 *
 * Comuline stores times as UTC timestamps on a fixed date; we keep only the
 * time of day in WIB (UTC+7), in seconds after midnight.
 */
import { mkdirSync, writeFileSync } from "node:fs";

const API = "https://api.comuline.com/v1";
const KEEP_LINES = new Set([
  "COMMUTER LINE BOGOR",
  "COMMUTER LINE CIKARANG",
  "COMMUTER LINE RANGKASBITUNG",
  "COMMUTER LINE BST",
  "COMMUTER LINE TANGERANG",
  "COMMUTER LINE TANJUNGPRIUK",
]);

interface Schedule {
  station_id: string;
  train_id: string;
  line: string;
  route: string;
  station_origin_id: string;
  station_destination_id: string;
  departs_at: string;
  arrives_at: string;
  updated_at: string;
  metadata?: { origin?: { color?: string } };
}

async function get<T>(path: string): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}${path}`, {
      headers: { "User-Agent": "w-mptrs-research/1.0" },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return ((await res.json()) as { data: T }).data;
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error(`GET ${path} failed`);
}

function wibSeconds(ts: string): number {
  // "2024-11-12 17:01:00.964+00" → ISO with a full "+00:00" offset
  const d = new Date(ts.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
  if (Number.isNaN(d.getTime())) throw new Error(`bad timestamp ${ts}`);
  return (d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + 7 * 3600) % 86400;
}

async function main() {
  const stations = await get<{ id: string; name: string; type: string }[]>("/station");
  const krl = stations.filter((s) => s.type === "KRL");
  const byTrain = new Map<
    string,
    { line: string; route: string; color: string; stops: [string, number][]; dest: string; destAt: number }
  >();
  let newest = "";
  for (const s of krl) {
    const rows = await get<Schedule[]>(`/schedule/${s.id}`);
    for (const r of rows) {
      if (!KEEP_LINES.has(r.line)) continue;
      if (r.updated_at > newest) newest = r.updated_at;
      let t = byTrain.get(r.train_id);
      if (!t) {
        t = {
          line: r.line,
          route: r.route,
          color: r.metadata?.origin?.color ?? "#E30A16",
          stops: [],
          dest: r.station_destination_id,
          destAt: wibSeconds(r.arrives_at),
        };
        byTrain.set(r.train_id, t);
      }
      t.stops.push([r.station_id, wibSeconds(r.departs_at)]);
    }
    process.stdout.write(".");
  }
  // Order each train's calls by time; trains running past midnight keep
  // increasing times so the sequence stays monotonic.
  const trains = [...byTrain.entries()].map(([id, { dest, destAt, ...t }]) => {
    // the timetable lists departures; add the terminus arrival
    if (!t.stops.some((s) => s[0] === dest)) t.stops.push([dest, destAt]);
    t.stops.sort((a, b) => a[1] - b[1]);
    const first = t.stops[0][1];
    if (t.stops[t.stops.length - 1][1] - first > 12 * 3600) {
      // wrapped around midnight: shift early-morning calls by a day
      for (const s of t.stops) if (s[1] < 12 * 3600) s[1] += 86400;
      t.stops.sort((a, b) => a[1] - b[1]);
    }
    return { id, ...t };
  });
  mkdirSync("scripts/data", { recursive: true });
  writeFileSync(
    "scripts/data/krl-trains.json",
    JSON.stringify({
      source: "https://api.comuline.com (unofficial, from KAI Commuter)",
      fetchedAt: new Date().toISOString(),
      dataUpdatedAt: newest,
      stations: Object.fromEntries(krl.map((s) => [s.id, s.name])),
      trains,
    }),
  );
  console.log(`\n${trains.length} trains, data last updated ${newest}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
