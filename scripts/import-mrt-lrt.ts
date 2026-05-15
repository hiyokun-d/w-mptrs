import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const CONNECTION = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!CONNECTION) {
  console.error("DIRECT_URL or DATABASE_URL required in .env");
  process.exit(1);
}

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "w-mptrs-research/1.0 (academic transit routing, Jakarta)";
const BBOX = { south: -7.5, west: 105.5, north: -5.5, east: 107.8 };

// ── Station data ──────────────────────────────────────────────────────────────

type Station = { id: string; name: string; lat: number; lng: number };

// MRT Jakarta North–South Line (hardcoded — known infrastructure)
const MRT_STATIONS: Station[] = [
  // Phase 1 (open 2019)
  { id: "mrt_lbg", name: "Lebak Bulus Grab",    lat: -6.3194, lng: 106.7741 },
  { id: "mrt_ftm", name: "Fatmawati Indomaret",  lat: -6.2999, lng: 106.7949 },
  { id: "mrt_cpr", name: "Cipete Raya",           lat: -6.2845, lng: 106.7990 },
  { id: "mrt_hnw", name: "Haji Nawi",             lat: -6.2696, lng: 106.7952 },
  { id: "mrt_bla", name: "Blok A",                lat: -6.2591, lng: 106.7960 },
  { id: "mrt_blm", name: "Blok M BCA",            lat: -6.2442, lng: 106.7973 },
  { id: "mrt_asn", name: "ASEAN",                 lat: -6.2345, lng: 106.8013 },
  { id: "mrt_sny", name: "Senayan",               lat: -6.2237, lng: 106.8016 },
  { id: "mrt_ist", name: "Istora Mandiri",         lat: -6.2175, lng: 106.8054 },
  { id: "mrt_bdh", name: "Bendungan Hilir",        lat: -6.2117, lng: 106.8133 },
  { id: "mrt_stb", name: "Setiabudi Astra",        lat: -6.2072, lng: 106.8216 },
  { id: "mrt_dka", name: "Dukuh Atas BNI",         lat: -6.2014, lng: 106.8229 },
  { id: "mrt_bhi", name: "Bundaran HI",            lat: -6.1944, lng: 106.8229 },
  // Phase 2 (extension toward Kota)
  { id: "mrt_thm", name: "Thamrin",               lat: -6.1888, lng: 106.8225 },
  { id: "mrt_mns", name: "Monas",                 lat: -6.1755, lng: 106.8272 },
  { id: "mrt_hrm", name: "Harmoni",               lat: -6.1667, lng: 106.8141 },
  { id: "mrt_swb", name: "Sawah Besar",           lat: -6.1572, lng: 106.8198 },
  { id: "mrt_mgb", name: "Mangga Besar",          lat: -6.1486, lng: 106.8237 },
  { id: "mrt_gdk", name: "Glodok",                lat: -6.1432, lng: 106.8183 },
  { id: "mrt_kot", name: "Kota",                  lat: -6.1378, lng: 106.8135 },
];

// LRT Jakarta Phase 1 (open 2019, East Jakarta)
const LRT_JAKARTA_STATIONS: Station[] = [
  { id: "lrtj_pgd", name: "Pegangsaan Dua",    lat: -6.1482, lng: 106.9092 },
  { id: "lrtj_bnu", name: "Boulevard Utara",   lat: -6.1618, lng: 106.9126 },
  { id: "lrtj_bns", name: "Boulevard Selatan", lat: -6.1740, lng: 106.9116 },
  { id: "lrtj_plm", name: "Pulomas",           lat: -6.1893, lng: 106.9025 },
  { id: "lrtj_eqs", name: "Equestrian",        lat: -6.1963, lng: 106.8969 },
  { id: "lrtj_vld", name: "Velodrome",         lat: -6.2042, lng: 106.8939 },
];

// LRT Jabodebek (open 2023) — geocoded via Nominatim
// Two branches from Cawang: Cibubur (SE) and Bekasi (E), trunk to Dukuh Atas (W)
// Fallbacks for stations Nominatim can't find
const JABODEBEK_OVERRIDES: Record<string, { lat: number; lng: number }> = {
  "Jatibening Baru": { lat: -6.2505, lng: 106.9168 },
  "Cawang":          { lat: -6.2614, lng: 106.8684 },
  "Ciliwung":        { lat: -6.2482, lng: 106.8636 },
  "Dukuh Atas":      { lat: -6.2014, lng: 106.8229 },
};

type JabodedekStation = { id: string; name: string; query: string };
const LRT_JABODEBEK_STATIONS: JabodedekStation[] = [
  // Cibubur branch (SE)
  { id: "lrtb_hjm", name: "Harjamukti",       query: "stasiun LRT Harjamukti Cibubur" },
  { id: "lrtb_crc", name: "Ciracas",          query: "stasiun LRT Ciracas Jakarta" },
  { id: "lrtb_kpr", name: "Kampung Rambutan", query: "stasiun LRT Kampung Rambutan Jakarta" },
  { id: "lrtb_tmn", name: "Taman Mini",       query: "stasiun LRT Taman Mini Jakarta" },
  // Bekasi branch (E)
  { id: "lrtb_jtm", name: "Jatimulya",        query: "stasiun LRT Jatimulya Bekasi" },
  { id: "lrtb_bkb", name: "Bekasi Barat",     query: "stasiun LRT Bekasi Barat" },
  { id: "lrtb_ck2", name: "Cikunir 2",        query: "stasiun LRT Cikunir 2 Bekasi" },
  { id: "lrtb_ck1", name: "Cikunir 1",        query: "stasiun LRT Cikunir 1 Bekasi" },
  { id: "lrtb_jtb", name: "Jatibening Baru",  query: "stasiun LRT Jatibening Baru" },
  { id: "lrtb_hlm", name: "Halim",            query: "stasiun LRT Halim Jakarta Timur" },
  // Trunk (Cawang → Dukuh Atas)
  { id: "lrtb_cwg", name: "Cawang",           query: "stasiun LRT Jabodebek Cawang" },
  { id: "lrtb_ckk", name: "Cikoko",           query: "stasiun LRT Cikoko Jakarta" },
  { id: "lrtb_clw", name: "Ciliwung",         query: "stasiun LRT Ciliwung Jakarta" },
  { id: "lrtb_dka", name: "Dukuh Atas",       query: "stasiun LRT Dukuh Atas Jakarta" },
  // Trunk extension (Dukuh Atas → Pancoran)
  { id: "lrtb_stb", name: "Setiabudi",        query: "stasiun LRT Setiabudi Jakarta" },
  { id: "lrtb_rsd", name: "Rasuna Said",      query: "stasiun LRT Rasuna Said Jakarta" },
  { id: "lrtb_kng", name: "Kuningan",         query: "stasiun LRT Kuningan Jakarta" },
  { id: "lrtb_pcr", name: "Pancoran",         query: "stasiun LRT Pancoran Jakarta" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  const url = new URL(NOMINATIM);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("countrycodes", "id");
  url.searchParams.set("limit", "5");

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);

  const results = (await res.json()) as Array<{ lat: string; lon: string }>;
  for (const r of results) {
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    if (lat >= BBOX.south && lat <= BBOX.north && lng >= BBOX.west && lng <= BBOX.east)
      return { lat, lng };
  }
  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const adapter = new PrismaPg({ connectionString: CONNECTION! });
  const prisma = new PrismaClient({ adapter });

  try {
    // ── Clear existing MRT + LRT ──────────────────────────────────────────────
    console.log("Clearing existing MRT + LRT data...");
    await prisma.transitRoute.deleteMany({ where: { type: { in: ["mrt", "lrt"] } } });
    await prisma.transitStop.deleteMany({ where: { type: { in: ["mrt", "lrt"] } } });

    // ── MRT Jakarta (hardcoded) ───────────────────────────────────────────────
    console.log(`\nInserting MRT Jakarta (${MRT_STATIONS.length} stations, hardcoded)...`);
    await prisma.transitStop.createMany({
      data: MRT_STATIONS.map((s) => ({
        id: s.id,
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        type: "mrt",
        parentId: null,
      })),
    });
    await prisma.transitRoute.create({
      data: {
        id: "mrt-ns",
        shortName: "MRT NS",
        longName: "MRT Jakarta North–South Line (Lebak Bulus ↔ Kota)",
        type: "mrt",
        stopIds: MRT_STATIONS.map((s) => s.id),
      },
    });
    console.log(`  Done — 1 route, ${MRT_STATIONS.length} stops`);

    // ── LRT Jakarta (hardcoded) ───────────────────────────────────────────────
    console.log(`\nInserting LRT Jakarta (${LRT_JAKARTA_STATIONS.length} stations, hardcoded)...`);
    await prisma.transitStop.createMany({
      data: LRT_JAKARTA_STATIONS.map((s) => ({
        id: s.id,
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        type: "lrt",
        parentId: null,
      })),
    });
    await prisma.transitRoute.create({
      data: {
        id: "lrt-jakarta",
        shortName: "LRT JKT",
        longName: "LRT Jakarta (Pegangsaan Dua ↔ Velodrome)",
        type: "lrt",
        stopIds: LRT_JAKARTA_STATIONS.map((s) => s.id),
      },
    });
    console.log(`  Done — 1 route, ${LRT_JAKARTA_STATIONS.length} stops`);

    // ── LRT Jabodebek (Nominatim) ─────────────────────────────────────────────
    console.log(`\nGeocoding LRT Jabodebek via Nominatim (${LRT_JABODEBEK_STATIONS.length} stations)...`);
    const jabodebekStops: { id: string; name: string; lat: number; lng: number }[] = [];
    const unmatched: string[] = [];

    for (let i = 0; i < LRT_JABODEBEK_STATIONS.length; i++) {
      const s = LRT_JABODEBEK_STATIONS[i];
      process.stdout.write(`\r  [${String(i + 1).padStart(2)}/${LRT_JABODEBEK_STATIONS.length}] ${s.name.padEnd(24)}`);

      const coords = JABODEBEK_OVERRIDES[s.name] ?? (await geocode(s.query));
      if (coords) {
        jabodebekStops.push({ id: s.id, name: s.name, ...coords });
      } else {
        unmatched.push(s.name);
      }

      if (i < LRT_JABODEBEK_STATIONS.length - 1) await sleep(1100);
    }
    console.log();

    if (jabodebekStops.length > 0) {
      await prisma.transitStop.createMany({
        data: jabodebekStops.map((s) => ({
          id: s.id, name: s.name, lat: s.lat, lng: s.lng,
          type: "lrt", parentId: null,
        })),
      });

      // Build two route records (Cibubur branch + Bekasi branch, both ending at Dukuh Atas)
      const cibubur = ["lrtb_hjm","lrtb_crc","lrtb_kpr","lrtb_tmn","lrtb_cwg","lrtb_ckk","lrtb_clw","lrtb_dka","lrtb_stb","lrtb_rsd","lrtb_kng","lrtb_pcr"];
      const bekasi  = ["lrtb_jtm","lrtb_bkb","lrtb_ck2","lrtb_ck1","lrtb_jtb","lrtb_hlm","lrtb_cwg","lrtb_ckk","lrtb_clw","lrtb_dka","lrtb_stb","lrtb_rsd","lrtb_kng","lrtb_pcr"];
      const insertedIds = new Set(jabodebekStops.map((s) => s.id));

      await prisma.transitRoute.createMany({
        data: [
          {
            id: "lrt-jabodebek-cibubur",
            shortName: "LRT Jabodebek Cibubur",
            longName: "LRT Jabodebek — Harjamukti ↔ Dukuh Atas",
            type: "lrt",
            stopIds: cibubur.filter((id) => insertedIds.has(id)),
          },
          {
            id: "lrt-jabodebek-bekasi",
            shortName: "LRT Jabodebek Bekasi",
            longName: "LRT Jabodebek — Jatimulya ↔ Dukuh Atas",
            type: "lrt",
            stopIds: bekasi.filter((id) => insertedIds.has(id)),
          },
        ],
      });
    }

    console.log(`  Done — 2 routes, ${jabodebekStops.length} stops`);
    if (unmatched.length > 0) {
      console.log(`  Unmatched: ${unmatched.join(", ")}`);
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    const totalStops = MRT_STATIONS.length + LRT_JAKARTA_STATIONS.length + jabodebekStops.length;
    console.log("\nDone.");
    console.log(`  MRT stops  → ${MRT_STATIONS.length}`);
    console.log(`  LRT stops  → ${LRT_JAKARTA_STATIONS.length + jabodebekStops.length} (${LRT_JAKARTA_STATIONS.length} LRT Jkt + ${jabodebekStops.length} Jabodebek)`);
    console.log(`  Total      → ${totalStops}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
