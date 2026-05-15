/**
 * Hardcoded KRL Commuter Line Jabodetabek import.
 * Defines all 6 operating routes + every station with verified coordinates.
 * Stations shared between lines use the same ID — the routing algorithm uses
 * this to detect transfer opportunities (e.g. Manggarai is shared by 3 lines).
 *
 * Lines covered:
 *   1. Lin Bogor       — Bogor ↔ Jakarta Kota (23 stops)
 *   2. Lin Bekasi      — Cikarang ↔ Jakarta Kota (18 stops, 8 shared with Bogor)
 *   3. Lin Nambo       — Citayam ↔ Nambo branch (4 stops)
 *   4. Lin Rangkasbitung — Rangkasbitung ↔ Tanah Abang (15 stops)
 *   5. Lin Tangerang   — Tangerang ↔ Duri (11 stops)
 *   6. Lin Tanjung Priok — Jakarta Kota ↔ Tanjung Priok (4 stops)
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const CONNECTION = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!CONNECTION) {
  console.error("DIRECT_URL or DATABASE_URL required in .env");
  process.exit(1);
}

type Station = { id: string; name: string; lat: number; lng: number };

// ── Stations ──────────────────────────────────────────────────────────────────
// Each entry is unique. Stations shared across lines have ONE definition here.

// Shared trunk: Manggarai → Jakarta Kota (used by Bogor + Bekasi lines)
const TRUNK_MRI_TO_JKT: Station[] = [
  { id: "krl_mri",  name: "Manggarai",        lat: -6.2143, lng: 106.8506 },
  { id: "krl_cki",  name: "Cikini",            lat: -6.1984, lng: 106.8445 },
  { id: "krl_gdd",  name: "Gondangdia",        lat: -6.1944, lng: 106.8360 },
  { id: "krl_jud",  name: "Juanda",            lat: -6.1658, lng: 106.8299 },
  { id: "krl_swb",  name: "Sawah Besar",       lat: -6.1547, lng: 106.8198 },
  { id: "krl_mgb",  name: "Mangga Besar",      lat: -6.1467, lng: 106.8240 },
  { id: "krl_jyk",  name: "Jayakarta",         lat: -6.1389, lng: 106.8157 },
  { id: "krl_jkt",  name: "Jakarta Kota",      lat: -6.1378, lng: 106.8135 },
];

// Lin Bogor — Bogor to Manggarai (exclusive segment, south to north)
const BOGOR_TO_MRI: Station[] = [
  { id: "krl_boo",  name: "Bogor",             lat: -6.5952, lng: 106.7977 },
  { id: "krl_clt",  name: "Cilebut",           lat: -6.5334, lng: 106.8254 },
  { id: "krl_bjg",  name: "Bojong Gede",       lat: -6.4822, lng: 106.8138 },
  { id: "krl_cty",  name: "Citayam",           lat: -6.4367, lng: 106.8242 },
  { id: "krl_dpk",  name: "Depok",             lat: -6.3920, lng: 106.8286 },
  { id: "krl_dpb",  name: "Depok Baru",        lat: -6.3699, lng: 106.8285 },
  { id: "krl_poc",  name: "Pondok Cina",       lat: -6.3680, lng: 106.8333 },
  { id: "krl_ui",   name: "Universitas Indonesia", lat: -6.3589, lng: 106.8329 },
  { id: "krl_lag",  name: "Lenteng Agung",     lat: -6.3205, lng: 106.8309 },
  { id: "krl_tjb",  name: "Tanjung Barat",     lat: -6.3075, lng: 106.8350 },
  { id: "krl_psm",  name: "Pasar Minggu",      lat: -6.2868, lng: 106.8434 },
  { id: "krl_pmb",  name: "Pasar Minggu Baru", lat: -6.2795, lng: 106.8430 },
  { id: "krl_dkb",  name: "Duren Kalibata",    lat: -6.2624, lng: 106.8539 },
  { id: "krl_cwg",  name: "Cawang",            lat: -6.2577, lng: 106.8679 },
  { id: "krl_tbt",  name: "Tebet",             lat: -6.2334, lng: 106.8605 },
];

// Lin Bekasi — Cikarang to Manggarai (exclusive segment, east to west)
const BEKASI_TO_MRI: Station[] = [
  { id: "krl_ckr",  name: "Cikarang",          lat: -6.2511, lng: 107.1478 },
  { id: "krl_tmb",  name: "Tambun",            lat: -6.2434, lng: 107.0858 },
  { id: "krl_cbt",  name: "Cibitung",          lat: -6.2400, lng: 107.0480 },
  { id: "krl_bks",  name: "Bekasi",            lat: -6.2357, lng: 106.9921 },
  { id: "krl_krn",  name: "Kranji",            lat: -6.2536, lng: 106.9652 },
  { id: "krl_ckng", name: "Cakung",            lat: -6.1921, lng: 106.9350 },
  { id: "krl_klb",  name: "Klender Baru",      lat: -6.2130, lng: 106.9230 },
  { id: "krl_bur",  name: "Buaran",            lat: -6.2184, lng: 106.9099 },
  { id: "krl_kld",  name: "Klender",           lat: -6.2235, lng: 106.9010 },
  { id: "krl_jng",  name: "Jatinegara",        lat: -6.2145, lng: 106.8697 },
];

// Lin Nambo — branch from Citayam (krl_cty is in BOGOR_TO_MRI, shared)
const NAMBO_BRANCH: Station[] = [
  // krl_cty (Citayam) already defined in BOGOR_TO_MRI — shared branch point
  { id: "krl_pjt",  name: "Pondok Jati",       lat: -6.4157, lng: 106.8684 },
  { id: "krl_stu",  name: "Setu",              lat: -6.3836, lng: 106.8821 },
  { id: "krl_nbo",  name: "Nambo",             lat: -6.3706, lng: 106.9060 },
];

// Lin Rangkasbitung — Rangkasbitung to Tanah Abang
const RANGKASBITUNG_STOPS: Station[] = [
  { id: "krl_rks",  name: "Rangkasbitung",     lat: -6.3569, lng: 106.2518 },
  { id: "krl_ctr",  name: "Citeras",           lat: -6.3020, lng: 106.3063 },
  { id: "krl_mja",  name: "Maja",              lat: -6.2717, lng: 106.3617 },
  { id: "krl_tnj",  name: "Tenjo",             lat: -6.2267, lng: 106.4785 },
  { id: "krl_tgr",  name: "Tigaraksa",         lat: -6.2612, lng: 106.5261 },
  { id: "krl_csk",  name: "Cisauk",            lat: -6.2736, lng: 106.5803 },
  { id: "krl_ccy",  name: "Cicayur",           lat: -6.2612, lng: 106.5985 },
  { id: "krl_spg",  name: "Serpong",           lat: -6.3175, lng: 106.6695 },
  { id: "krl_rwbt", name: "Rawabuntu",         lat: -6.3189, lng: 106.6843 },
  { id: "krl_sdm",  name: "Sudimara",          lat: -6.2944, lng: 106.7060 },
  { id: "krl_jmg",  name: "Jurangmangu",       lat: -6.2653, lng: 106.7219 },
  { id: "krl_psgg", name: "Pesanggrahan",      lat: -6.2485, lng: 106.7432 },
  { id: "krl_kby",  name: "Kebayoran",         lat: -6.2350, lng: 106.7620 },
  { id: "krl_plm",  name: "Palmerah",          lat: -6.2015, lng: 106.7952 },
  { id: "krl_tab",  name: "Tanah Abang",       lat: -6.1966, lng: 106.8136 },
];

// Lin Tangerang — Tangerang to Duri
const TANGERANG_STOPS: Station[] = [
  { id: "krl_tan",  name: "Tangerang",         lat: -6.1783, lng: 106.6358 },
  { id: "krl_tth",  name: "Tanah Tinggi",      lat: -6.1897, lng: 106.6445 },
  { id: "krl_bcp",  name: "Batu Ceper",        lat: -6.1837, lng: 106.6602 },
  { id: "krl_por",  name: "Poris",             lat: -6.1774, lng: 106.6789 },
  { id: "krl_kldr", name: "Kalideres",         lat: -6.1612, lng: 106.7025 },
  { id: "krl_rwby", name: "Rawa Buaya",        lat: -6.1604, lng: 106.7277 },
  { id: "krl_bjdi", name: "Bojong Indah",      lat: -6.1626, lng: 106.7413 },
  { id: "krl_tmk",  name: "Taman Kota",        lat: -6.1689, lng: 106.7506 },
  { id: "krl_psg",  name: "Pesing",            lat: -6.1740, lng: 106.7669 },
  { id: "krl_grl",  name: "Grogol",            lat: -6.1736, lng: 106.7920 },
  { id: "krl_dri",  name: "Duri",              lat: -6.1702, lng: 106.7939 },
];

// Lin Tanjung Priok — Jakarta Kota to Tanjung Priok
// krl_jkt (Jakarta Kota) shared from trunk
const TANJUNG_PRIOK_UNIQUE: Station[] = [
  { id: "krl_kpb",  name: "Kampung Bandan",    lat: -6.1265, lng: 106.8251 },
  { id: "krl_acl",  name: "Ancol",             lat: -6.1129, lng: 106.8459 },
  { id: "krl_tnp",  name: "Tanjung Priok",     lat: -6.1075, lng: 106.8817 },
];

// ── Route sequences (stop ID arrays, direction: terminus A → terminus B) ──────

// KRL fare: Rp 3.000 base (0-25 km) + Rp 1.000 per 10 km thereafter
// Frequency: 10-20 min peak, 20-30 min off-peak
// Operating hours: 04:30–23:30 (varies ±30 min by station)
const KRL_COMMON = {
  fareNote: "Rp 3.000 (0–25 km) + Rp 1.000 / 10 km berikutnya — tap KMT/e-money",
  operatingHours: "04:30–23:30",
  color: "#E91E8C",
};

const ROUTES = [
  {
    id:        "krl-bogor",
    shortName: "KRL Lin Bogor",
    longName:  "KRL Commuter Line Bogor — Bogor ↔ Jakarta Kota",
    stopIds:   [
      ...BOGOR_TO_MRI.map((s) => s.id),
      ...TRUNK_MRI_TO_JKT.map((s) => s.id),
    ],
    fareMin: 3000, fareMax: 8500, frequency: 10,
    ...KRL_COMMON,
  },
  {
    id:        "krl-bekasi",
    shortName: "KRL Lin Bekasi",
    longName:  "KRL Commuter Line Bekasi — Cikarang ↔ Jakarta Kota",
    stopIds:   [
      ...BEKASI_TO_MRI.map((s) => s.id),
      ...TRUNK_MRI_TO_JKT.map((s) => s.id),
    ],
    fareMin: 3000, fareMax: 8500, frequency: 10,
    ...KRL_COMMON,
  },
  {
    id:        "krl-nambo",
    shortName: "KRL Lin Nambo",
    longName:  "KRL Commuter Line Nambo — Citayam ↔ Nambo",
    stopIds:   ["krl_cty", ...NAMBO_BRANCH.map((s) => s.id)],
    fareMin: 3000, fareMax: 4000, frequency: 30,
    ...KRL_COMMON,
  },
  {
    id:        "krl-rangkasbitung",
    shortName: "KRL Lin Rangkasbitung",
    longName:  "KRL Commuter Line Rangkasbitung — Rangkasbitung ↔ Tanah Abang",
    stopIds:   RANGKASBITUNG_STOPS.map((s) => s.id),
    fareMin: 3000, fareMax: 12000, frequency: 20,
    ...KRL_COMMON,
  },
  {
    id:        "krl-tangerang",
    shortName: "KRL Lin Tangerang",
    longName:  "KRL Commuter Line Tangerang — Tangerang ↔ Duri",
    stopIds:   TANGERANG_STOPS.map((s) => s.id),
    fareMin: 3000, fareMax: 5000, frequency: 15,
    ...KRL_COMMON,
  },
  {
    id:        "krl-tanjungpriok",
    shortName: "KRL Lin Tanjung Priok",
    longName:  "KRL Commuter Line Tanjung Priok — Jakarta Kota ↔ Tanjung Priok",
    stopIds:   ["krl_jkt", ...TANJUNG_PRIOK_UNIQUE.map((s) => s.id)],
    fareMin: 3000, fareMax: 3000, frequency: 30,
    ...KRL_COMMON,
  },
];

// All unique stops across all lines (deduplicated by id)
const ALL_STOPS_MAP = new Map<string, Station>();
for (const s of [
  ...TRUNK_MRI_TO_JKT,
  ...BOGOR_TO_MRI,
  ...BEKASI_TO_MRI,
  ...NAMBO_BRANCH,
  ...RANGKASBITUNG_STOPS,
  ...TANGERANG_STOPS,
  ...TANJUNG_PRIOK_UNIQUE,
]) {
  ALL_STOPS_MAP.set(s.id, s);
}
const ALL_STOPS = Array.from(ALL_STOPS_MAP.values());

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const adapter = new PrismaPg({ connectionString: CONNECTION! });
  const prisma = new PrismaClient({ adapter });

  try {
    console.log("Clearing existing KRL data...");
    await prisma.transitRoute.deleteMany({ where: { type: "krl" } });
    await prisma.transitStop.deleteMany({ where: { type: "krl" } });

    console.log(`Inserting ${ALL_STOPS.length} stops...`);
    await prisma.transitStop.createMany({
      data: ALL_STOPS.map((s) => ({
        id: s.id, name: s.name, lat: s.lat, lng: s.lng, type: "krl", parentId: null,
      })),
      skipDuplicates: true,
    });

    console.log(`Inserting ${ROUTES.length} routes...`);
    await prisma.transitRoute.createMany({
      data: ROUTES.map((r) => ({
        id: r.id, shortName: r.shortName, longName: r.longName,
        type: "krl", stopIds: r.stopIds,
        fareMin: r.fareMin, fareMax: r.fareMax, fareNote: r.fareNote,
        operatingHours: r.operatingHours, frequency: r.frequency, color: r.color,
      })),
    });

    console.log("\nDone.");
    for (const r of ROUTES) {
      console.log(`  ${r.shortName.padEnd(28)} — ${r.stopIds.length} stops`);
    }
    console.log(`  Total unique stops: ${ALL_STOPS.length}`);
    console.log(`  Total routes:       ${ROUTES.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
