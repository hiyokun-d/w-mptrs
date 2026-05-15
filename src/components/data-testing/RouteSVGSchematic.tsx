"use client";

import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Segment {
  mode: string;
  label: string;
  distanceM: number;
  durationMin: number;
  color?: string;
  isWalking?: boolean;
  stops?: string[];
}

interface RouteExample {
  title: string;
  origin: string;
  destination: string;
  segments: Segment[];
  totalEtaMin: number;
  totalDistanceKm: number;
  fare: number;
  co2Grams: number;
  discomfortScore: number;
  intensity: string;
}

// ─── Mode color map ───────────────────────────────────────────────────────────

const MODE_COLORS: Record<string, string> = {
  motorcycle:   "#fb923c",
  ojek:         "#f97316",
  car_private:  "#60a5fa",
  car_online:   "#3b82f6",
  bicycle:      "#4ade80",
  walking:      "#94a3b8",
  mrt:          "#ef4444",
  transjakarta: "#f59e0b",
  lrt:          "#a78bfa",
  krl:          "#38bdf8",
};

const MODE_ABBR: Record<string, string> = {
  motorcycle:   "MOTO",
  ojek:         "OJEK",
  car_private:  "CAR",
  car_online:   "GRAB",
  bicycle:      "BIKE",
  walking:      "WALK",
  mrt:          "MRT",
  transjakarta: "TJ",
  lrt:          "LRT",
  krl:          "KRL",
};

const INTENSITY_FILL: Record<string, string> = {
  none:     "#10b981",
  light:    "#38bdf8",
  moderate: "#fbbf24",
  heavy:    "#f97316",
  extreme:  "#ef4444",
};

// ─── Example route data ───────────────────────────────────────────────────────

const EXAMPLE_ROUTES: RouteExample[] = [
  {
    title: "Blok M → Sudirman — Heavy Rain (MRT)",
    origin: "Blok M",
    destination: "Sudirman",
    intensity: "heavy",
    totalEtaMin: 30,
    totalDistanceKm: 8.5,
    fare: 8000,
    co2Grams: 85,
    discomfortScore: 17.5,
    segments: [
      { mode:"walking",      label:"Walk to Blok M MRT",    distanceM:300,  durationMin:4,  isWalking:true  },
      { mode:"mrt",          label:"MRT Blok M → Sudirman", distanceM:8200, durationMin:21, stops:["Blok M","Senayan","Istora","Bendungan Hilir","Setiabudi","Sudirman"] },
      { mode:"walking",      label:"Walk to destination",   distanceM:400,  durationMin:5,  isWalking:true  },
    ],
  },
  {
    title: "Blok M → Sudirman — Clear (Motorcycle)",
    origin: "Blok M",
    destination: "Sudirman",
    intensity: "none",
    totalEtaMin: 20,
    totalDistanceKm: 8.5,
    fare: 0,
    co2Grams: 553,
    discomfortScore: 0,
    segments: [
      { mode:"motorcycle", label:"Motorcycle Blok M → Sudirman", distanceM:8500, durationMin:20 },
    ],
  },
  {
    title: "Lebak Bulus → Dukuh Atas — Extreme Rain (MRT)",
    origin: "Lebak Bulus",
    destination: "Dukuh Atas",
    intensity: "extreme",
    totalEtaMin: 28,
    totalDistanceKm: 12.0,
    fare: 10000,
    co2Grams: 120,
    discomfortScore: 19.5,
    segments: [
      { mode:"walking",  label:"Walk to Lebak Bulus MRT",    distanceM:200,   durationMin:3,  isWalking:true },
      { mode:"mrt",      label:"MRT Lebak Bulus → Dukuh Atas", distanceM:12000, durationMin:22, stops:["Lebak Bulus","Fatmawati","Cipete Raya","Haji Nawi","Blok A","Blok M","Sisingamangaraja","Senayan","Istora","Bendungan Hilir","Setiabudi","Dukuh Atas"] },
      { mode:"walking",  label:"Walk to destination",        distanceM:200,   durationMin:3,  isWalking:true },
    ],
  },
  {
    title: "Tebet → Monas — Moderate Rain (TransJakarta)",
    origin: "Tebet",
    destination: "Monas",
    intensity: "moderate",
    totalEtaMin: 44,
    totalDistanceKm: 9.1,
    fare: 3500,
    co2Grams: 273,
    discomfortScore: 10.4,
    segments: [
      { mode:"walking",      label:"Walk to Tebet busway",         distanceM:480, durationMin:6,  isWalking:true },
      { mode:"transjakarta", label:"TransJakarta Tebet → Monas",   distanceM:8620, durationMin:32, stops:["Tebet","Manggarai","Pasar Rumput","Halimun","Dukuh Atas","Tosari","Bundaran HI","Sarinah","Monas"] },
    ],
  },
  {
    title: "Cengkareng → Sudirman — Heavy Rain (Car Online)",
    origin: "Cengkareng",
    destination: "Sudirman",
    intensity: "heavy",
    totalEtaMin: 65,
    totalDistanceKm: 22.4,
    fare: 61000,
    co2Grams: 3360,
    discomfortScore: 8.0,
    segments: [
      { mode:"car_online", label:"Car Online Cengkareng → Sudirman", distanceM:22400, durationMin:65 },
    ],
  },
  {
    title: "Bekasi Timur → Kota Tua — Extreme Rain (KRL Commuter)",
    origin: "Bekasi Timur",
    destination: "Kota Tua",
    intensity: "extreme",
    totalEtaMin: 62,
    totalDistanceKm: 29.8,
    fare: 4000,
    co2Grams: 298,
    discomfortScore: 14.5,
    segments: [
      { mode:"walking",  label:"Walk to Bekasi Timur KRL",   distanceM:300,   durationMin:4,  isWalking:true },
      { mode:"krl",      label:"KRL Bekasi → Kota",          distanceM:29000, durationMin:55, stops:["Bekasi Timur","Bekasi","Kranji","Cakung","Klender Baru","Buaran","Klender","Jatinegara","Manggarai","Juanda","Gondangdia","Gambir","Jayakarta","Jakarta Kota"] },
      { mode:"walking",  label:"Walk to Kota Tua",           distanceM:200,   durationMin:3,  isWalking:true },
    ],
  },
];

// ─── SVG dimensions ───────────────────────────────────────────────────────────

const SVG_W    = 900;
const SVG_H    = 280;
const PAD_L    = 40;
const PAD_R    = 40;
const TRACK_Y  = 120;  // y-center of the route track
const BAR_H    = 20;   // height of segment bars (transit)
const WALK_H   = 10;   // height of walking line
const DRAW_W   = SVG_W - PAD_L - PAD_R;

// ─── Component ────────────────────────────────────────────────────────────────

export default function RouteSVGSchematic() {
  const [selected, setSelected] = useState(0);
  const route = EXAMPLE_ROUTES[selected];

  const totalDuration = route.segments.reduce((s, seg) => s + seg.durationMin, 0);

  // Compute x positions for each segment
  type SegmentLayout = {
    seg: Segment;
    x: number;
    w: number;
  };

  const layouts: SegmentLayout[] = [];
  let cursor = PAD_L;
  for (const seg of route.segments) {
    const w = Math.max((seg.durationMin / totalDuration) * DRAW_W, 16);
    layouts.push({ seg, x: cursor, w });
    cursor += w;
  }

  const intensityColor = INTENSITY_FILL[route.intensity] ?? "#94a3b8";

  return (
    <div className="space-y-6">

      {/* Route selector */}
      <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl p-4">
        <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">Select Example Route</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {EXAMPLE_ROUTES.map((r, i) => (
            <button
              key={i}
              onClick={() => setSelected(i)}
              className={`text-left px-3 py-2 rounded-lg border text-xs transition-all ${
                selected === i
                  ? "border-blue-500/60 bg-[#0a0e1a] text-white"
                  : "border-[#1e2530] bg-[#0a0d14] text-[#64748b] hover:border-[#2a3040] hover:text-[#94a3b8]"
              }`}
            >
              <span className="font-semibold">{r.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* SVG Schematic */}
      <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl p-4 overflow-x-auto">
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          width="100%"
          style={{ minWidth: 640 }}
          aria-label={`Route schematic: ${route.title}`}
        >
          <defs>
            {/* Arrow marker */}
            <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 Z" fill="#64748b" />
            </marker>
          </defs>

          {/* Background */}
          <rect x={0} y={0} width={SVG_W} height={SVG_H} fill="#0f1117" rx={8} />

          {/* Title */}
          <text x={SVG_W / 2} y={22} textAnchor="middle" fill="#94a3b8" fontSize={11} fontWeight="600">
            {route.title}
          </text>

          {/* Intensity indicator */}
          <rect x={PAD_L} y={30} width={16} height={8} rx={2} fill={intensityColor} opacity={0.8} />
          <text x={PAD_L + 20} y={38} fill={intensityColor} fontSize={9} fontWeight="600">
            {route.intensity.toUpperCase()} RAIN
          </text>

          {/* Horizontal baseline */}
          <line
            x1={PAD_L} y1={TRACK_Y}
            x2={PAD_L + DRAW_W} y2={TRACK_Y}
            stroke="#1e2530" strokeWidth={1} strokeDasharray="4 4"
          />

          {/* Origin circle */}
          <circle cx={PAD_L} cy={TRACK_Y} r={6} fill="#1e2530" stroke="#64748b" strokeWidth={1.5} />
          <text x={PAD_L} y={TRACK_Y + 20} textAnchor="middle" fill="#94a3b8" fontSize={9} fontWeight="600">
            {route.origin.length > 10 ? route.origin.slice(0, 10) + "…" : route.origin}
          </text>

          {/* Destination circle */}
          <circle cx={PAD_L + DRAW_W} cy={TRACK_Y} r={6} fill="#1e2530" stroke="#94a3b8" strokeWidth={2} />
          <text x={PAD_L + DRAW_W} y={TRACK_Y + 20} textAnchor="middle" fill="#94a3b8" fontSize={9} fontWeight="600">
            {route.destination.length > 10 ? route.destination.slice(0, 10) + "…" : route.destination}
          </text>

          {/* Segments */}
          {layouts.map((lay, idx) => {
            const { seg, x, w } = lay;
            const color = seg.color ?? MODE_COLORS[seg.mode] ?? "#64748b";
            const midX  = x + w / 2;
            const isWalk = seg.isWalking ?? (seg.mode === "walking");
            const barH   = isWalk ? WALK_H : (seg.mode === "motorcycle" || seg.mode === "car_private" || seg.mode === "car_online" || seg.mode === "ojek" ? 14 : BAR_H);
            const barY   = TRACK_Y - barH / 2;

            return (
              <g key={idx}>
                {isWalk ? (
                  /* Walking segment — dashed line */
                  <g>
                    <line
                      x1={x} y1={TRACK_Y}
                      x2={x + w} y2={TRACK_Y}
                      stroke={color}
                      strokeWidth={barH}
                      strokeDasharray="6 4"
                      strokeLinecap="round"
                    />
                    {/* Direction arrows */}
                    {w > 40 && (
                      <line
                        x1={x + 2} y1={TRACK_Y}
                        x2={x + w - 4} y2={TRACK_Y}
                        stroke="transparent"
                        strokeWidth={1}
                        markerEnd="url(#arrow)"
                      />
                    )}
                    {/* Walking icon label */}
                    <text x={midX} y={barY - 14} textAnchor="middle" fill={color} fontSize={12}>
                      &#128694;
                    </text>
                    <text x={midX} y={barY - 4} textAnchor="middle" fill={color} fontSize={8}>
                      {seg.distanceM}m
                    </text>
                  </g>
                ) : (
                  /* Vehicle segment — solid rectangle */
                  <g>
                    <rect
                      x={x + 1} y={barY}
                      width={w - 2} height={barH}
                      rx={3}
                      fill={color}
                      opacity={0.85}
                    />
                    {/* Mode abbreviation inside bar (only if wide enough) */}
                    {w > 32 && (
                      <text x={midX} y={TRACK_Y + 4} textAnchor="middle" fill="#0f1117" fontSize={8} fontWeight="700">
                        {MODE_ABBR[seg.mode] ?? seg.mode.toUpperCase().slice(0, 4)}
                      </text>
                    )}
                    {/* Stops dots */}
                    {seg.stops && seg.stops.length > 2 && w > 60 && (
                      <g>
                        {seg.stops.slice(1, -1).map((_, si) => {
                          const spacing = w / (seg.stops!.length - 1);
                          const sx = x + spacing * (si + 1);
                          return (
                            <circle key={si} cx={sx} cy={TRACK_Y} r={2} fill="#0f1117" opacity={0.6} />
                          );
                        })}
                      </g>
                    )}
                  </g>
                )}

                {/* Duration label below track */}
                <text x={midX} y={TRACK_Y + 36} textAnchor="middle" fill="#64748b" fontSize={8}>
                  {seg.durationMin} min
                </text>

                {/* Mode label above (for non-walking, long enough) */}
                {!isWalk && w > 40 && (
                  <text x={midX} y={barY - 6} textAnchor="middle" fill={color} fontSize={8} fontWeight="600">
                    {seg.label.length > 22 ? seg.label.slice(0, 22) + "…" : seg.label}
                  </text>
                )}

                {/* Connector dots at segment boundaries */}
                {idx > 0 && (
                  <circle cx={x} cy={TRACK_Y} r={3} fill={color} opacity={0.7} />
                )}
              </g>
            );
          })}

          {/* Weather exposure strip */}
          <text x={PAD_L} y={TRACK_Y + 54} fill="#475569" fontSize={8} fontWeight="600">
            WEATHER EXPOSURE:
          </text>
          {layouts.map((lay, idx) => {
            const { seg, x, w } = lay;
            const isWalk = seg.isWalking ?? (seg.mode === "walking");
            const isOpenAir = isWalk || ["motorcycle","ojek","bicycle"].includes(seg.mode);
            const stripColor = isOpenAir ? intensityColor : "#1e2530";
            const opacity = isOpenAir ? 0.6 : 0.3;
            return (
              <rect key={idx} x={x + 1} y={TRACK_Y + 58} width={w - 2} height={8} rx={2}
                fill={stripColor} opacity={opacity} />
            );
          })}
          <text x={PAD_L + DRAW_W + 4} y={TRACK_Y + 65} fill="#475569" fontSize={7}>
            exposed
          </text>

          {/* Summary bar at bottom */}
          <rect x={PAD_L} y={SVG_H - 44} width={DRAW_W} height={36} rx={4} fill="#0a0d14" />
          <text x={PAD_L + 8} y={SVG_H - 30} fill="#94a3b8" fontSize={9} fontWeight="600">
            ETA: {route.totalEtaMin} min
          </text>
          <text x={PAD_L + 8} y={SVG_H - 18} fill="#64748b" fontSize={8}>
            {route.totalDistanceKm} km total
          </text>
          <text x={PAD_L + 130} y={SVG_H - 30} fill="#94a3b8" fontSize={9} fontWeight="600">
            Cost: Rp {route.fare.toLocaleString()}
          </text>
          <text x={PAD_L + 130} y={SVG_H - 18} fill="#64748b" fontSize={8}>
            IDR
          </text>
          <text x={PAD_L + 270} y={SVG_H - 30} fill="#94a3b8" fontSize={9} fontWeight="600">
            CO2: {route.co2Grams} g
          </text>
          <text x={PAD_L + 270} y={SVG_H - 18} fill="#64748b" fontSize={8}>
            grams
          </text>
          <text x={PAD_L + 400} y={SVG_H - 30} fill="#94a3b8" fontSize={9} fontWeight="600">
            Discomfort: {route.discomfortScore} pts
          </text>
          <text x={PAD_L + 400} y={SVG_H - 18} fill="#64748b" fontSize={8}>
            W-MPTRS score
          </text>
          <text x={PAD_L + 560} y={SVG_H - 30} fill={intensityColor} fontSize={9} fontWeight="600">
            Intensity: {route.intensity}
          </text>
          <text x={PAD_L + 560} y={SVG_H - 18} fill="#475569" fontSize={8}>
            BMKG class
          </text>
        </svg>
      </div>

      {/* Segment legend */}
      <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl p-4">
        <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">Segments — {route.title}</p>
        <div className="space-y-2">
          {route.segments.map((seg, i) => {
            const color = seg.color ?? MODE_COLORS[seg.mode] ?? "#64748b";
            const isWalk = seg.isWalking ?? seg.mode === "walking";
            return (
              <div key={i} className="flex items-start gap-3">
                <div className="flex items-center gap-2 w-40 shrink-0">
                  {isWalk ? (
                    <div className="w-8 h-2 rounded" style={{ borderTop:`2px dashed ${color}` }} />
                  ) : (
                    <div className="w-8 h-3 rounded" style={{ backgroundColor: color, opacity: 0.85 }} />
                  )}
                  <span className="text-[10px] font-semibold" style={{ color }}>{MODE_ABBR[seg.mode] ?? seg.mode.toUpperCase()}</span>
                </div>
                <div className="flex-1">
                  <p className="text-[10px] text-[#94a3b8]">{seg.label}</p>
                  {seg.stops && seg.stops.length > 0 && (
                    <p className="text-[9px] text-[#475569] mt-0.5">{seg.stops.join(" → ")}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] font-mono text-white">{seg.durationMin} min</p>
                  <p className="text-[9px] text-[#475569]">{seg.distanceM >= 1000 ? `${(seg.distanceM / 1000).toFixed(1)} km` : `${seg.distanceM} m`}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mode color legend */}
      <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl p-4">
        <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">Mode Color Legend</p>
        <div className="flex flex-wrap gap-3">
          {Object.entries(MODE_COLORS).map(([mode, color]) => (
            <div key={mode} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
              <span className="text-[10px] text-[#64748b] capitalize">{mode.replace("_"," ")}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-[#1e2530]">
          <p className="text-[10px] text-[#475569]">
            <span className="text-[#94a3b8]">Dashed segments</span> = walking exposure.{" "}
            <span className="text-[#94a3b8]">Stop dots</span> = intermediate stations.{" "}
            <span className="text-[#94a3b8]">Weather strip</span> = open-air exposure per segment colored by intensity.
          </p>
        </div>
      </div>
    </div>
  );
}
