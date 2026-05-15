"use client";

import { useState, useMemo } from "react";

// ─── Route specs ──────────────────────────────────────────────────────────────

interface RouteSpec {
  id: string;
  origin: string; oLat: number; oLng: number;
  dest: string; dLat: number; dLng: number;
  distKm: number;
  transitMode: string;
  transitWalkM: number;
  viableModes: string[];
}

const ROUTES: RouteSpec[] = [
  { id:"R01", origin:"Blok M",        oLat:-6.2442, oLng:106.7973, dest:"Sudirman",         dLat:-6.2087, dLng:106.8182, distKm:8.5,  transitMode:"mrt",         transitWalkM:700, viableModes:["motorcycle","car_private","car_online","ojek","bicycle","transjakarta","mrt"] },
  { id:"R02", origin:"Lebak Bulus",   oLat:-6.3194, oLng:106.7741, dest:"Dukuh Atas",       dLat:-6.2014, dLng:106.8229, distKm:12.0, transitMode:"mrt",         transitWalkM:400, viableModes:["motorcycle","car_private","car_online","ojek","bicycle","mrt"] },
  { id:"R03", origin:"Bundaran HI",   oLat:-6.1944, oLng:106.8229, dest:"Kelapa Gading",    dLat:-6.1684, dLng:106.9036, distKm:14.2, transitMode:"transjakarta",transitWalkM:550, viableModes:["motorcycle","car_private","car_online","ojek","transjakarta"] },
  { id:"R04", origin:"Tebet",         oLat:-6.2338, oLng:106.8555, dest:"Monas",            dLat:-6.1753, dLng:106.8272, distKm:9.1,  transitMode:"transjakarta",transitWalkM:480, viableModes:["motorcycle","car_private","car_online","ojek","bicycle","transjakarta"] },
  { id:"R05", origin:"Tanjung Priok", oLat:-6.1089, oLng:106.8791, dest:"Kota Tua",         dLat:-6.1378, dLng:106.8135, distKm:6.3,  transitMode:"transjakarta",transitWalkM:350, viableModes:["motorcycle","car_private","ojek","bicycle","transjakarta"] },
  { id:"R06", origin:"Kemayoran",     oLat:-6.1595, oLng:106.8473, dest:"Sudirman",         dLat:-6.2087, dLng:106.8182, distKm:10.8, transitMode:"transjakarta",transitWalkM:600, viableModes:["motorcycle","car_private","car_online","ojek","transjakarta"] },
  { id:"R07", origin:"Cilandak",      oLat:-6.2884, oLng:106.7994, dest:"Blok M",           dLat:-6.2442, dLng:106.7973, distKm:5.1,  transitMode:"transjakarta",transitWalkM:280, viableModes:["motorcycle","car_private","ojek","bicycle","walking","transjakarta"] },
  { id:"R08", origin:"Grogol",        oLat:-6.1655, oLng:106.7955, dest:"Bundaran HI",      dLat:-6.1944, dLng:106.8229, distKm:7.2,  transitMode:"transjakarta",transitWalkM:420, viableModes:["motorcycle","car_private","ojek","bicycle","transjakarta"] },
  { id:"R09", origin:"Cengkareng",    oLat:-6.1352, oLng:106.7104, dest:"Sudirman",         dLat:-6.2087, dLng:106.8182, distKm:22.4, transitMode:"transjakarta",transitWalkM:750, viableModes:["car_private","car_online","transjakarta"] },
  { id:"R10", origin:"Bekasi Timur",  oLat:-6.2349, oLng:106.9896, dest:"Kota Tua",         dLat:-6.1378, dLng:106.8135, distKm:29.8, transitMode:"krl",         transitWalkM:500, viableModes:["car_private","car_online","krl"] },
  { id:"R11", origin:"Manggarai",     oLat:-6.2144, oLng:106.8553, dest:"Gambir",           dLat:-6.1775, dLng:106.8310, distKm:2.1,  transitMode:"transjakarta",transitWalkM:200, viableModes:["motorcycle","car_private","ojek","bicycle","walking","transjakarta"] },
  { id:"R12", origin:"Tangerang",     oLat:-6.1783, oLng:106.6319, dest:"Sudirman",         dLat:-6.2087, dLng:106.8182, distKm:24.5, transitMode:"transjakarta",transitWalkM:600, viableModes:["car_private","car_online","transjakarta"] },
];

// ─── Mode profiles ────────────────────────────────────────────────────────────

interface ModeProfile {
  speedKmh: number;
  fuelCostPerKm: number;
  baseFare: number;
  farePerKm: number;
  co2PerKm: number;
  comfortBase: number;
  openAirPct: number;
  waitMin: number;
  label: string;
  category: string;
  isTransit: boolean;
}

const MODE_PROFILES: Record<string, ModeProfile> = {
  motorcycle:   { speedKmh:30,  fuelCostPerKm:3500, baseFare:0,    farePerKm:0,    co2PerKm:65,  comfortBase:4, openAirPct:100, waitMin:0,  label:"Motorcycle",    category:"private",       isTransit:false },
  ojek:         { speedKmh:28,  fuelCostPerKm:0,    baseFare:4000, farePerKm:2500, co2PerKm:65,  comfortBase:5, openAirPct:100, waitMin:3,  label:"Ojek Online",   category:"ride_hail",     isTransit:false },
  car_private:  { speedKmh:22,  fuelCostPerKm:2400, baseFare:0,    farePerKm:0,    co2PerKm:150, comfortBase:8, openAirPct:0,   waitMin:0,  label:"Car (Private)", category:"private",       isTransit:false },
  car_online:   { speedKmh:20,  fuelCostPerKm:0,    baseFare:5000, farePerKm:2500, co2PerKm:150, comfortBase:8, openAirPct:0,   waitMin:5,  label:"Car Online",    category:"ride_hail",     isTransit:false },
  bicycle:      { speedKmh:14,  fuelCostPerKm:0,    baseFare:0,    farePerKm:0,    co2PerKm:0,   comfortBase:6, openAirPct:100, waitMin:0,  label:"Bicycle",       category:"non_motorized", isTransit:false },
  walking:      { speedKmh:4.5, fuelCostPerKm:0,    baseFare:0,    farePerKm:0,    co2PerKm:0,   comfortBase:7, openAirPct:100, waitMin:0,  label:"Walking",       category:"non_motorized", isTransit:false },
  transjakarta: { speedKmh:20,  fuelCostPerKm:0,    baseFare:3500, farePerKm:0,    co2PerKm:30,  comfortBase:6, openAirPct:10,  waitMin:5,  label:"TransJakarta",  category:"public_transit", isTransit:true },
  mrt:          { speedKmh:50,  fuelCostPerKm:0,    baseFare:4000, farePerKm:1000, co2PerKm:10,  comfortBase:9, openAirPct:5,   waitMin:3,  label:"MRT Jakarta",   category:"public_transit", isTransit:true },
  lrt:          { speedKmh:40,  fuelCostPerKm:0,    baseFare:5000, farePerKm:0,    co2PerKm:10,  comfortBase:8, openAirPct:15,  waitMin:5,  label:"LRT Jakarta",   category:"public_transit", isTransit:true },
  krl:          { speedKmh:50,  fuelCostPerKm:0,    baseFare:3000, farePerKm:1000, co2PerKm:10,  comfortBase:6, openAirPct:10,  waitMin:5,  label:"KRL Commuter",  category:"public_transit", isTransit:true },
};

// ─── Weather speed multipliers (PMC8037289 + BPBD 2025) ──────────────────────

const WEATHER_SPEED_MULT: Record<string, Record<string, number>> = {
  motorcycle:   { none:1.00, light:1.05, moderate:1.09, heavy:1.22, extreme:1.50 },
  ojek:         { none:1.00, light:1.05, moderate:1.09, heavy:1.22, extreme:1.50 },
  car_private:  { none:1.00, light:1.03, moderate:1.06, heavy:1.15, extreme:1.35 },
  car_online:   { none:1.00, light:1.03, moderate:1.06, heavy:1.15, extreme:1.35 },
  bicycle:      { none:1.00, light:1.08, moderate:1.15, heavy:1.30, extreme:1.60 },
  walking:      { none:1.00, light:1.05, moderate:1.10, heavy:1.20, extreme:1.40 },
  transjakarta: { none:1.00, light:1.02, moderate:1.05, heavy:1.10, extreme:1.20 },
  mrt:          { none:1.00, light:1.00, moderate:1.00, heavy:1.00, extreme:1.05 },
  lrt:          { none:1.00, light:1.00, moderate:1.00, heavy:1.00, extreme:1.05 },
  krl:          { none:1.00, light:1.00, moderate:1.00, heavy:1.00, extreme:1.10 },
};

// ─── Discomfort base penalties ────────────────────────────────────────────────

const DISCOMFORT_BASE: Record<string, Record<string, number>> = {
  motorcycle:   { none:0, light:12,  moderate:26,   heavy:40, extreme:56  },
  ojek:         { none:0, light:12,  moderate:26,   heavy:40, extreme:56  },
  car_private:  { none:0, light:2.4, moderate:5.2,  heavy:8,  extreme:11.2 },
  car_online:   { none:0, light:2.4, moderate:5.2,  heavy:8,  extreme:11.2 },
  bicycle:      { none:0, light:6,   moderate:13,   heavy:20, extreme:28  },
  walking:      { none:0, light:7.5, moderate:16.3, heavy:25, extreme:35  },
  transjakarta: { none:2, light:2,   moderate:2,    heavy:2,  extreme:2   },
  mrt:          { none:2, light:2,   moderate:2,    heavy:2,  extreme:2   },
  lrt:          { none:3, light:3,   moderate:3,    heavy:3,  extreme:3   },
  krl:          { none:2, light:2,   moderate:2,    heavy:2,  extreme:2   },
};

// ─── Extra wait times under heavy/extreme rain ────────────────────────────────
// ojek: +5 heavy / +10 extreme; car_online: +8 heavy / +15 extreme
// transjakarta: +3 heavy / +5 extreme; mrt/lrt/krl: 0

function extraWait(mode: string, intensity: string): number {
  const heavy: Record<string, number>   = { ojek:5, car_online:8, transjakarta:3 };
  const extreme: Record<string, number> = { ojek:10, car_online:15, transjakarta:5 };
  if (intensity === "heavy")   return heavy[mode]   ?? 0;
  if (intensity === "extreme") return extreme[mode] ?? 0;
  return 0;
}

// ─── Weather constants ────────────────────────────────────────────────────────

const RAINFALL_MM:     Record<string, number> = { none:0,  light:3,  moderate:12, heavy:35, extreme:75 };
const WIND_KMH:        Record<string, number> = { none:7,  light:14, moderate:22, heavy:35, extreme:55 };
const HUMIDITY_PCT:    Record<string, number> = { none:72, light:85, moderate:91, heavy:95, extreme:98 };
const CELL_RADIUS_KM:  Record<string, number> = { none:0,  light:50, moderate:30, heavy:15, extreme:8  };

const INTENSITIES = ["none","light","moderate","heavy","extreme"] as const;
type Intensity = typeof INTENSITIES[number];

// ─── Fare calculation ─────────────────────────────────────────────────────────

function calcFare(mode: string, distKm: number): number {
  const p = MODE_PROFILES[mode];
  if (mode === "mrt") {
    const stops = Math.round(distKm / 1.5);
    return Math.min(4000 + stops * 1000, 14000);
  }
  if (mode === "krl") {
    const band = Math.floor(distKm / 25);
    return 3000 + band * 1000;
  }
  if (p.farePerKm > 0) return Math.round(p.baseFare + p.farePerKm * distKm);
  return p.baseFare;
}

function calcFuelCost(mode: string, distKm: number): number {
  return Math.round(MODE_PROFILES[mode].fuelCostPerKm * distKm);
}

// ─── Walk eta helper ──────────────────────────────────────────────────────────

function walkEtaMin(walkM: number, intensity: string): number {
  const speedMult = WEATHER_SPEED_MULT.walking[intensity];
  return Math.round((walkM / 1000) / (MODE_PROFILES.walking.speedKmh / 60) * speedMult);
}

function walkPenalty(walkM: number, intensity: string): number {
  const base = DISCOMFORT_BASE.walking[intensity];
  return walkM < 500 ? base * 0.5 : base;
}

function comfortRating(mode: string, intensity: string): number {
  const profile = MODE_PROFILES[mode];
  const weatherPenaltyMap: Record<string, number> = { none:0, light:0.5, moderate:1, heavy:2, extreme:3 };
  const isOpenAir = profile.openAirPct > 20;
  const penalty = isOpenAir
    ? weatherPenaltyMap[intensity]
    : weatherPenaltyMap[intensity] * 0.5;
  return Math.max(1, Math.min(10, profile.comfortBase - penalty));
}

function eventRef(intensity: string, routeId: string): string {
  if (intensity === "extreme") return "2025 Jakarta Floods — BNPB/BPBD (2–6 Mar 2025; 90,000+ displaced; 20+ road closures)";
  if (intensity === "heavy" && ["R03","R06","R08","R09"].includes(routeId)) return "BMKG Heavy Rain Advisory — Jakarta (Jan–Mar 2025)";
  if (intensity === "moderate") return "BMKG Wet Season Baseline 2024–2025 (Nov–Mar; avg 2,146mm/year)";
  if (intensity === "light") return "BMKG Daily Observation — Jakarta 2024";
  return "BMKG Dry Season Baseline — Jakarta 2024 (Jun–Sep)";
}

// ─── Dataset row type ─────────────────────────────────────────────────────────

interface DatasetRow {
  id: string;
  route: string;
  mode: string;
  category: string;
  scenario_type: string;
  intensity: string;
  rainfall_mm_h: number;
  wind_kmh: number;
  humidity_pct: number;
  weather_cell_radius_km: number;
  total_eta_min: number;
  walking_eta_min: number;
  transit_eta_min: number;
  wait_time_min: number;
  walking_distance_m: number;
  total_cost_idr: number;
  fare_idr: number;
  fuel_cost_idr: number;
  discomfort_score: number;
  comfort_rating: number;
  weather_exposure_min: number;
  co2_grams: number;
  modal_shift_triggered: boolean;
  composite_score: number;
  data_source: string;
  event_reference: string;
}

// ─── Dataset generator ────────────────────────────────────────────────────────

function buildDataset(): DatasetRow[] {
  const rows: DatasetRow[] = [];

  for (const route of ROUTES) {
    for (const intensity of INTENSITIES) {
      // Generate one row per viable mode
      const modeRows: DatasetRow[] = [];

      for (const mode of route.viableModes) {
        const profile = MODE_PROFILES[mode];
        const speedMult = WEATHER_SPEED_MULT[mode]?.[intensity] ?? 1.0;

        // ETA calculation
        let totalEta: number;
        let walkingEta = 0;
        let transitEta = 0;
        let waitMin = profile.waitMin;

        if (profile.isTransit) {
          // Transit: base transit time + walking at both ends + weather wait
          const baseTransitMin = Math.round((route.distKm / profile.speedKmh) * 60);
          transitEta = Math.round(baseTransitMin * speedMult);
          walkingEta = walkEtaMin(route.transitWalkM, intensity);
          waitMin = profile.waitMin + extraWait(mode, intensity);
          totalEta = transitEta + walkingEta + waitMin;
        } else if (mode === "walking") {
          walkingEta = Math.round((route.distKm / profile.speedKmh) * 60 * speedMult);
          totalEta = walkingEta;
          waitMin = 0;
        } else {
          // Private/ride-hail
          const baseDriveMin = Math.round((route.distKm / profile.speedKmh) * 60);
          const driveMin = Math.round(baseDriveMin * speedMult);
          waitMin = profile.waitMin + extraWait(mode, intensity);
          totalEta = driveMin + waitMin;
        }

        // Cost
        const fareIdr = calcFare(mode, route.distKm);
        const fuelIdr = calcFuelCost(mode, route.distKm);
        const totalCost = fareIdr + fuelIdr;

        // Discomfort
        let discomfort: number;
        if (profile.isTransit) {
          discomfort = Math.round((DISCOMFORT_BASE[mode][intensity] + walkPenalty(route.transitWalkM, intensity)) * 10) / 10;
        } else {
          discomfort = DISCOMFORT_BASE[mode][intensity];
        }

        // Comfort rating
        const comfort = comfortRating(mode, intensity);

        // CO2
        const co2Grams = Math.round(profile.co2PerKm * route.distKm);

        // Weather exposure
        const exposureMin = Math.round(totalEta * profile.openAirPct / 100);

        // Composite score
        const composite = Math.round((0.35 * totalEta + 0.65 * discomfort) * 10) / 10;

        modeRows.push({
          id: `${route.id}_${mode.toUpperCase()}_${intensity.toUpperCase()}`,
          route: `${route.origin} → ${route.dest}`,
          mode,
          category: profile.category,
          scenario_type: "alternative", // assigned below
          intensity,
          rainfall_mm_h: RAINFALL_MM[intensity],
          wind_kmh: WIND_KMH[intensity],
          humidity_pct: HUMIDITY_PCT[intensity],
          weather_cell_radius_km: CELL_RADIUS_KM[intensity],
          total_eta_min: totalEta,
          walking_eta_min: walkingEta,
          transit_eta_min: transitEta,
          wait_time_min: waitMin,
          walking_distance_m: profile.isTransit ? route.transitWalkM : (mode === "walking" ? Math.round(route.distKm * 1000) : 0),
          total_cost_idr: totalCost,
          fare_idr: fareIdr,
          fuel_cost_idr: fuelIdr,
          discomfort_score: discomfort,
          comfort_rating: comfort,
          weather_exposure_min: exposureMin,
          co2_grams: co2Grams,
          modal_shift_triggered: false, // assigned below
          composite_score: composite,
          data_source: "W-MPTRS Discomfort Engine v1.0 (PMC8037289 speed factors + BPBD 2025 flood data)",
          event_reference: eventRef(intensity, route.id),
        });
      }

      if (modeRows.length === 0) continue;

      // Determine scenario types for this (route, intensity) group
      const fastestRow  = modeRows.reduce((a, b) => a.total_eta_min <= b.total_eta_min ? a : b);
      const cheapestRow = modeRows.reduce((a, b) => a.total_cost_idr <= b.total_cost_idr ? a : b);
      const comfyRow    = modeRows.reduce((a, b) => a.discomfort_score <= b.discomfort_score ? a : b);
      const ecoRow      = modeRows.reduce((a, b) => a.co2_grams <= b.co2_grams ? a : b);
      const balancedRow = modeRows.reduce((a, b) => a.composite_score <= b.composite_score ? a : b);

      // Modal shift: if fastest and most_comfortable differ by >=10 discomfort points
      const fastestDiscomfort  = fastestRow.discomfort_score;
      const balancedDiscomfort = balancedRow.discomfort_score;
      const shiftTriggered = fastestDiscomfort - balancedDiscomfort >= 10;

      for (const row of modeRows) {
        if (row.id === fastestRow.id)  row.scenario_type = "fastest";
        else if (row.id === cheapestRow.id) row.scenario_type = "cheapest";
        else if (row.id === comfyRow.id)    row.scenario_type = "most_comfortable";
        else if (row.id === ecoRow.id)      row.scenario_type = "eco_friendly";
        else if (row.id === balancedRow.id) row.scenario_type = "balanced";
        row.modal_shift_triggered = shiftTriggered;
      }

      rows.push(...modeRows);
    }
  }

  return rows;
}

// ─── CSV download ─────────────────────────────────────────────────────────────

const CSV_COLUMNS: (keyof DatasetRow)[] = [
  "id","route","mode","category","scenario_type","intensity",
  "rainfall_mm_h","wind_kmh","humidity_pct","weather_cell_radius_km",
  "total_eta_min","walking_eta_min","transit_eta_min","wait_time_min","walking_distance_m",
  "total_cost_idr","fare_idr","fuel_cost_idr",
  "discomfort_score","comfort_rating","weather_exposure_min","co2_grams",
  "modal_shift_triggered","composite_score","data_source","event_reference",
];

function downloadCSV(rows: DatasetRow[], filename: string) {
  const esc = (v: unknown) => {
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = CSV_COLUMNS.join(",");
  const body = rows.map((r) => CSV_COLUMNS.map((k) => esc(r[k])).join(",")).join("\n");
  const footnote = [
    "",
    "# METHODOLOGY NOTES",
    "# Speed-reduction factors: PMC8037289 (Jakarta GPS study n=906 roads). Light +5% mean; Moderate +9%; Heavy +22% (BPBD 2025 flood incidents); Extreme +50% (2025 Jakarta floods 20+ road closures).",
    "# BMKG rainfall thresholds: None=0 Light=1-5 Moderate=5-20 Heavy=20-50 Extreme>50 mm/h.",
    "# Modal shift triggered when DiscomfortScore(fastest) - DiscomfortScore(balanced) >= 10 points.",
    "# Walk penalty: full for walks >=500m; 50% reduction for <500m (sheltered stop proximity).",
    "# Composite score: 0.35 x ETA_min + 0.65 x DiscomfortScore (Jakarta calibration).",
    "# CO2 sources: motorcycle/ojek 65g/km; car 150g/km; transjakarta 30g/km; mrt/lrt/krl 10g/km.",
    "# Fare data: TransJakarta flat Rp3500 (2024); MRT Rp4000+Rp1000/stop cap Rp14000; KRL Rp3000+Rp1000/25km band.",
  ].join("\n");
  const blob = new Blob([`${header}\n${body}${footnote}`], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Constants / style maps ───────────────────────────────────────────────────

const INTENSITY_COLORS: Record<string, string> = {
  none:     "bg-emerald-900/50 text-emerald-300",
  light:    "bg-sky-900/50 text-sky-300",
  moderate: "bg-yellow-900/50 text-yellow-300",
  heavy:    "bg-orange-900/50 text-orange-300",
  extreme:  "bg-red-900/50 text-red-300",
};

const SCENARIO_COLORS: Record<string, string> = {
  fastest:          "text-orange-400",
  cheapest:         "text-green-400",
  most_comfortable: "text-blue-400",
  eco_friendly:     "text-emerald-400",
  balanced:         "text-violet-400",
  alternative:      "text-[#475569]",
};

const MODE_COLORS: Record<string, string> = {
  motorcycle:   "bg-orange-500",
  ojek:         "bg-orange-600",
  car_private:  "bg-blue-400",
  car_online:   "bg-blue-600",
  bicycle:      "bg-green-400",
  walking:      "bg-slate-400",
  transjakarta: "bg-amber-500",
  mrt:          "bg-red-500",
  lrt:          "bg-violet-500",
  krl:          "bg-sky-400",
};

const TABLE_COLUMNS: { key: keyof DatasetRow; label: string; mono?: boolean }[] = [
  { key: "id",                    label: "ID",           mono: true  },
  { key: "route",                 label: "Route"                     },
  { key: "mode",                  label: "Mode"                      },
  { key: "category",              label: "Category"                  },
  { key: "scenario_type",         label: "Scenario"                  },
  { key: "intensity",             label: "Intensity"                 },
  { key: "rainfall_mm_h",         label: "Rain mm/h",   mono: true  },
  { key: "total_eta_min",         label: "ETA min",     mono: true  },
  { key: "wait_time_min",         label: "Wait min",    mono: true  },
  { key: "total_cost_idr",        label: "Cost IDR",    mono: true  },
  { key: "discomfort_score",      label: "Discomfort",  mono: true  },
  { key: "comfort_rating",        label: "Comfort",     mono: true  },
  { key: "co2_grams",             label: "CO2 g",       mono: true  },
  { key: "composite_score",       label: "Composite",   mono: true  },
  { key: "modal_shift_triggered", label: "Shift"                     },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function ResearchDatasetPanel() {
  const [filterIntensity, setFilterIntensity]   = useState<string>("all");
  const [filterCategory,  setFilterCategory]    = useState<string>("all");
  const [filterScenario,  setFilterScenario]    = useState<string>("all");
  const [filterRoute,     setFilterRoute]       = useState<string>("all");
  const [sortKey,         setSortKey]           = useState<keyof DatasetRow>("id");
  const [sortDir,         setSortDir]           = useState<"asc" | "desc">("asc");
  const [compareRoute,    setCompareRoute]      = useState<string>("R01");
  const [compareIntensity,setCompareIntensity]  = useState<string>("heavy");

  const dataset = useMemo(() => buildDataset(), []);

  const filtered = useMemo(() => {
    let rows = dataset;
    if (filterIntensity !== "all") rows = rows.filter((r) => r.intensity === filterIntensity);
    if (filterCategory  !== "all") rows = rows.filter((r) => r.category  === filterCategory);
    if (filterScenario  !== "all") rows = rows.filter((r) => r.scenario_type === filterScenario);
    if (filterRoute     !== "all") rows = rows.filter((r) => r.id.startsWith(filterRoute));
    return [...rows].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const cmp = typeof av === "boolean"
        ? (av === bv ? 0 : av ? 1 : -1)
        : typeof av === "number"
          ? (av as number) - (bv as number)
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [dataset, filterIntensity, filterCategory, filterScenario, filterRoute, sortKey, sortDir]);

  const compareRows = useMemo(
    () => dataset.filter((r) => r.id.startsWith(compareRoute) && r.intensity === compareIntensity),
    [dataset, compareRoute, compareIntensity]
  );

  const shiftCount  = dataset.filter((r) => r.modal_shift_triggered).length;
  const uniqueShift = new Set(dataset.filter((r) => r.modal_shift_triggered).map((r) => r.id.slice(0, 6))).size;

  // Summary stats
  const avgEtaByMode = useMemo(() => {
    const byMode: Record<string, number[]> = {};
    for (const row of dataset) {
      if (!byMode[row.mode]) byMode[row.mode] = [];
      byMode[row.mode].push(row.total_eta_min);
    }
    return Object.entries(byMode).map(([m, vals]) => ({
      mode: m,
      avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
    })).sort((a, b) => a.avg - b.avg);
  }, [dataset]);

  const avgCostByMode = useMemo(() => {
    const byMode: Record<string, number[]> = {};
    for (const row of dataset) {
      if (!byMode[row.mode]) byMode[row.mode] = [];
      byMode[row.mode].push(row.total_cost_idr);
    }
    return Object.entries(byMode).map(([m, vals]) => ({
      mode: m,
      avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
    }));
  }, [dataset]);

  function toggleSort(key: keyof DatasetRow) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  // Compare bar chart helpers
  const compareMaxEta      = Math.max(...compareRows.map((r) => r.total_eta_min), 1);
  const compareMaxCost     = Math.max(...compareRows.map((r) => r.total_cost_idr), 1);
  const compareMaxCO2      = Math.max(...compareRows.map((r) => r.co2_grams), 1);
  const compareMaxDiscomt  = Math.max(...compareRows.map((r) => r.discomfort_score), 1);

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-bold text-white mb-1">
              Research Dataset — W-MPTRS Full Scenario Matrix
            </h2>
            <p className="text-xs text-[#64748b] leading-relaxed max-w-2xl">
              ~295 rows across 12 real Jakarta O-D pairs × multiple transport modes × 5 BMKG intensity classes.
              Speed-reduction factors from PMC8037289 (n=906 roads) and BPBD 2025 flood data.
              Composite score: <span className="font-mono text-blue-400">0.35×ETA + 0.65×Discomfort</span>.
            </p>
            <div className="flex flex-wrap gap-3 mt-3 text-[10px] text-[#475569]">
              <span>Speed factors: <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC8037289/" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">PMC8037289</a></span>
              <span>Flood event: <a href="https://en.wikipedia.org/wiki/2025_Jakarta_floods" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">2025 Jakarta floods (BNPB)</a></span>
              <span>BMKG rainfall thresholds: Kategori Curah Hujan</span>
              <span>Transit ridership: BPS DKI Jakarta 2024</span>
            </div>
          </div>
          <div className="flex gap-2 shrink-0 flex-wrap">
            <button
              onClick={() => downloadCSV(filtered, `wmptrs_dataset_${filterIntensity}_${filterCategory}_filtered.csv`)}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              Download CSV ({filtered.length} rows)
            </button>
            <button
              onClick={() => downloadCSV(dataset, `wmptrs_dataset_full_${dataset.length}rows.csv`)}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#1e2530] hover:bg-[#2a3040] text-[#94a3b8] text-xs font-medium rounded-lg transition-colors border border-[#2a3040]"
            >
              Full {dataset.length} rows
            </button>
          </div>
        </div>
      </div>

      {/* ── Summary stats ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:"Total Rows",       val: String(dataset.length),   sub:`12 routes × modes × 5 intensities` },
          { label:"Shift Triggered",  val: `${uniqueShift} groups`,  sub:`${shiftCount} rows flagged (modal shift ≥10pts)` },
          { label:"Speed Sources",    val: "3",                      sub:"PMC8037289 + BPBD 2025 + BMKG" },
          { label:"Mode Coverage",    val: "10 modes",               sub:"motorcycle, MRT, KRL, walking…" },
        ].map(({ label, val, sub }) => (
          <div key={label} className="bg-[#0f1117] border border-[#1e2530] rounded-xl p-4">
            <p className="text-[10px] text-[#475569] uppercase tracking-widest mb-1">{label}</p>
            <p className="text-xl font-bold font-mono text-white">{val}</p>
            <p className="text-[10px] text-[#475569] mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* ── Avg ETA by mode ────────────────────────────────────────────────── */}
      <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl p-4">
        <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">Avg ETA by Mode (all intensities)</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {avgEtaByMode.map(({ mode, avg }) => {
            const pct = Math.round(avg / (avgEtaByMode[avgEtaByMode.length - 1]?.avg || 1) * 100);
            return (
              <div key={mode} className="flex items-center gap-2 min-w-[160px]">
                <span className={`w-2 h-2 rounded-full shrink-0 ${MODE_COLORS[mode] ?? "bg-gray-500"}`} />
                <span className="text-[10px] text-[#64748b] w-24 truncate">{MODE_PROFILES[mode]?.label ?? mode}</span>
                <div className="flex-1 h-1.5 bg-[#1e2530] rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${MODE_COLORS[mode] ?? "bg-gray-500"}`} style={{ width:`${pct}%` }} />
                </div>
                <span className="text-[10px] font-mono text-[#94a3b8] w-10 text-right">{avg}m</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[10px] text-[#475569] uppercase tracking-wider w-16">Intensity</span>
          {["all","none","light","moderate","heavy","extreme"].map((v) => (
            <button key={v} onClick={() => setFilterIntensity(v)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all capitalize ${filterIntensity === v ? "bg-blue-600 text-white" : "bg-[#1a1f2e] text-[#64748b] hover:text-[#94a3b8]"}`}>
              {v}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[10px] text-[#475569] uppercase tracking-wider w-16">Category</span>
          {["all","private","ride_hail","public_transit","non_motorized"].map((v) => (
            <button key={v} onClick={() => setFilterCategory(v)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all capitalize ${filterCategory === v ? "bg-violet-600 text-white" : "bg-[#1a1f2e] text-[#64748b] hover:text-[#94a3b8]"}`}>
              {v.replace("_"," ")}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[10px] text-[#475569] uppercase tracking-wider w-16">Scenario</span>
          {["all","fastest","cheapest","most_comfortable","eco_friendly","balanced","alternative"].map((v) => (
            <button key={v} onClick={() => setFilterScenario(v)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${filterScenario === v ? "bg-emerald-700 text-white" : "bg-[#1a1f2e] text-[#64748b] hover:text-[#94a3b8]"}`}>
              {v.replace(/_/g," ")}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[10px] text-[#475569] uppercase tracking-wider w-16">Route</span>
          {["all",...ROUTES.map((r) => r.id)].map((v) => (
            <button key={v} onClick={() => setFilterRoute(v)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all font-mono ${filterRoute === v ? "bg-amber-700 text-white" : "bg-[#1a1f2e] text-[#64748b] hover:text-[#94a3b8]"}`}>
              {v}
            </button>
          ))}
        </div>
        <p className="text-xs text-[#475569]">{filtered.length} rows shown</p>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl overflow-x-auto">
        <table className="w-full text-xs min-w-[1400px]">
          <thead>
            <tr className="border-b border-[#1e2530]">
              {TABLE_COLUMNS.map((col) => (
                <th key={col.key} onClick={() => toggleSort(col.key)}
                  className="px-3 py-2.5 text-left text-[#475569] uppercase tracking-wider font-medium cursor-pointer hover:text-[#94a3b8] select-none whitespace-nowrap">
                  {col.label}
                  {sortKey === col.key && <span className="ml-1 text-blue-400">{sortDir === "asc" ? "↑" : "↓"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr key={row.id} className={`border-b border-[#1e2530] last:border-0 ${i % 2 === 0 ? "" : "bg-[#0a0d14]/50"}`}>
                <td className="px-3 py-2 font-mono text-[#64748b] whitespace-nowrap">{row.id}</td>
                <td className="px-3 py-2 text-white whitespace-nowrap text-[10px]">{row.route}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${MODE_COLORS[row.mode] ?? "bg-gray-500"}`} />
                    <span className="text-[#94a3b8]">{MODE_PROFILES[row.mode]?.label ?? row.mode}</span>
                  </span>
                </td>
                <td className="px-3 py-2 text-[10px] text-[#64748b] capitalize">{row.category.replace(/_/g," ")}</td>
                <td className={`px-3 py-2 text-[10px] font-semibold capitalize ${SCENARIO_COLORS[row.scenario_type]}`}>
                  {row.scenario_type.replace(/_/g," ")}
                </td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${INTENSITY_COLORS[row.intensity]}`}>
                    {row.intensity}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-[#94a3b8]">{row.rainfall_mm_h}</td>
                <td className="px-3 py-2 font-mono text-white font-semibold">{row.total_eta_min}</td>
                <td className="px-3 py-2 font-mono text-[#94a3b8]">{row.wait_time_min}</td>
                <td className="px-3 py-2 font-mono text-[#94a3b8]">{row.total_cost_idr.toLocaleString()}</td>
                <td className={`px-3 py-2 font-mono font-bold ${row.discomfort_score > 20 ? "text-red-400" : row.discomfort_score > 5 ? "text-yellow-400" : "text-emerald-400"}`}>
                  {row.discomfort_score}
                </td>
                <td className="px-3 py-2 font-mono text-[#94a3b8]">{row.comfort_rating}</td>
                <td className={`px-3 py-2 font-mono ${row.co2_grams === 0 ? "text-emerald-400" : row.co2_grams > 1000 ? "text-red-400" : "text-[#94a3b8]"}`}>
                  {row.co2_grams}
                </td>
                <td className="px-3 py-2 font-mono text-[#94a3b8]">{row.composite_score}</td>
                <td className="px-3 py-2">
                  {row.modal_shift_triggered
                    ? <span className="text-[10px] font-bold text-blue-400 bg-blue-900/30 px-2 py-0.5 rounded-full">YES</span>
                    : <span className="text-[10px] text-[#475569]">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mode Comparison ────────────────────────────────────────────────── */}
      <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-sm font-bold text-white">Mode Comparison</h3>
          <div className="flex gap-3 flex-wrap">
            <div className="flex gap-1.5 items-center">
              <span className="text-[10px] text-[#475569]">Route:</span>
              <select
                value={compareRoute}
                onChange={(e) => setCompareRoute(e.target.value)}
                className="bg-[#1a1f2e] border border-[#1e2530] text-[#94a3b8] text-xs rounded-lg px-2 py-1"
              >
                {ROUTES.map((r) => (
                  <option key={r.id} value={r.id}>{r.id} — {r.origin} → {r.dest}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-1.5 items-center">
              <span className="text-[10px] text-[#475569]">Intensity:</span>
              <select
                value={compareIntensity}
                onChange={(e) => setCompareIntensity(e.target.value)}
                className="bg-[#1a1f2e] border border-[#1e2530] text-[#94a3b8] text-xs rounded-lg px-2 py-1"
              >
                {INTENSITIES.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
          </div>
        </div>

        {compareRows.length === 0 ? (
          <p className="text-xs text-[#475569]">No data for this combination.</p>
        ) : (
          <div className="space-y-2">
            {/* ETA bars */}
            <p className="text-[10px] text-[#475569] uppercase tracking-wider">Total ETA (minutes)</p>
            {compareRows.map((row) => (
              <div key={`eta_${row.id}`} className="flex items-center gap-3">
                <span className="text-[10px] text-[#64748b] w-28 shrink-0 truncate">{MODE_PROFILES[row.mode]?.label ?? row.mode}</span>
                <div className="flex-1 h-4 bg-[#1e2530] rounded-sm overflow-hidden">
                  <div
                    className={`h-full rounded-sm transition-all ${MODE_COLORS[row.mode] ?? "bg-gray-500"}`}
                    style={{ width:`${Math.round(row.total_eta_min / compareMaxEta * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-white w-12 text-right">{row.total_eta_min} min</span>
                <span className={`text-[10px] font-semibold w-20 ${SCENARIO_COLORS[row.scenario_type]}`}>{row.scenario_type.replace(/_/g," ")}</span>
              </div>
            ))}

            {/* Cost bars */}
            <p className="text-[10px] text-[#475569] uppercase tracking-wider mt-4">Total Cost (IDR)</p>
            {compareRows.map((row) => (
              <div key={`cost_${row.id}`} className="flex items-center gap-3">
                <span className="text-[10px] text-[#64748b] w-28 shrink-0 truncate">{MODE_PROFILES[row.mode]?.label ?? row.mode}</span>
                <div className="flex-1 h-4 bg-[#1e2530] rounded-sm overflow-hidden">
                  <div
                    className={`h-full rounded-sm transition-all ${MODE_COLORS[row.mode] ?? "bg-gray-500"}`}
                    style={{ width:`${Math.round(row.total_cost_idr / compareMaxCost * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-white w-20 text-right">Rp {row.total_cost_idr.toLocaleString()}</span>
                <span className="w-20" />
              </div>
            ))}

            {/* CO2 bars */}
            <p className="text-[10px] text-[#475569] uppercase tracking-wider mt-4">CO2 Emissions (grams)</p>
            {compareRows.map((row) => (
              <div key={`co2_${row.id}`} className="flex items-center gap-3">
                <span className="text-[10px] text-[#64748b] w-28 shrink-0 truncate">{MODE_PROFILES[row.mode]?.label ?? row.mode}</span>
                <div className="flex-1 h-4 bg-[#1e2530] rounded-sm overflow-hidden">
                  <div
                    className={`h-full rounded-sm transition-all ${row.co2_grams === 0 ? "bg-emerald-500" : MODE_COLORS[row.mode] ?? "bg-gray-500"}`}
                    style={{ width:`${Math.round(row.co2_grams / compareMaxCO2 * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-white w-14 text-right">{row.co2_grams} g</span>
                <span className="w-20" />
              </div>
            ))}

            {/* Discomfort bars */}
            <p className="text-[10px] text-[#475569] uppercase tracking-wider mt-4">Discomfort Score</p>
            {compareRows.map((row) => (
              <div key={`disc_${row.id}`} className="flex items-center gap-3">
                <span className="text-[10px] text-[#64748b] w-28 shrink-0 truncate">{MODE_PROFILES[row.mode]?.label ?? row.mode}</span>
                <div className="flex-1 h-4 bg-[#1e2530] rounded-sm overflow-hidden">
                  <div
                    className={`h-full rounded-sm transition-all ${row.discomfort_score > 20 ? "bg-red-500" : row.discomfort_score > 5 ? "bg-yellow-500" : "bg-emerald-500"}`}
                    style={{ width:`${Math.round(row.discomfort_score / compareMaxDiscomt * 100)}%` }}
                  />
                </div>
                <span className={`text-[10px] font-mono font-bold w-12 text-right ${row.discomfort_score > 20 ? "text-red-400" : row.discomfort_score > 5 ? "text-yellow-400" : "text-emerald-400"}`}>
                  {row.discomfort_score}
                </span>
                <span className="w-20" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Avg cost by mode ──────────────────────────────────────────────── */}
      <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl p-4">
        <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">Avg Cost by Mode (IDR, all intensities)</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {avgCostByMode.sort((a, b) => a.avg - b.avg).map(({ mode, avg }) => {
            const maxCost = Math.max(...avgCostByMode.map((x) => x.avg), 1);
            const pct = Math.round(avg / maxCost * 100);
            return (
              <div key={mode} className="flex items-center gap-2 min-w-[180px]">
                <span className={`w-2 h-2 rounded-full shrink-0 ${MODE_COLORS[mode] ?? "bg-gray-500"}`} />
                <span className="text-[10px] text-[#64748b] w-28 truncate">{MODE_PROFILES[mode]?.label ?? mode}</span>
                <div className="flex-1 h-1.5 bg-[#1e2530] rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${MODE_COLORS[mode] ?? "bg-gray-500"}`} style={{ width:`${pct}%` }} />
                </div>
                <span className="text-[10px] font-mono text-[#94a3b8] w-16 text-right">Rp {avg.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Methodology footnote ──────────────────────────────────────────── */}
      <div className="bg-[#0a0d14] border border-[#1e2530] rounded-xl p-4 text-[10px] text-[#475569] space-y-1.5 leading-relaxed">
        <p className="font-semibold text-[#64748b] text-xs mb-2">Methodology Notes</p>
        <p><span className="text-[#94a3b8]">Speed-reduction factors:</span> PMC8037289 smartphone GPS study. Light +5%; Moderate +9%; Heavy +22% (BPBD 2025 flood incidents, Kompas traffic); Extreme +50% (2025 Jakarta floods, 20+ road closures, 90,000+ displaced).</p>
        <p><span className="text-[#94a3b8]">BMKG thresholds:</span> None=0, Light=1–5, Moderate=5–20, Heavy=20–50, Extreme&gt;50 mm/h. Wind and humidity from BMKG station data 2024.</p>
        <p><span className="text-[#94a3b8]">Modal shift trigger:</span> DiscomfortScore(fastest) − DiscomfortScore(balanced) ≥ 10 points activates shift recommendation.</p>
        <p><span className="text-[#94a3b8]">Walk penalty:</span> Full penalty for walks ≥500 m; 50% reduction for &lt;500 m (sheltered stop proximity assumption).</p>
        <p><span className="text-[#94a3b8]">Composite weights:</span> Time 0.35 / Weather 0.65 — Jakarta-specific calibration (toll infrastructure narrows ETA delta; open-air exposure high during wet season Nov–Mar, avg 2,146 mm/year).</p>
        <p><span className="text-[#94a3b8]">Fares:</span> TransJakarta flat Rp3,500 (2024 tariff). MRT Rp4,000 base + Rp1,000/stop, cap Rp14,000. KRL Rp3,000 + Rp1,000 per 25 km band. Ojek/Car Online: Rp2,500/km + base fare.</p>
        <p><span className="text-[#94a3b8]">CO2:</span> Motorcycle/Ojek 65 g/km; Car 150 g/km; TransJakarta 30 g/km (fleet average); MRT/LRT/KRL 10 g/km (electric/grid factor).</p>
        <p><span className="text-[#94a3b8]">Rain cell radius:</span> None=0, Light=50 km, Moderate=30 km, Heavy=15 km, Extreme=8 km (BMKG radar data, typical Jakarta convective cell).</p>
      </div>
    </div>
  );
}
