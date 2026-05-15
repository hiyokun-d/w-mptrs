"use client";

import { useState } from "react";
import type { HistoryRow } from "@/app/data-testing/page";

// ─── Schema Analysis ──────────────────────────────────────────────────────────

interface FieldSpec {
  name: string;
  type: string;
  required: boolean;
  presentInDb: boolean;
  notes?: string;
}

const FIELD_SPECS: FieldSpec[] = [
  { name: "id", type: "uuid", required: true, presentInDb: true },
  { name: "originLat / originLng", type: "float", required: true, presentInDb: true },
  { name: "destinationLat / destinationLng", type: "float", required: true, presentInDb: true },
  { name: "chosenMode", type: "string", required: true, presentInDb: true },
  { name: "weatherIntensity", type: "string", required: true, presentInDb: true, notes: "maps to weather_condition in prompt" },
  { name: "discomfortScore", type: "float", required: true, presentInDb: true, notes: "maps to discomfort_score_applied" },
  { name: "routeLabel", type: "string (fastest|weather_aware)", required: true, presentInDb: true, notes: "encodes original_fastest_mode vs recommended_mode" },
  { name: "createdAt", type: "timestamp", required: true, presentInDb: true },
  // Missing fields
  { name: "rainfallMmPerHour", type: "float", required: true, presentInDb: false, notes: "rainfall_intensity (float) — not yet stored" },
  { name: "originalFastestMode", type: "string", required: true, presentInDb: false, notes: "explicit fastest mode at time of routing" },
  { name: "recommendedMode", type: "string", required: true, presentInDb: false, notes: "what the engine recommended" },
  { name: "userFollowedRecommendation", type: "boolean", required: true, presentInDb: false, notes: "user_choice — did they accept the shift?" },
  { name: "windSpeedKmh", type: "float", required: false, presentInDb: false, notes: "needed for multi-factor replay" },
  { name: "humidityPct", type: "float", required: false, presentInDb: false, notes: "needed for multi-factor replay" },
];

// SQL to add missing columns
const ALTER_SQL = `-- Add missing research-critical columns to routes_history
ALTER TABLE routes_history
  ADD COLUMN IF NOT EXISTS rainfall_mm_per_hour   FLOAT,
  ADD COLUMN IF NOT EXISTS original_fastest_mode  TEXT,
  ADD COLUMN IF NOT EXISTS recommended_mode       TEXT,
  ADD COLUMN IF NOT EXISTS user_followed_recommendation BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS wind_speed_kmh         FLOAT,
  ADD COLUMN IF NOT EXISTS humidity_pct           FLOAT;

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_rh_weather
  ON routes_history (weather_intensity, rainfall_mm_per_hour);

CREATE INDEX IF NOT EXISTS idx_rh_shift
  ON routes_history (original_fastest_mode, recommended_mode, user_followed_recommendation);`;

// Supabase analytics view SQL
const VIEW_SQL = `-- Supabase View: aggregated routing logs for research analytics
CREATE OR REPLACE VIEW analytics_routing_summary AS
SELECT
  weather_intensity,
  chosen_mode,
  route_label,
  COUNT(*)                                                          AS trip_count,
  ROUND(AVG(discomfort_score)::numeric, 2)                         AS avg_discomfort_score,
  ROUND(AVG(rainfall_mm_per_hour)::numeric, 2)                     AS avg_rainfall_mm,
  -- Modal shift rate: proportion that chose weather_aware
  ROUND(
    (SUM(CASE WHEN route_label = 'weather_aware' THEN 1 ELSE 0 END)::float
      / NULLIF(COUNT(*), 0) * 100)::numeric,
    1
  )                                                                 AS shift_rate_pct,
  -- Acceptance rate: of triggered shifts, how many were followed
  ROUND(
    (SUM(CASE WHEN user_followed_recommendation = TRUE THEN 1 ELSE 0 END)::float
      / NULLIF(SUM(CASE WHEN route_label = 'weather_aware' THEN 1 ELSE 0 END), 0) * 100)::numeric,
    1
  )                                                                 AS acceptance_rate_pct,
  MIN(discomfort_score)                                             AS min_discomfort,
  MAX(discomfort_score)                                             AS max_discomfort
FROM routes_history
GROUP BY weather_intensity, chosen_mode, route_label
ORDER BY weather_intensity, trip_count DESC;

-- View: weather vs ETA trade-off (for scatter plot feed)
CREATE OR REPLACE VIEW analytics_eta_tradeoff AS
SELECT
  r1.id,
  r1.weather_intensity,
  r1.rainfall_mm_per_hour,
  r1.discomfort_score                                              AS fastest_score,
  r1.chosen_mode                                                   AS fastest_mode,
  r1.recommended_mode,
  r1.user_followed_recommendation
FROM routes_history r1
WHERE r1.rainfall_mm_per_hour IS NOT NULL
ORDER BY r1.rainfall_mm_per_hour;`;

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  history: HistoryRow[];
}

export default function DataIntegrityPanel({ history }: Props) {
  const [activeTab, setActiveTab] = useState<"schema" | "alter" | "view" | "sample">("schema");

  const present = FIELD_SPECS.filter((f) => f.presentInDb).length;
  const total = FIELD_SPECS.length;
  const completeness = Math.round((present / total) * 100);

  return (
    <div className="space-y-6">
      {/* Score badge */}
      <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl p-5 flex items-center gap-5">
        <div
          className={`w-20 h-20 rounded-full flex items-center justify-center text-xl font-bold font-mono shrink-0 ${
            completeness >= 80
              ? "bg-emerald-950 text-emerald-400 border-2 border-emerald-500"
              : completeness >= 60
                ? "bg-yellow-950 text-yellow-400 border-2 border-yellow-500"
                : "bg-red-950 text-red-400 border-2 border-red-500"
          }`}
        >
          {completeness}%
        </div>
        <div>
          <p className="text-base font-bold text-white mb-0.5">
            Data Readiness Score: {present}/{total} fields present
          </p>
          <p className="text-xs text-[#64748b] leading-relaxed">
            Current schema covers core routing data. Missing 4 research-critical columns
            (rainfall float, original/recommended mode, user choice) needed for academic analysis.
          </p>
          {history.length > 0 && (
            <p className="text-xs text-blue-400 mt-1">{history.length} rows in routes_history</p>
          )}
        </div>
      </div>

      {/* Tab Nav */}
      <div className="flex gap-2 border-b border-[#1e2530] pb-0">
        {(["schema", "alter", "view", "sample"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-medium rounded-t-lg transition-all ${
              activeTab === tab
                ? "bg-[#0f1117] border border-b-0 border-[#1e2530] text-white"
                : "text-[#475569] hover:text-[#94a3b8]"
            }`}
          >
            {
              { schema: "Field Analysis", alter: "Migration SQL", view: "Analytics View SQL", sample: "Recent Rows" }[
                tab
              ]
            }
          </button>
        ))}
      </div>

      {activeTab === "schema" && (
        <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#1e2530]">
                <th className="px-4 py-3 text-left text-[#475569] uppercase tracking-widest font-medium">
                  Field
                </th>
                <th className="px-4 py-3 text-left text-[#475569] uppercase tracking-widest font-medium">
                  Type
                </th>
                <th className="px-4 py-3 text-center text-[#475569] uppercase tracking-widest font-medium">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-[#475569] uppercase tracking-widest font-medium hidden md:table-cell">
                  Notes
                </th>
              </tr>
            </thead>
            <tbody>
              {FIELD_SPECS.map((field) => (
                <tr key={field.name} className="border-b border-[#1e2530] last:border-0">
                  <td className="px-4 py-2.5 font-mono text-white">{field.name}</td>
                  <td className="px-4 py-2.5 text-[#64748b]">{field.type}</td>
                  <td className="px-4 py-2.5 text-center">
                    {field.presentInDb ? (
                      <span className="text-emerald-400">✓ Present</span>
                    ) : field.required ? (
                      <span className="text-red-400">✗ Missing*</span>
                    ) : (
                      <span className="text-yellow-500">○ Optional</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-[#475569] hidden md:table-cell">
                    {field.notes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 bg-[#0a0d14] text-[10px] text-[#475569]">
            * Required for academic research completeness. Add via migration SQL tab.
          </div>
        </div>
      )}

      {activeTab === "alter" && (
        <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl p-5">
          <p className="text-xs text-[#64748b] mb-3">
            Run in Supabase SQL Editor to add missing columns. Uses{" "}
            <code className="text-blue-400">IF NOT EXISTS</code> — safe to re-run.
          </p>
          <SqlBlock code={ALTER_SQL} />
          <div className="mt-4 space-y-2 text-xs text-[#475569]">
            <p className="font-semibold text-[#94a3b8]">After migration, update POST /api/history to include:</p>
            {[
              "rainfallMmPerHour: weather.rainfallMmPerHour",
              "originalFastestMode: fastest.segments[0].mode",
              "recommendedMode: weatherAware.segments.find(s => !walking)?.mode",
              "userFollowedRecommendation: chosenMode === recommendedMode",
              "windSpeedKmh: weather.windSpeedKmh",
              "humidityPct: weather.humidityPct",
            ].map((line) => (
              <p key={line} className="font-mono text-emerald-400/80">
                + {line}
              </p>
            ))}
          </div>
        </div>
      )}

      {activeTab === "view" && (
        <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl p-5">
          <p className="text-xs text-[#64748b] mb-3">
            Two views: <code className="text-blue-400">analytics_routing_summary</code> (aggregated
            by mode + weather) and <code className="text-blue-400">analytics_eta_tradeoff</code>{" "}
            (row-level for scatter plot). Run in Supabase SQL Editor.
          </p>
          <SqlBlock code={VIEW_SQL} />
          <div className="mt-4 bg-[#0a0d14] rounded-lg p-3 text-xs text-[#475569]">
            <p className="font-semibold text-[#94a3b8] mb-1">Usage in Next.js (server component):</p>
            <pre className="font-mono text-emerald-400/80 leading-relaxed whitespace-pre-wrap">
              {`const summary = await db.$queryRaw\`
  SELECT * FROM analytics_routing_summary
  WHERE weather_intensity != 'none'
  ORDER BY avg_discomfort_score DESC
\`;`}
            </pre>
          </div>
        </div>
      )}

      {activeTab === "sample" && (
        <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl overflow-hidden">
          {history.length === 0 ? (
            <div className="px-6 py-10 text-center text-[#475569] text-sm">
              No rows in routes_history yet. Use the main app to log some routes.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1e2530]">
                  {["ID", "Mode", "Weather", "Score", "Label", "Created"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[#475569] uppercase tracking-widest font-medium"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 15).map((row) => (
                  <tr key={row.id} className="border-b border-[#1e2530] last:border-0">
                    <td className="px-4 py-2.5 font-mono text-[#475569] truncate max-w-[80px]">
                      {row.id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-2.5 text-white">{row.chosenMode}</td>
                    <td className="px-4 py-2.5">
                      <IntensityBadge intensity={row.weatherIntensity} />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-white">{row.discomfortScore}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          row.routeLabel === "weather_aware"
                            ? "bg-blue-900/50 text-blue-300"
                            : "bg-[#1e2530] text-[#64748b]"
                        }`}
                      >
                        {row.routeLabel}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[#475569]">
                      {new Date(row.createdAt).toLocaleDateString("id-ID")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function SqlBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="absolute top-3 right-3 text-[10px] px-2 py-1 bg-[#1e2530] hover:bg-[#2a3040] text-[#64748b] rounded transition-all"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
      <pre className="bg-[#0a0d14] border border-[#1e2530] rounded-lg p-4 text-xs font-mono text-emerald-400/90 leading-relaxed overflow-x-auto whitespace-pre">
        {code}
      </pre>
    </div>
  );
}

function IntensityBadge({ intensity }: { intensity: string }) {
  const colors: Record<string, string> = {
    none: "bg-emerald-900/50 text-emerald-300",
    light: "bg-sky-900/50 text-sky-300",
    moderate: "bg-yellow-900/50 text-yellow-300",
    heavy: "bg-orange-900/50 text-orange-300",
    extreme: "bg-red-900/50 text-red-300",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${colors[intensity] ?? "bg-[#1e2530] text-[#64748b]"}`}>
      {intensity}
    </span>
  );
}
