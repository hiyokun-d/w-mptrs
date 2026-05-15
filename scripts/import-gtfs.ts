import AdmZip from "adm-zip";
import Papa from "papaparse";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Direct URL required — pgbouncer (DATABASE_URL) may drop bulk inserts
const CONNECTION =
  process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!CONNECTION) {
  console.error("DIRECT_URL or DATABASE_URL required in .env");
  process.exit(1);
}

const GTFS_URL =
  "https://storage.googleapis.com/storage/v1/b/mdb-latest/o/id-jakarta-raya-transjakarta-gtfs-1909.zip?alt=media";

const TRANSIT_TYPE = "transjakarta";
const BATCH_SIZE = 500;

function parseCsv<T extends Record<string, string>>(text: string): T[] {
  return Papa.parse<T>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  }).data;
}

async function main() {
  const adapter = new PrismaPg({ connectionString: CONNECTION! });
  const prisma = new PrismaClient({ adapter });

  try {
    // ── 1. Download ───────────────────────────────────────────────────────────
    console.log("Downloading GTFS zip...");
    const res = await fetch(GTFS_URL);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());
    console.log(`  ${(buf.length / 1024 / 1024).toFixed(1)} MB received`);

    // ── 2. Extract ────────────────────────────────────────────────────────────
    const zip = new AdmZip(buf);
    const read = (name: string) => {
      const entry = zip.getEntry(name);
      if (!entry) throw new Error(`${name} not found in zip`);
      return entry.getData().toString("utf8");
    };

    // ── 3. Clear existing data for this type ──────────────────────────────────
    console.log("Clearing existing transit data...");
    await prisma.transitRoute.deleteMany({ where: { type: TRANSIT_TYPE } });
    await prisma.transitStop.deleteMany({ where: { type: TRANSIT_TYPE } });

    // ── 4. Stops ──────────────────────────────────────────────────────────────
    console.log("Parsing stops.txt...");
    type GtfsStop = {
      stop_id: string;
      stop_name: string;
      stop_lat: string;
      stop_lon: string;
      location_type: string;
      parent_station: string;
    };
    const rawStops = parseCsv<GtfsStop>(read("stops.txt"));
    const stops = rawStops
      .filter((r) => r.stop_lat && r.stop_lon)
      .map((r) => ({
        id: r.stop_id,
        name: r.stop_name,
        lat: parseFloat(r.stop_lat),
        lng: parseFloat(r.stop_lon),
        type: TRANSIT_TYPE,
        parentId: r.parent_station || null,
      }));

    console.log(`Inserting ${stops.length} stops...`);
    for (let i = 0; i < stops.length; i += BATCH_SIZE) {
      await prisma.transitStop.createMany({
        data: stops.slice(i, i + BATCH_SIZE),
      });
      process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, stops.length)}/${stops.length}`);
    }
    console.log();

    // ── 5. Routes ─────────────────────────────────────────────────────────────
    console.log("Parsing routes.txt...");
    type GtfsRoute = {
      route_id: string;
      route_short_name: string;
      route_long_name: string;
      route_type: string;
    };
    const rawRoutes = parseCsv<GtfsRoute>(read("routes.txt"));

    // ── 6. Trips — one representative trip per route (direction 0 preferred) ──
    console.log("Parsing trips.txt...");
    type GtfsTrip = {
      trip_id: string;
      route_id: string;
      direction_id: string;
    };
    const rawTrips = parseCsv<GtfsTrip>(read("trips.txt"));

    const routeTripMap = new Map<string, string>();
    for (const t of rawTrips) {
      if (!routeTripMap.has(t.route_id) || t.direction_id === "0") {
        routeTripMap.set(t.route_id, t.trip_id);
      }
    }

    // ── 7. Stop times — filter to selected trips only ─────────────────────────
    console.log("Parsing stop_times.txt (largest file, may take a moment)...");
    type GtfsStopTime = {
      trip_id: string;
      stop_id: string;
      stop_sequence: string;
    };
    const selectedTrips = new Set(routeTripMap.values());
    const tripStops = new Map<string, { stopId: string; seq: number }[]>();

    const rawStopTimes = parseCsv<GtfsStopTime>(read("stop_times.txt"));
    for (const st of rawStopTimes) {
      if (!selectedTrips.has(st.trip_id)) continue;
      if (!tripStops.has(st.trip_id)) tripStops.set(st.trip_id, []);
      tripStops.get(st.trip_id)!.push({
        stopId: st.stop_id,
        seq: parseInt(st.stop_sequence, 10),
      });
    }

    // ── 8. Upsert routes ──────────────────────────────────────────────────────
    console.log(`Inserting ${rawRoutes.length} routes...`);
    const routeData = rawRoutes.map((r) => {
      const tripId = routeTripMap.get(r.route_id);
      const stopIds = tripId
        ? (tripStops.get(tripId) ?? [])
            .sort((a, b) => a.seq - b.seq)
            .map((e) => e.stopId)
        : [];
      return {
        id: r.route_id,
        shortName: r.route_short_name || r.route_id,
        longName: r.route_long_name || "",
        type: TRANSIT_TYPE,
        stopIds,
      };
    });

    for (let i = 0; i < routeData.length; i += BATCH_SIZE) {
      await prisma.transitRoute.createMany({
        data: routeData.slice(i, i + BATCH_SIZE),
      });
      process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, routeData.length)}/${routeData.length}`);
    }
    console.log();

    console.log("\nDone.");
    console.log(`  transit_stops  → ${stops.length} rows`);
    console.log(`  transit_routes → ${rawRoutes.length} rows`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
