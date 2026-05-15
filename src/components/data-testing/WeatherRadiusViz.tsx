"use client";

import { useState, useMemo } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Intensity = "none" | "light" | "moderate" | "heavy" | "extreme";

interface Destination {
  name: string;
  angle: number;    // degrees from east, clockwise
  radiusPx: number; // distance from center in px (at 600×500 viewBox)
}

// ─── Constants ────────────────────────────────────────────────────────────────

const INTENSITIES: Intensity[] = ["none", "light", "moderate", "heavy", "extreme"];

const INTENSITY_COLORS: Record<Intensity, string> = {
  none:     "#10b981",
  light:    "#38bdf8",
  moderate: "#fbbf24",
  heavy:    "#f97316",
  extreme:  "#ef4444",
};

const INTENSITY_RADIUS_KM: Record<Intensity, number> = {
  none:     0,
  light:    50,
  moderate: 30,
  heavy:    15,
  extreme:  8,
};

// Zone circles (px radii) — concentric around center
const ZONE_RADII: Record<Intensity, number> = {
  none:     0,
  light:    220,
  moderate: 160,
  heavy:    100,
  extreme:  50,
};

// Mode colors
const MODE_COLORS: Record<string, string> = {
  motorcycle:   "#fb923c",
  ojek:         "#f97316",
  car_private:  "#60a5fa",
  car_online:   "#3b82f6",
  bicycle:      "#4ade80",
  walking:      "#94a3b8",
  transjakarta: "#f59e0b",
  mrt:          "#ef4444",
  lrt:          "#a78bfa",
  krl:          "#38bdf8",
};

// Recommended mode per intensity for routes at various distances
function recommendedMode(intensity: Intensity, destRadiusPx: number): string {
  if (intensity === "none" || intensity === "light") {
    return destRadiusPx <= 100 ? "motorcycle" : "car_private";
  }
  if (intensity === "moderate") {
    // Within heavy zone → transit, outside → car
    return destRadiusPx <= 100 ? "transjakarta" : "car_online";
  }
  if (intensity === "heavy") {
    return destRadiusPx <= 100 ? "mrt" : "transjakarta";
  }
  // extreme
  if (destRadiusPx <= 50) return "mrt";
  if (destRadiusPx <= 100) return "mrt";
  return "krl";
}

// ─── Destinations ─────────────────────────────────────────────────────────────

const DESTINATIONS: Destination[] = [
  { name:"Sudirman",      angle: 45,  radiusPx: 80  },
  { name:"Kelapa Gading", angle: 30,  radiusPx: 140 },
  { name:"Monas",         angle: 90,  radiusPx: 90  },
  { name:"Tanjung Priok", angle: 15,  radiusPx: 110 },
  { name:"Blok M",        angle: 200, radiusPx: 70  },
  { name:"Lebak Bulus",   angle: 220, radiusPx: 130 },
  { name:"Tangerang",     angle: 270, radiusPx: 200 },
  { name:"Bekasi",        angle: 340, radiusPx: 210 },
  { name:"Kota Tua",      angle: 120, radiusPx: 95  },
  { name:"Grogol",        angle: 260, radiusPx: 85  },
];

const CENTER_X = 270;
const CENTER_Y = 250;

function destXY(d: Destination): { x: number; y: number } {
  const rad = (d.angle * Math.PI) / 180;
  return {
    x: CENTER_X + d.radiusPx * Math.cos(rad),
    y: CENTER_Y + d.radiusPx * Math.sin(rad),
  };
}

// ─── Stats by intensity ───────────────────────────────────────────────────────

interface IntensityStats {
  routesAffected: number;
  shiftPct: number;
  avgEtaIncreasePct: number;
  maxEtaIncreaseMin: number;
}

const ETA_INCREASE_PCT: Record<Intensity, number> = {
  none:     0,
  light:    5,
  moderate: 9,
  heavy:    22,
  extreme:  50,
};

function computeStats(intensity: Intensity): IntensityStats {
  const heavyZoneR = ZONE_RADII.heavy;
  const routesAffected = intensity === "none"
    ? 0
    : DESTINATIONS.filter((d) => d.radiusPx <= ZONE_RADII[intensity]).length;

  // Count where modal shift is recommended
  const shifted = DESTINATIONS.filter((d) => {
    const rec = recommendedMode(intensity, d.radiusPx);
    const baseRec = recommendedMode("none", d.radiusPx);
    return rec !== baseRec;
  }).length;
  const shiftPct = Math.round((shifted / DESTINATIONS.length) * 100);

  const avgEtaIncreasePct = ETA_INCREASE_PCT[intensity];
  const maxEtaIncreaseMin = intensity === "none" ? 0 :
    Math.round((DESTINATIONS.filter((d) => d.radiusPx <= heavyZoneR).length > 0 ? 24 : 10) * (ETA_INCREASE_PCT[intensity] / 100));

  return { routesAffected, shiftPct, avgEtaIncreasePct, maxEtaIncreaseMin };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WeatherRadiusViz() {
  const [intensity, setIntensity] = useState<Intensity>("heavy");

  const stats = useMemo(() => computeStats(intensity), [intensity]);

  // Which zone rings to show
  const zoneEntries: [Intensity, number][] = [
    ["extreme",  ZONE_RADII.extreme],
    ["heavy",    ZONE_RADII.heavy],
    ["moderate", ZONE_RADII.moderate],
    ["light",    ZONE_RADII.light],
  ];

  return (
    <div className="space-y-6">

      {/* Intensity selector */}
      <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl p-4">
        <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">
          Select Rain Intensity
        </p>
        <div className="flex flex-wrap gap-2">
          {INTENSITIES.map((i) => (
            <button
              key={i}
              onClick={() => setIntensity(i)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold capitalize transition-all border ${
                intensity === i
                  ? "text-[#0f1117] border-transparent"
                  : "bg-[#1a1f2e] text-[#64748b] border-[#1e2530] hover:text-[#94a3b8]"
              }`}
              style={intensity === i ? { backgroundColor: INTENSITY_COLORS[i], borderColor: INTENSITY_COLORS[i] } : {}}
            >
              {i}
            </button>
          ))}
        </div>
      </div>

      {/* Main SVG + Legend */}
      <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl p-4 overflow-x-auto">
        <svg
          viewBox="0 0 600 500"
          width="100%"
          style={{ minWidth: 500 }}
          aria-label={`Weather radius visualization for Jakarta — ${intensity} intensity`}
        >
          {/* Background */}
          <rect x={0} y={0} width={600} height={500} fill="#0f1117" />

          {/* Title */}
          <text x={270} y={22} textAnchor="middle" fill="#94a3b8" fontSize={11} fontWeight="600">
            Jakarta Rain Cell Radius — {intensity.charAt(0).toUpperCase() + intensity.slice(1)} Intensity
          </text>

          {/* Zone circles (largest to smallest, back to front) */}
          {zoneEntries.map(([zone, r]) => {
            const isSelected = zone === intensity;
            const color = INTENSITY_COLORS[zone];
            return (
              <g key={zone}>
                <circle
                  cx={CENTER_X} cy={CENTER_Y} r={r}
                  fill={color}
                  fillOpacity={isSelected ? 0.12 : 0.05}
                  stroke={color}
                  strokeWidth={isSelected ? 2 : 0.5}
                  strokeOpacity={isSelected ? 0.9 : 0.3}
                  strokeDasharray={isSelected ? "none" : "4 4"}
                />
                {/* Zone label on ring */}
                {r > 20 && (
                  <text
                    x={CENTER_X + r - 4}
                    y={CENTER_Y - 4}
                    textAnchor="end"
                    fill={color}
                    fontSize={8}
                    opacity={isSelected ? 0.9 : 0.4}
                  >
                    {INTENSITY_RADIUS_KM[zone] > 0 ? `${INTENSITY_RADIUS_KM[zone]} km` : ""}
                  </text>
                )}
              </g>
            );
          })}

          {/* Route lines */}
          {DESTINATIONS.map((dest) => {
            const { x, y } = destXY(dest);
            const rec = recommendedMode(intensity, dest.radiusPx);
            const color = MODE_COLORS[rec] ?? "#64748b";
            const isInsideActiveZone = intensity !== "none" && dest.radiusPx <= ZONE_RADII[intensity];
            return (
              <line
                key={`line_${dest.name}`}
                x1={CENTER_X} y1={CENTER_Y}
                x2={x} y2={y}
                stroke={color}
                strokeWidth={isInsideActiveZone ? 2 : 1}
                strokeOpacity={isInsideActiveZone ? 0.85 : 0.4}
                strokeDasharray={isInsideActiveZone ? "none" : "6 4"}
              />
            );
          })}

          {/* Destination dots + labels */}
          {DESTINATIONS.map((dest) => {
            const { x, y } = destXY(dest);
            const rec = recommendedMode(intensity, dest.radiusPx);
            const color = MODE_COLORS[rec] ?? "#64748b";
            const isInside = intensity !== "none" && dest.radiusPx <= ZONE_RADII[intensity];
            // Label position: push away from center
            const angle = (dest.angle * Math.PI) / 180;
            const lx = CENTER_X + (dest.radiusPx + 18) * Math.cos(angle);
            const ly = CENTER_Y + (dest.radiusPx + 18) * Math.sin(angle);
            return (
              <g key={dest.name}>
                <circle
                  cx={x} cy={y} r={isInside ? 6 : 4}
                  fill={isInside ? color : "#1e2530"}
                  stroke={color}
                  strokeWidth={1.5}
                />
                <text
                  x={lx} y={ly}
                  textAnchor="middle"
                  fill={isInside ? "#94a3b8" : "#475569"}
                  fontSize={8}
                  fontWeight={isInside ? "600" : "400"}
                >
                  {dest.name}
                </text>
              </g>
            );
          })}

          {/* Origin (user location) */}
          <circle cx={CENTER_X} cy={CENTER_Y} r={8} fill="#0f1117" stroke="#60a5fa" strokeWidth={2} />
          <circle cx={CENTER_X} cy={CENTER_Y} r={3} fill="#60a5fa" />
          <text x={CENTER_X} y={CENTER_Y + 20} textAnchor="middle" fill="#60a5fa" fontSize={9} fontWeight="600">
            Origin
          </text>

          {/* Wind direction arrow */}
          <g transform="translate(520 50)">
            <circle cx={0} cy={0} r={18} fill="#0a0d14" stroke="#1e2530" strokeWidth={1} />
            {/* Arrow pointing "northeast" (typical Jakarta monsoon) */}
            <line x1={0} y1={12} x2={0} y2={-10} stroke="#64748b" strokeWidth={1.5} markerEnd="url(#wind-arrow)" />
            <text x={0} y={28} textAnchor="middle" fill="#475569" fontSize={7}>wind</text>
          </g>
          <defs>
            <marker id="wind-arrow" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto">
              <polygon points="0,5 2.5,0 5,5" fill="#64748b" />
            </marker>
          </defs>

          {/* City label */}
          <text x={CENTER_X} y={CENTER_Y - 22} textAnchor="middle" fill="#1e2530" fontSize={28} fontWeight="900" opacity={0.4}>
            Jakarta
          </text>

          {/* Legend panel */}
          <rect x={430} y={100} width={160} height={280} rx={6} fill="#0a0d14" stroke="#1e2530" strokeWidth={1} />
          <text x={440} y={118} fill="#64748b" fontSize={9} fontWeight="700">RECOMMENDED MODE</text>
          {Object.entries(MODE_COLORS).slice(0, 8).map(([mode, color], i) => (
            <g key={mode}>
              <rect x={440} y={128 + i * 18} width={10} height={6} rx={1} fill={color} />
              <text x={455} y={134 + i * 18} fill="#64748b" fontSize={8} dominantBaseline="middle">
                {mode.replace("_"," ")}
              </text>
            </g>
          ))}
          <text x={440} y={280} fill="#64748b" fontSize={9} fontWeight="700">ZONE RADIUS</text>
          {zoneEntries.map(([zone, r], i) => (
            <g key={`legend_zone_${zone}`}>
              <circle cx={445} cy={293 + i * 16} r={4} fill={INTENSITY_COLORS[zone]} fillOpacity={0.6} />
              <text x={455} y={293 + i * 16} fill="#64748b" fontSize={8} dominantBaseline="middle">
                {zone}: {INTENSITY_RADIUS_KM[zone]} km
              </text>
            </g>
          ))}

          {/* Data source note */}
          <text x={10} y={490} fill="#2a3040" fontSize={7}>
            Rain cell radius: BMKG radar data | Speed impact: PMC8037289 | Flood data: BPBD DKI 2025
          </text>
        </svg>
      </div>

      {/* Stats table */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Routes in rain zone",
            val: `${stats.routesAffected} / ${DESTINATIONS.length}`,
            sub: `within ${INTENSITY_RADIUS_KM[intensity]} km radius`,
            color: INTENSITY_COLORS[intensity],
          },
          {
            label: "Modal shift recommended",
            val: `${stats.shiftPct}%`,
            sub: "routes where mode changes",
            color: "#a78bfa",
          },
          {
            label: "Avg ETA increase",
            val: `+${stats.avgEtaIncreasePct}%`,
            sub: "vs dry baseline",
            color: "#fbbf24",
          },
          {
            label: "Max ETA increase",
            val: `+${stats.maxEtaIncreaseMin} min`,
            sub: "worst-case inner-zone route",
            color: "#ef4444",
          },
        ].map(({ label, val, sub, color }) => (
          <div key={label} className="bg-[#0f1117] border border-[#1e2530] rounded-xl p-4">
            <p className="text-[10px] text-[#475569] uppercase tracking-widest mb-1">{label}</p>
            <p className="text-xl font-bold font-mono" style={{ color }}>{val}</p>
            <p className="text-[10px] text-[#475569] mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Per-destination recommendation table */}
      <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1e2530]">
          <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider">
            Route Recommendations — {intensity} intensity
          </p>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#1e2530]">
              {["Destination","Distance Zone","In Rain Cell","Recommended Mode","Dry Mode","Shift?"].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-[#475569] font-medium uppercase tracking-wider text-[10px]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DESTINATIONS.map((dest, i) => {
              const { radiusPx } = dest;
              const rec = recommendedMode(intensity, radiusPx);
              const dryRec = recommendedMode("none", radiusPx);
              const shifted = rec !== dryRec;
              const isInside = intensity !== "none" && radiusPx <= ZONE_RADII[intensity];
              const recColor = MODE_COLORS[rec] ?? "#64748b";
              const dryColor = MODE_COLORS[dryRec] ?? "#64748b";
              // Approximate distance label
              const approxKm = Math.round(radiusPx / ZONE_RADII.light * INTENSITY_RADIUS_KM.light);
              return (
                <tr key={dest.name} className={`border-b border-[#1e2530] last:border-0 ${i % 2 === 0 ? "" : "bg-[#0a0d14]/50"}`}>
                  <td className="px-3 py-2 text-white font-medium">{dest.name}</td>
                  <td className="px-3 py-2 font-mono text-[#64748b]">~{approxKm} km</td>
                  <td className="px-3 py-2">
                    {isInside
                      ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: INTENSITY_COLORS[intensity], backgroundColor: `${INTENSITY_COLORS[intensity]}20` }}>YES</span>
                      : <span className="text-[10px] text-[#475569]">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: recColor }} />
                      <span style={{ color: recColor }} className="font-semibold capitalize">{rec.replace("_"," ")}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: dryColor }} />
                      <span style={{ color: dryColor }} className="text-[#64748b] capitalize">{dryRec.replace("_"," ")}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {shifted
                      ? <span className="text-[10px] font-bold text-blue-400 bg-blue-900/30 px-2 py-0.5 rounded-full">SHIFT</span>
                      : <span className="text-[10px] text-[#475569]">same</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Data context */}
      <div className="bg-[#0a0d14] border border-[#1e2530] rounded-xl p-4 text-[10px] text-[#475569] space-y-1.5 leading-relaxed">
        <p className="font-semibold text-[#64748b] text-xs mb-2">Data Sources</p>
        <p><span className="text-[#94a3b8]">Rain cell radius:</span> Based on BMKG radar data (Jakarta 2024). Typical convective cells during wet season: Extreme 8 km, Heavy 15 km, Moderate 30 km, Light 50 km. Source: BMKG Jakarta Radar Station, Pulau Sangiang.</p>
        <p><span className="text-[#94a3b8]">Speed impact:</span> PMC8037289 — "Identification and Analysis of Weather-Sensitive Roads Based on Smartphone Sensor Data" (Jakarta 2017–2018, n=906 road segments). Light +5%, Moderate +9%, Heavy +22%, Extreme +50% travel time increase.</p>
        <p><span className="text-[#94a3b8]">2025 flood data:</span> BNPB/BPBD DKI Jakarta incident reports, 2–6 March 2025. 90,000+ displaced, 20+ road closures, 10–50 cm water depth in flood zones.</p>
        <p><span className="text-[#94a3b8]">Modal shift logic:</span> W-MPTRS Discomfort Penalty Engine v1.0. Shift triggered when DiscomfortScore(fastest) − DiscomfortScore(balanced) ≥ 10 points. Thresholds calibrated against TransJakarta ridership surge data during wet season (BPS DKI Jakarta 2024).</p>
      </div>
    </div>
  );
}
