import type { Point } from "@/lib/core/router";
import type { Scenario } from "@/lib/core/scenarios";

// Ready-made test cases: real Jakarta trips, each set up to show one
// behaviour of the router. One tap sets the places, time, weather and β.

export interface Preset {
  id: string;
  emoji: string;
  name: { en: string; id: string };
  /** what to look for */
  check: { en: string; id: string };
  from: Point;
  to: Point;
  /** Jakarta time; weekday = move to the next Mon–Fri */
  at: { h: number; m: number; weekday?: boolean };
  scenario: Scenario;
  beta: number;
  moto?: "ojek" | "own" | "none";
  vot?: number;
  maxOjek?: number;
}

const P = (lat: number, lng: number, name: string): Point => ({
  lat,
  lng,
  name,
});

// No halte or station within walking range, so the router sends you by ojek
// to a corridor 6 halte and on by TransJakarta 6A. Found by running the
// planner over a grid of origins; on weekdays at 08.00 and 17.30 it picks
// ojek → 6A under every scenario, so one trip shows every part of the model.
const CINERE = P(-6.316, 106.798, "Pangkalan Jati, Cinere");
const KUNINGAN = P(-6.2361, 106.8268, "Gatot Subroto, Kuningan");

export const PRESETS: Preset[] = [
  {
    id: "sudden",
    emoji: "⚡",
    name: { en: "Sudden downpour", id: "Hujan deras tiba-tiba" },
    check: {
      en: "Ojek to the halte, then TJ 6A. The storm isn't in the forecast: no alert; start the trip and you'll be asked if it's raining",
      id: "Ojek ke halte, lalu TJ 6A. Badai tak ada di prakiraan: tanpa peringatan; mulai perjalanan dan kamu akan ditanya apakah hujan",
    },
    from: CINERE,
    to: KUNINGAN,
    at: { h: 8, m: 0, weekday: true },
    scenario: "sudden-downpour",
    beta: 1,
  },
  {
    id: "passing",
    emoji: "🌦️",
    name: { en: "Shower passing by", id: "Hujan lewat" },
    check: {
      en: "A narrow cell crosses the route: the ojek rides into it, the bus sits it out",
      id: "Sel hujan sempit melintas: ojek menerobosnya, bus melewatinya",
    },
    from: CINERE,
    to: KUNINGAN,
    at: { h: 17, m: 30, weekday: true },
    scenario: "passing-shower",
    beta: 1,
  },
  {
    id: "heavy-first-mile",
    emoji: "🌧️",
    name: { en: "Heavy rain all over", id: "Hujan lebat di mana-mana" },
    check: {
      en: "Rain everywhere: only the short ojek to the halte is wet",
      id: "Hujan di mana-mana: hanya ojek pendek ke halte yang basah",
    },
    from: CINERE,
    to: KUNINGAN,
    at: { h: 17, m: 30, weekday: true },
    scenario: "heavy-everywhere",
    beta: 1,
  },
  {
    id: "dry-first-mile",
    emoji: "☀️",
    name: { en: "Dry day, same trip", id: "Hari kering, rute sama" },
    check: {
      en: "Live forecast: compare with the storms to see what rain changes",
      id: "Prakiraan langsung: bandingkan dengan badai untuk melihat efek hujan",
    },
    from: CINERE,
    to: KUNINGAN,
    at: { h: 8, m: 0, weekday: true },
    scenario: "live",
    beta: 1,
  },
  {
    id: "rush-krl",
    emoji: "🚆",
    name: { en: "Rush-hour storm commute", id: "Badai jam berangkat kerja" },
    check: {
      en: "Storm on the way in: does the train beat the ojek?",
      id: "Badai di jalan: apakah kereta mengalahkan ojek?",
    },
    from: P(-6.2366, 106.9993, "Bekasi"),
    to: P(-6.2025, 106.8233, "Sudirman"),
    at: { h: 7, m: 30, weekday: true },
    scenario: "storm-coming",
    beta: 1,
  },
  {
    id: "ojek-rain",
    emoji: "🛵",
    name: {
      en: "Ojek vs bus in heavy rain",
      id: "Ojek vs bus saat hujan lebat",
    },
    check: {
      en: "At β = 4 the open-air ojek should lose",
      id: "Pada β = 4 ojek terbuka seharusnya kalah",
    },
    from: P(-6.2443, 106.8006, "Blok M"),
    to: P(-6.1754, 106.8272, "Monas"),
    at: { h: 17, m: 30, weekday: true },
    scenario: "heavy-everywhere",
    beta: 4,
  },
  {
    id: "parity",
    emoji: "⚖️",
    name: { en: "Dry weather, β = 0", id: "Cuaca kering, β = 0" },
    check: {
      en: "Must equal the fastest route exactly (safe by construction)",
      id: "Harus sama persis dengan rute tercepat",
    },
    from: P(-6.2894, 106.7745, "Lebak Bulus"),
    to: P(-6.1932, 106.823, "Bundaran HI"),
    at: { h: 12, m: 0, weekday: true },
    scenario: "live",
    beta: 0,
  },
  {
    id: "dest-storm",
    emoji: "📍",
    name: { en: "Storm waiting at the end", id: "Badai menunggu di tujuan" },
    check: {
      en: "Rain read at the minute you arrive, not at departure",
      id: "Hujan dibaca saat kamu tiba, bukan saat berangkat",
    },
    from: P(-6.1376, 106.8146, "Kota"),
    to: P(-6.2186, 106.8027, "Senayan"),
    at: { h: 17, m: 30, weekday: true },
    scenario: "storm-at-destination",
    beta: 2,
  },
  {
    id: "shower",
    emoji: "⏱️",
    name: { en: "Passing shower", id: "Hujan sebentar" },
    check: {
      en: "Try “Leave later”: waiting 15–30 min may stay dry",
      id: "Coba “Berangkat nanti”: menunggu 15–30 mnt bisa tetap kering",
    },
    from: P(-6.2006, 106.7826, "Binus Kemanggisan"),
    to: P(-6.2006, 106.8081, "Petamburan"),
    at: { h: 12, m: 0, weekday: true },
    scenario: "passing-shower",
    beta: 1,
  },
  {
    id: "drizzle",
    emoji: "🌦️",
    name: {
      en: "Drizzle at a roadside stop",
      id: "Gerimis di halte pinggir jalan",
    },
    check: {
      en: "Light rain: φ stays small, little should change",
      id: "Hujan ringan: φ kecil, hampir tidak berubah",
    },
    from: P(-6.1103, 106.8812, "Tanjung Priok"),
    to: P(-6.2253, 106.8667, "Kampung Melayu"),
    at: { h: 7, m: 30, weekday: true },
    scenario: "drizzle",
    beta: 1,
  },
  {
    id: "extreme",
    emoji: "🚨",
    name: { en: "Extreme rain alert", id: "Peringatan hujan ekstrem" },
    check: {
      en: "Play the trip: the red emergency banner should appear",
      id: "Putar perjalanan: banner darurat merah harus muncul",
    },
    from: P(-6.2428, 106.8586, "Cawang"),
    to: P(-6.1658, 106.8205, "Harmoni"),
    at: { h: 17, m: 30, weekday: true },
    scenario: "extreme",
    beta: 2,
  },
  {
    id: "budget",
    emoji: "💸",
    name: { en: "Ojek over budget", id: "Ojek melebihi anggaran" },
    check: {
      en: "Cap Rp25.000: a long ojek is dropped, ride the commuter",
      id: "Batas Rp25.000: ojek jauh dicoret, naik angkutan umum",
    },
    from: P(-6.1556, 106.7055, "Kalideres"),
    to: P(-6.3105, 106.8203, "Ragunan"),
    at: { h: 12, m: 0, weekday: true },
    scenario: "heavy-everywhere",
    beta: 1,
    vot: 500,
    maxOjek: 25_000,
  },
  {
    id: "airport",
    emoji: "✈️",
    name: { en: "Airport train in a storm", id: "Kereta bandara saat badai" },
    check: {
      en: "Storm over the start: sheltered rail vs open walk",
      id: "Badai di awal: rel terlindung vs jalan terbuka",
    },
    from: P(-6.1256, 106.6559, "Soekarno-Hatta"),
    to: P(-6.2017, 106.8211, "BNI City"),
    at: { h: 7, m: 30, weekday: true },
    scenario: "storm-over-start",
    beta: 1,
  },
  {
    id: "night",
    emoji: "🌙",
    name: { en: "Late night, storm leaving", id: "Larut malam, badai menjauh" },
    check: {
      en: "Fewer lines run; the storm is moving away from you",
      id: "Lebih sedikit rute; badai menjauh darimu",
    },
    from: P(-6.1832, 106.909, "Pulo Gadung"),
    to: P(-6.1672, 106.7895, "Grogol"),
    at: { h: 23, m: 30 },
    scenario: "storm-leaving",
    beta: 1,
  },
  {
    id: "long-rail",
    emoji: "🛤️",
    name: { en: "Long KRL trip", id: "Perjalanan KRL jauh" },
    check: {
      en: "Mostly indoors: rain matters only at the ends",
      id: "Sebagian besar di dalam: hujan hanya penting di ujung",
    },
    from: P(-6.5955, 106.7906, "Bogor"),
    to: P(-6.21, 106.8502, "Manggarai"),
    at: { h: 7, m: 30, weekday: true },
    scenario: "storm-coming",
    beta: 1,
  },
];

/** The trip demos on the home menu, in order. */
export const HOME_DEMOS = [
  "sudden",
  "passing",
  "heavy-first-mile",
  "rush-krl",
  "dest-storm",
  "dry-first-mile",
]
  .map((id) => PRESETS.find((p) => p.id === id))
  .filter((p): p is Preset => !!p);

/** The app state a preset sets: places, time, weather and β, then plan. */
export function presetState(p: Preset) {
  // test settings apply to this session only; saved preferences stay
  return {
    from: p.from,
    to: p.to,
    result: null,
    scenario: p.scenario,
    beta: p.beta,
    moto: p.moto ?? ("ojek" as const),
    vot: p.vot ?? 500,
    maxOjek: p.maxOjek ?? 0,
    depart: presetTime(p.at),
    trip: null,
    sheet: "results" as const,
  };
}

/** Next occurrence of hh:mm in Jakarta time (UTC+7), optionally on a weekday. */
export function presetTime(at: Preset["at"], now = Date.now()): number {
  const day = 86_400_000;
  const off = 7 * 3_600_000;
  const startOfDay = Math.floor((now + off) / day) * day - off;
  let t = startOfDay + (at.h * 60 + at.m) * 60_000;
  if (t < now) t += day;
  if (at.weekday)
    // Mon–Fri in Jakarta: getUTCDay of the shifted time, 0 = Sunday
    while ([0, 6].includes(new Date(t + off).getUTCDay())) t += day;
  return t;
}
