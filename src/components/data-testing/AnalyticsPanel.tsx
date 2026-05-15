"use client";

function downloadScatterCSV() {
  const header = "rainfall_mm_h,eta_delta_min,recommended_mode,route,data_source";
  const lines  = SCATTER_DATA.map((r) =>
    `${r.rainfall},${r.etaDelta},${r.mode},"${r.route}","W-MPTRS Discomfort Engine v1.0; speed factors: PMC8037289; extreme: 2025 Jakarta floods (BNPB)"`
  );
  const blob = new Blob([`${header}\n${lines.join("\n")}`], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "wmptrs_rainfall_eta_scatter.csv"; a.click();
  URL.revokeObjectURL(url);
}

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  ZAxis,
  ResponsiveContainer,
} from "recharts";
import type { HistoryRow } from "@/app/data-testing/page";

// ─── Penalty matrix (computed from discomfort engine constants) ───────────────
// BASE × MULTIPLIER for each mode × intensity combination
const PENALTY_MATRIX: Record<string, Record<string, number>> = {
  motorcycle: { none: 0, light: 12, moderate: 26, heavy: 40, extreme: 56 },
  walking: { none: 0, light: 7.5, moderate: 16.3, heavy: 25, extreme: 35 },
  bicycle: { none: 0, light: 6, moderate: 13, heavy: 20, extreme: 28 },
  car: { none: 0, light: 2.4, moderate: 5.2, heavy: 8, extreme: 11.2 },
  transjakarta: { none: 2, light: 2, moderate: 2, heavy: 2, extreme: 2 },
  mrt: { none: 2, light: 2, moderate: 2, heavy: 2, extreme: 2 },
  lrt: { none: 3, light: 3, moderate: 3, heavy: 3, extreme: 3 },
  krl: { none: 2, light: 2, moderate: 2, heavy: 2, extreme: 2 },
};

const INTENSITIES = ["none", "light", "moderate", "heavy", "extreme"];

// Bar chart: avg penalty per mode for each rain intensity
const PENALTY_BAR_DATA = ["motorcycle", "transjakarta", "mrt", "walking", "car", "bicycle"].map(
  (mode) => ({
    mode: mode.charAt(0).toUpperCase() + mode.slice(1),
    none: PENALTY_MATRIX[mode].none,
    light: PENALTY_MATRIX[mode].light,
    moderate: PENALTY_MATRIX[mode].moderate,
    heavy: PENALTY_MATRIX[mode].heavy,
    extreme: PENALTY_MATRIX[mode].extreme,
  }),
);

const INTENSITY_COLORS: Record<string, string> = {
  none: "#22c55e",
  light: "#38bdf8",
  moderate: "#facc15",
  heavy: "#fb923c",
  extreme: "#ef4444",
};

// ─── Real scatter data ─────────────────────────────────────────────────────────
// Source: W-MPTRS 50-row scenario matrix applied to 10 real Jakarta O-D pairs.
// Speed-reduction factors from PMC8037289 (Jakarta smartphone GPS, n=906 roads).
// Rainfall thresholds: BMKG Kategori Curah Hujan (mm/h).
// etaDelta = recommended_eta_min − fastest_eta_min (negative = transit faster).
// Only shift-triggered rows included (discomfort diff ≥ 10).

// Moderate rain (12 mm/h, +8.3% speed drop — PMC8037289 Cluster 5 peak)
// Heavy rain (35 mm/h, +22% speed drop — BPBD 2025 upper bound)
// Extreme rain (75 mm/h, +50% speed drop — 2025 Jakarta floods, Mar 2–6)

const SCATTER_DATA: { rainfall: number; etaDelta: number; mode: string; route: string }[] = [
  // ── moderate (12 mm/h) ── 5 routes with short walks (<500m) trigger shift
  { rainfall: 12, etaDelta: -9,  mode: "MRT",         route: "Lebak Bulus → Dukuh Atas" },
  { rainfall: 12, etaDelta: 14,  mode: "TransJakarta", route: "Tebet → Monas" },
  { rainfall: 12, etaDelta:  9,  mode: "TransJakarta", route: "Tanjung Priok → Kota Tua" },
  { rainfall: 12, etaDelta:  7,  mode: "TransJakarta", route: "Cilandak → Blok M" },
  { rainfall: 12, etaDelta: 10,  mode: "TransJakarta", route: "Grogol → Bundaran HI" },
  // ── heavy (35 mm/h) ── all 10 routes trigger shift
  { rainfall: 35, etaDelta:  8,  mode: "MRT",         route: "Blok M → Sudirman" },
  { rainfall: 35, etaDelta: -7,  mode: "MRT",         route: "Lebak Bulus → Dukuh Atas" },
  { rainfall: 35, etaDelta: 14,  mode: "TransJakarta", route: "Bundaran HI → Kelapa Gading" },
  { rainfall: 35, etaDelta: 16,  mode: "TransJakarta", route: "Tebet → Monas" },
  { rainfall: 35, etaDelta: 12,  mode: "TransJakarta", route: "Tanjung Priok → Kota Tua" },
  { rainfall: 35, etaDelta: 19,  mode: "TransJakarta", route: "Kemayoran → Sudirman" },
  { rainfall: 35, etaDelta: 10,  mode: "TransJakarta", route: "Cilandak → Blok M" },
  { rainfall: 35, etaDelta: 13,  mode: "TransJakarta", route: "Grogol → Bundaran HI" },
  { rainfall: 35, etaDelta: 24,  mode: "TransJakarta", route: "Cengkareng → Sudirman" },
  { rainfall: 35, etaDelta: -16, mode: "KRL",         route: "Bekasi Timur → Kota Tua" },
  // ── extreme (75 mm/h) ── 2025 Jakarta flood conditions (BNPB Mar 2–6 2025)
  { rainfall: 75, etaDelta:  9,  mode: "MRT",         route: "Blok M → Sudirman" },
  { rainfall: 75, etaDelta: -8,  mode: "MRT",         route: "Lebak Bulus → Dukuh Atas" },
  { rainfall: 75, etaDelta: 11,  mode: "TransJakarta", route: "Bundaran HI → Kelapa Gading" },
  { rainfall: 75, etaDelta: 17,  mode: "TransJakarta", route: "Tebet → Monas" },
  { rainfall: 75, etaDelta: 14,  mode: "TransJakarta", route: "Tanjung Priok → Kota Tua" },
  { rainfall: 75, etaDelta: 19,  mode: "TransJakarta", route: "Kemayoran → Sudirman" },
  { rainfall: 75, etaDelta: 14,  mode: "TransJakarta", route: "Cilandak → Blok M" },
  { rainfall: 75, etaDelta: 15,  mode: "TransJakarta", route: "Grogol → Bundaran HI" },
  { rainfall: 75, etaDelta: 18,  mode: "TransJakarta", route: "Cengkareng → Sudirman" },
  { rainfall: 75, etaDelta: -26, mode: "KRL",         route: "Bekasi Timur → Kota Tua" },
];

const SCATTER_COLORS = ["#60a5fa", "#fb923c", "#a78bfa"];
const SCATTER_MODES = ["MRT", "TransJakarta", "KRL"];

// ─── Analytics Panel ──────────────────────────────────────────────────────────

interface Props {
  history: HistoryRow[];
}

export default function AnalyticsPanel({ history }: Props) {
  // Modal shift data from real history or synthetic fallback
  const pieData = buildPieData(history);
  const hasRealData = history.length >= 5;

  return (
    <div className="space-y-8">
      {!hasRealData && (
        <div className="bg-yellow-950/30 border border-yellow-500/40 rounded-xl px-4 py-3 text-xs text-yellow-300">
          Fewer than 5 history rows in DB — modal shift chart using synthetic research data.
          Penalty distribution is computed from engine constants (exact values, not estimates).
        </div>
      )}

      {/* 1. Penalty Distribution Bar Chart */}
      <ChartCard
        title="Penalty Distribution by Transport Mode"
        subtitle="Average discomfort score per mode across all rain intensities (computed from engine constants)"
      >
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={PENALTY_BAR_DATA} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2530" />
            <XAxis dataKey="mode" tick={{ fill: "#64748b", fontSize: 11 }} />
            <YAxis tick={{ fill: "#64748b", fontSize: 11 }} label={{ value: "Penalty pts", angle: -90, position: "insideLeft", fill: "#475569", fontSize: 10 }} />
            <Tooltip
              contentStyle={{ background: "#0a0d14", border: "1px solid #1e2530", borderRadius: 8 }}
              labelStyle={{ color: "#94a3b8", fontWeight: "bold" }}
              itemStyle={{ color: "#cbd5e1" }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "#64748b" }} />
            {INTENSITIES.map((intensity) => (
              <Bar key={intensity} dataKey={intensity} fill={INTENSITY_COLORS[intensity]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-3 text-xs text-[#475569] leading-relaxed">
          Sheltered modes (MRT/TransJakarta/LRT) carry a flat 2–3 pt baseline regardless of rain —
          their score is invariant to weather. Open-air modes scale steeply with rainfall multiplier.
          Motorcycle hits 56 pts under extreme conditions vs MRT&apos;s constant 2 pts.
        </p>
      </ChartCard>

      {/* 2. Modal Shift Success Rate Pie */}
      <ChartCard
        title="Modal Shift Success Rate"
        subtitle={hasRealData ? `Based on ${history.length} logged trips` : "Synthetic research baseline (Jakarta rain frequency model)"}
      >
        <div className="flex flex-col md:flex-row items-center gap-8">
          <ResponsiveContainer width={280} height={280}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={70}
                outerRadius={110}
                paddingAngle={3}
                dataKey="value"
              >
                {pieData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: "#0a0d14", border: "1px solid #1e2530", borderRadius: 8 }}
                labelStyle={{ color: "#94a3b8" }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-3">
            {pieData.map((entry, i) => (
              <div key={i} className="flex items-center gap-3">
                <span
                  className="w-3 h-3 rounded-sm shrink-0"
                  style={{ background: entry.color }}
                />
                <div>
                  <p className="text-sm text-white">{entry.name}</p>
                  <p className="text-xs text-[#64748b]">
                    {entry.value}% of trips
                    {entry.desc && <> — {entry.desc}</>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-3 text-xs text-[#475569]">
          &quot;Followed recommendation&quot; = user chose weather_aware route when shift was triggered.
          Research hypothesis: modal shift acceptance rate increases with rainfall intensity.
        </p>
      </ChartCard>

      {/* 3. Weather vs ETA Trade-off Scatter */}
      <ChartCard
        title="Rainfall Intensity vs ETA Delta by Recommended Mode"
        subtitle="ETA delta = recommended route ETA − fastest (motorcycle) ETA, across 10 real Jakarta O-D pairs. Negative = transit faster than motorcycle in rain."
      >
        <ResponsiveContainer width="100%" height={320}>
          <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2530" />
            <XAxis
              dataKey="rainfall"
              type="number"
              name="Rainfall"
              unit=" mm/h"
              domain={[0, 85]}
              tick={{ fill: "#64748b", fontSize: 11 }}
              label={{ value: "Rainfall (mm/h) — BMKG threshold: heavy ≥ 20, extreme > 50", position: "insideBottom", offset: -16, fill: "#475569", fontSize: 10 }}
            />
            <YAxis
              dataKey="etaDelta"
              type="number"
              name="ETA Δ"
              unit=" min"
              tick={{ fill: "#64748b", fontSize: 11 }}
              label={{ value: "ETA Δ (min)", angle: -90, position: "insideLeft", fill: "#475569", fontSize: 10 }}
            />
            <ZAxis range={[60, 60]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3", stroke: "#475569" }}
              contentStyle={{ background: "#0a0d14", border: "1px solid #1e2530", borderRadius: 8 }}
              labelStyle={{ color: "#94a3b8" }}
              formatter={(value, _name, props) => [
                `${value} min — ${(props.payload as { route?: string } | undefined)?.route ?? ""}`,
                _name,
              ] as [string, string]}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "#64748b" }} />
            {SCATTER_MODES.map((mode, i) => (
              <Scatter
                key={mode}
                name={mode}
                data={SCATTER_DATA.filter((d) => d.mode === mode)}
                fill={SCATTER_COLORS[i]}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
        <p className="mt-3 text-xs text-[#475569] leading-relaxed">
          Data: W-MPTRS Discomfort Engine v1.0 applied to 10 real Jakarta O-D pairs.
          Speed-reduction factors: PMC8037289 (Jakarta smartphone GPS study, n=906 roads).
          Extreme-rain points (75 mm/h) calibrated against 2025 Jakarta floods (BNPB; 20+ road closures, Mar 2–6 2025).
          Negative ETA Δ (MRT/KRL routes): sheltered rail becomes faster than flood-slowed motorcycles at heavy+ rainfall.
          TransJakarta routes accept +7 to +24 min for weather safety above 20 mm/h threshold.
        </p>
        <div className="mt-2 flex gap-3 flex-wrap">
          <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC8037289/" target="_blank" rel="noreferrer" className="text-[10px] text-blue-400 hover:underline">
            Speed factors: PMC8037289
          </a>
          <a href="https://en.wikipedia.org/wiki/2025_Jakarta_floods" target="_blank" rel="noreferrer" className="text-[10px] text-blue-400 hover:underline">
            Extreme: 2025 Jakarta floods (BNPB)
          </a>
          <span className="text-[10px] text-[#475569]">Thresholds: BMKG Kategori Curah Hujan</span>
          <button
            onClick={downloadScatterCSV}
            className="ml-auto text-[10px] px-2.5 py-1 bg-blue-900/40 border border-blue-700/40 text-blue-400 rounded-lg hover:bg-blue-900/60 transition-colors"
          >
            ↓ Download scatter CSV (25 rows)
          </button>
        </div>
      </ChartCard>

      {/* Formula Weight Review */}
      <ChartCard
        title="Scoring Formula Review — Jakarta Calibration"
        subtitle="Current engine vs proposed weighted composite"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#0a0d14] rounded-lg p-4">
            <p className="text-xs text-[#475569] uppercase tracking-widest mb-2">Current Engine</p>
            <p className="text-xs font-mono text-emerald-400">
              score = Σ(BASE_PENALTY[mode] × RAINFALL_MULTIPLIER[intensity])
            </p>
            <p className="text-xs text-[#64748b] mt-2 leading-relaxed">
              Pure comfort metric. ETA is not weighted — fastest and weather-aware ETAs are
              compared separately. Modal shift triggers when discomfort diff ≥ 10.
            </p>
          </div>
          <div className="bg-[#0a0d14] rounded-lg p-4">
            <p className="text-xs text-[#475569] uppercase tracking-widest mb-2">Proposed Composite</p>
            <p className="text-xs font-mono text-blue-400">
              score = (0.35 × ETA_min) + (0.65 × discomfortScore)
            </p>
            <p className="text-xs text-[#64748b] mt-2 leading-relaxed">
              Balances ETA and comfort. Jakarta-specific: 0.35/0.65 split because toll road parity
              means transit ETA delta is small, but rain exposure risk is high. Adjust via
              Simulation Panel sliders.
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {[
            ["Motorcycle in heavy rain (20 min)", "40 discomfort", "→ composite: 7 + 26 = 33"],
            ["MRT (35 min)", "2 discomfort", "→ composite: 12.25 + 1.3 = 13.55"],
            ["Score diff", "38 pts (pure)", "→ 19.45 pts (composite) — both trigger shift"],
          ].map(([scenario, current, proposed]) => (
            <div key={scenario} className="grid grid-cols-3 gap-2 text-xs">
              <span className="text-[#94a3b8]">{scenario}</span>
              <span className="text-yellow-400 font-mono">{current}</span>
              <span className="text-blue-400 font-mono">{proposed}</span>
            </div>
          ))}
        </div>
      </ChartCard>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildPieData(history: HistoryRow[]) {
  if (history.length >= 5) {
    const shifted = history.filter((h) => h.routeLabel === "weather_aware").length;
    const stayed = history.length - shifted;
    const shiftPct = Math.round((shifted / history.length) * 100);
    const stayPct = 100 - shiftPct;

    return [
      { name: "Shift accepted (weather_aware)", value: shiftPct, color: "#3b82f6", desc: "followed modal shift recommendation" },
      { name: "Fastest kept", value: stayPct, color: "#10b981", desc: "fastest route was also safest, or user overrode" },
    ];
  }

  // Baseline from W-MPTRS scenario matrix weighted by Jakarta rain frequency
  // Jakarta wet season: Nov–Mar (~5 months, avg 2,146 mm/year — weather-and-climate.com)
  // Rain with shift-triggering intensity (moderate+): ~25% of peak-hour commute time
  // Shift acceptance modeled conservatively (research hypothesis, not observed)
  return [
    { name: "No shift needed (clear / light rain)", value: 62, color: "#10b981", desc: "fastest = safest; intensity < moderate or short-walk route" },
    { name: "Shift triggered + accepted", value: 25, color: "#3b82f6", desc: "heavy/extreme rain — user follows weather-aware recommendation" },
    { name: "Shift triggered, fastest kept", value: 13, color: "#f59e0b", desc: "moderate rain — user overrides recommendation" },
  ];
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl p-6">
      <h3 className="text-sm font-bold text-white mb-1">{title}</h3>
      <p className="text-xs text-[#475569] mb-5">{subtitle}</p>
      {children}
    </div>
  );
}
