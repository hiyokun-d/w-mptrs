"use client";

import { useState, useMemo } from "react";
import {
  computeSegmentPenalty,
  scoreRoute,
  suggestModalShift,
  buildRecommendationText,
} from "@/lib/routing/discomfort";
import type {
  RainfallIntensity,
  RouteSegment,
  RouteOption,
  DiscomfortBreakdown,
} from "@/types";

// ─── Weighted composite formula ──────────────────────────────────────────────
// Final Score = (TIME_W * etaMinutes) + (WEATHER_W * discomfortScore)
// Jakarta defaults: time less elastic (traffic parity), weather very impactful
const DEFAULT_TIME_W = 0.35;
const DEFAULT_WEATHER_W = 0.65;

function compositeScore(etaSeconds: number, discomfort: number, tw: number, ww: number) {
  return tw * (etaSeconds / 60) + ww * discomfort;
}

// ─── Mock route definitions ───────────────────────────────────────────────────

const FASTEST_MOTO: RouteSegment[] = [
  { mode: "motorcycle", distanceMeters: 8500, durationSeconds: 1200, geometry: [] },
];

const WEATHER_AWARE_MRT: RouteSegment[] = [
  { mode: "walking", distanceMeters: 300, durationSeconds: 240, geometry: [] },
  { mode: "mrt", distanceMeters: 7200, durationSeconds: 1620, geometry: [] },
  { mode: "walking", distanceMeters: 400, durationSeconds: 300, geometry: [] },
];

// Scenario C — 12 km motorcycle vs TransJakarta with 650m destination walk
const FASTEST_MOTO_LONG: RouteSegment[] = [
  { mode: "motorcycle", distanceMeters: 12000, durationSeconds: 1800, geometry: [] },
];

const WEATHER_AWARE_TJ_C: RouteSegment[] = [
  { mode: "walking", distanceMeters: 280, durationSeconds: 220, geometry: [] },
  { mode: "transjakarta", distanceMeters: 11000, durationSeconds: 2400, geometry: [] },
  { mode: "walking", distanceMeters: 650, durationSeconds: 520, geometry: [] }, // destination walk >500m
];

type ScenarioKey = "A" | "B" | "C" | "custom";

interface ScenarioConfig {
  key: ScenarioKey;
  label: string;
  description: string;
  intensity: RainfallIntensity;
  wind: number;
  humidity: number;
  fastestSegments: RouteSegment[];
  awarSegments: RouteSegment[];
  // Scenario C uses split intensity: [originIntensity, destinationIntensity]
  splitIntensity?: [RainfallIntensity, RainfallIntensity];
}

const SCENARIOS: ScenarioConfig[] = [
  {
    key: "A",
    label: "Scenario A — Clear Skies",
    description:
      "No rain. Fastest route (Motorcycle) should have 0 weather penalty. Modal shift must NOT trigger.",
    intensity: "none",
    wind: 8,
    humidity: 72,
    fastestSegments: FASTEST_MOTO,
    awarSegments: WEATHER_AWARE_MRT,
  },
  {
    key: "B",
    label: "Scenario B — Heavy Rainfall (>20 mm/h)",
    description:
      "Motorcycle penalty spikes to 40×1.0=40. System MUST shift recommended badge to MRT even if ETA is 15 min longer.",
    intensity: "heavy",
    wind: 22,
    humidity: 94,
    fastestSegments: FASTEST_MOTO,
    awarSegments: WEATHER_AWARE_MRT,
  },
  {
    key: "C",
    label: "Scenario C — Localized Storm at Destination",
    description:
      "Origin (South Jakarta) is clear. Destination (Central Jakarta) has heavy rain. Last walk segment is 650m > 500m threshold — full walking penalty applies.",
    intensity: "heavy",
    wind: 18,
    humidity: 91,
    fastestSegments: FASTEST_MOTO_LONG,
    awarSegments: WEATHER_AWARE_TJ_C,
    splitIntensity: ["none", "heavy"], // origin=clear, destination=heavy
  },
];

function buildRouteOption(
  id: string,
  label: "fastest" | "weather_aware",
  segments: RouteSegment[],
  intensity: RainfallIntensity,
  wind: number,
  humidity: number,
  splitIntensity?: [RainfallIntensity, RainfallIntensity],
): RouteOption {
  let breakdown: DiscomfortBreakdown[];

  if (splitIntensity) {
    // Apply origin intensity to first half, destination intensity to last segment
    const [originInt, destInt] = splitIntensity;
    breakdown = segments.map((seg, i) => {
      const int = i === segments.length - 1 ? destInt : originInt;
      return computeSegmentPenalty(seg, int, wind, humidity);
    });
  } else {
    breakdown = segments.map((seg) =>
      computeSegmentPenalty(seg, intensity, wind, humidity),
    );
  }

  const totalScore = Math.round(breakdown.reduce((s, b) => s + b.finalPenalty, 0) * 10) / 10;
  const totalDistance = segments.reduce((s, seg) => s + seg.distanceMeters, 0);
  const totalDuration = segments.reduce((s, seg) => s + seg.durationSeconds, 0);

  const option: RouteOption = {
    id,
    label,
    segments,
    totalDistanceMeters: totalDistance,
    totalDurationSeconds: totalDuration,
    discomfortScore: totalScore,
    discomfortBreakdown: breakdown,
  };
  option.recommendation = buildRecommendationText(option, intensity);
  return option;
}

function fmt(seconds: number) {
  const m = Math.floor(seconds / 60);
  return `${m} min`;
}

function intensityColor(i: RainfallIntensity) {
  return {
    none: "text-emerald-400",
    light: "text-sky-400",
    moderate: "text-yellow-400",
    heavy: "text-orange-400",
    extreme: "text-red-500",
  }[i];
}

export default function SimulationPanel() {
  const [activeScenario, setActiveScenario] = useState<ScenarioKey>("A");
  const [customIntensity, setCustomIntensity] = useState<RainfallIntensity>("moderate");
  const [customWind, setCustomWind] = useState(15);
  const [customHumidity, setCustomHumidity] = useState(85);
  const [timeWeight, setTimeWeight] = useState(DEFAULT_TIME_W);
  const [weatherWeight, setWeatherWeight] = useState(DEFAULT_WEATHER_W);

  const scenario = useMemo<ScenarioConfig>(() => {
    if (activeScenario === "custom") {
      return {
        key: "custom",
        label: "Custom Override",
        description: "Manual weather conditions applied to South→Central Jakarta route.",
        intensity: customIntensity,
        wind: customWind,
        humidity: customHumidity,
        fastestSegments: FASTEST_MOTO,
        awarSegments: WEATHER_AWARE_MRT,
      };
    }
    return SCENARIOS.find((s) => s.key === activeScenario)!;
  }, [activeScenario, customIntensity, customWind, customHumidity]);

  const fastest = useMemo(
    () =>
      buildRouteOption(
        "fastest",
        "fastest",
        scenario.fastestSegments,
        scenario.intensity,
        scenario.wind,
        scenario.humidity,
        scenario.splitIntensity,
      ),
    [scenario],
  );

  const weatherAware = useMemo(
    () =>
      buildRouteOption(
        "weather_aware",
        "weather_aware",
        scenario.awarSegments,
        scenario.intensity,
        scenario.wind,
        scenario.humidity,
        scenario.splitIntensity,
      ),
    [scenario],
  );

  const modalShift = useMemo(
    () => suggestModalShift(fastest, weatherAware, scenario.intensity),
    [fastest, weatherAware, scenario.intensity],
  );

  const fastestComposite = compositeScore(
    fastest.totalDurationSeconds,
    fastest.discomfortScore,
    timeWeight,
    weatherWeight,
  );

  const awareComposite = compositeScore(
    weatherAware.totalDurationSeconds,
    weatherAware.discomfortScore,
    timeWeight,
    weatherWeight,
  );

  const etaDeltaMin = Math.round(
    (weatherAware.totalDurationSeconds - fastest.totalDurationSeconds) / 60,
  );

  return (
    <div className="space-y-6">
      {/* Scenario Selector */}
      <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-[#94a3b8] uppercase tracking-widest mb-4">
          Scenario Controller
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          {(["A", "B", "C", "custom"] as ScenarioKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setActiveScenario(key)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                activeScenario === key
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                  : "bg-[#1a1f2e] text-[#64748b] hover:text-[#94a3b8] hover:bg-[#1e2530]"
              }`}
            >
              {key === "custom" ? "Custom" : `Scenario ${key}`}
            </button>
          ))}
        </div>

        <div className="bg-[#0a0d14] border border-[#1e2530] rounded-lg p-4">
          <p className="text-sm font-semibold text-white mb-1">{scenario.label}</p>
          <p className="text-xs text-[#64748b] leading-relaxed">{scenario.description}</p>
        </div>

        {activeScenario === "custom" && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-[#64748b] block mb-1">Rain Intensity</label>
              <select
                value={customIntensity}
                onChange={(e) => setCustomIntensity(e.target.value as RainfallIntensity)}
                className="w-full bg-[#1a1f2e] border border-[#1e2530] rounded-lg px-3 py-2 text-sm text-white"
              >
                {["none", "light", "moderate", "heavy", "extreme"].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#64748b] block mb-1">
                Wind Speed: {customWind} km/h
              </label>
              <input
                type="range"
                min={0}
                max={60}
                value={customWind}
                onChange={(e) => setCustomWind(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-[#64748b] block mb-1">
                Humidity: {customHumidity}%
              </label>
              <input
                type="range"
                min={40}
                max={100}
                value={customHumidity}
                onChange={(e) => setCustomHumidity(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Formula Weights */}
      <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-[#94a3b8] uppercase tracking-widest mb-1">
          Composite Score Formula
        </h2>
        <p className="text-xs text-[#64748b] mb-4">
          Final Score = (Time_Weight × ETA_min) + (Weather_Weight × DiscomfortScore)
        </p>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="text-xs text-[#94a3b8] block mb-1">
              Time Weight: <span className="text-blue-400 font-mono">{timeWeight.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={timeWeight}
              onChange={(e) => {
                const tw = Number(e.target.value);
                setTimeWeight(tw);
                setWeatherWeight(Math.round((1 - tw) * 100) / 100);
              }}
              className="w-full accent-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-[#94a3b8] block mb-1">
              Weather Weight:{" "}
              <span className="text-orange-400 font-mono">{weatherWeight.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={weatherWeight}
              onChange={(e) => {
                const ww = Number(e.target.value);
                setWeatherWeight(ww);
                setTimeWeight(Math.round((1 - ww) * 100) / 100);
              }}
              className="w-full accent-orange-500"
            />
          </div>
        </div>
        <p className="text-xs text-[#475569] mt-2">
          Jakarta recommendation: Time 0.35 / Weather 0.65 — traffic parity narrows ETA
          differences; rain impact is high for open-air modes.
        </p>
      </div>

      {/* Route Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RouteCard
          route={fastest}
          composite={fastestComposite}
          isShifted={modalShift.shouldShift}
          weatherCondition={{
            intensity: scenario.intensity,
            wind: scenario.wind,
            humidity: scenario.humidity,
          }}
        />
        <RouteCard
          route={weatherAware}
          composite={awareComposite}
          isShifted={modalShift.shouldShift}
          weatherCondition={{
            intensity: scenario.intensity,
            wind: scenario.wind,
            humidity: scenario.humidity,
          }}
        />
      </div>

      {/* Modal Shift Verdict */}
      <div
        className={`border rounded-xl p-5 ${
          modalShift.shouldShift
            ? "bg-orange-950/30 border-orange-500/40"
            : "bg-emerald-950/30 border-emerald-500/40"
        }`}
      >
        <div className="flex items-start gap-3">
          <span className="text-2xl">{modalShift.shouldShift ? "⚡" : "✅"}</span>
          <div>
            <p
              className={`text-sm font-bold mb-1 ${
                modalShift.shouldShift ? "text-orange-300" : "text-emerald-300"
              }`}
            >
              Modal Shift:{" "}
              {modalShift.shouldShift ? "RECOMMENDED (score diff ≥ 10)" : "NOT TRIGGERED"}
            </p>
            <p className="text-xs text-[#94a3b8]">{modalShift.reason}</p>
            {etaDeltaMin > 0 && (
              <p className="text-xs text-[#64748b] mt-1">
                ETA sacrifice for weather-aware route: +{etaDeltaMin} min
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Weather Condition Summary */}
      <div className="bg-[#0f1117] border border-[#1e2530] rounded-xl p-5">
        <h3 className="text-xs font-semibold text-[#94a3b8] uppercase tracking-widest mb-3">
          Active Weather Conditions
        </h3>
        <div className="flex gap-6 flex-wrap">
          <div>
            <span className="text-xs text-[#475569]">Intensity</span>
            <p className={`text-sm font-mono font-bold ${intensityColor(scenario.intensity)}`}>
              {scenario.intensity.toUpperCase()}
            </p>
          </div>
          <div>
            <span className="text-xs text-[#475569]">Wind</span>
            <p className="text-sm font-mono text-white">{scenario.wind} km/h</p>
          </div>
          <div>
            <span className="text-xs text-[#475569]">Humidity</span>
            <p className="text-sm font-mono text-white">{scenario.humidity}%</p>
          </div>
          {scenario.splitIntensity && (
            <div>
              <span className="text-xs text-[#475569]">Split Mode</span>
              <p className="text-sm font-mono text-purple-400">
                Origin: {scenario.splitIntensity[0]} / Dest: {scenario.splitIntensity[1]}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Route Card ───────────────────────────────────────────────────────────────

interface RouteCardProps {
  route: RouteOption;
  composite: number;
  isShifted: boolean;
  weatherCondition: { intensity: RainfallIntensity; wind: number; humidity: number };
}

function RouteCard({ route, composite, isShifted }: RouteCardProps) {
  const isFastest = route.label === "fastest";
  const isRecommended = isShifted ? !isFastest : isFastest;
  const primaryMode = route.segments[0]?.mode ?? "unknown";

  const modeEmoji: Record<string, string> = {
    motorcycle: "🏍️",
    mrt: "🚇",
    transjakarta: "🚌",
    lrt: "🚈",
    krl: "🚆",
    walking: "🚶",
    car: "🚗",
    bicycle: "🚲",
  };

  return (
    <div
      className={`relative bg-[#0f1117] border rounded-xl p-5 transition-all ${
        isRecommended
          ? "border-blue-500/60 shadow-lg shadow-blue-500/10"
          : "border-[#1e2530]"
      }`}
    >
      {isRecommended && (
        <span className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-widest bg-blue-600 text-white px-2 py-0.5 rounded-full">
          Recommended
        </span>
      )}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">{modeEmoji[primaryMode] ?? "🛤️"}</span>
        <div>
          <p className="text-sm font-bold text-white capitalize">
            {route.label === "fastest" ? "Fastest Route" : "Weather-Aware Route"}
          </p>
          <p className="text-xs text-[#475569]">
            Primary: {primaryMode} •{" "}
            {route.segments.map((s) => s.mode).join(" → ")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label="ETA" value={`${Math.round(route.totalDurationSeconds / 60)} min`} />
        <Stat label="Distance" value={`${(route.totalDistanceMeters / 1000).toFixed(1)} km`} />
        <Stat
          label="Discomfort"
          value={route.discomfortScore.toString()}
          highlight={route.discomfortScore > 20}
        />
      </div>

      <div className="bg-[#0a0d14] rounded-lg p-3 mb-3">
        <p className="text-[10px] text-[#475569] uppercase tracking-widest mb-1">
          Composite Score
        </p>
        <p className="text-lg font-mono font-bold text-white">{composite.toFixed(1)}</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] text-[#475569] uppercase tracking-widest">
          Penalty Breakdown
        </p>
        {route.discomfortBreakdown.map((b, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <span
              className={`font-mono font-bold shrink-0 ${
                b.finalPenalty > 15
                  ? "text-red-400"
                  : b.finalPenalty > 5
                    ? "text-yellow-400"
                    : "text-emerald-400"
              }`}
            >
              +{b.finalPenalty}
            </span>
            <span className="text-[#64748b] leading-tight">{b.reason}</span>
          </div>
        ))}
      </div>

      {route.recommendation && (
        <div className="mt-3 pt-3 border-t border-[#1e2530]">
          <p className="text-[10px] text-[#475569] uppercase tracking-widest mb-1">Reasoning</p>
          <p className="text-xs text-[#94a3b8] italic leading-relaxed">{route.recommendation}</p>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-[#0a0d14] rounded-lg p-2 text-center">
      <p className="text-[10px] text-[#475569] uppercase tracking-widest">{label}</p>
      <p className={`text-sm font-mono font-bold mt-0.5 ${highlight ? "text-red-400" : "text-white"}`}>
        {value}
      </p>
    </div>
  );
}
