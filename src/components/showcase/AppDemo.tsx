"use client";

import dynamic from "next/dynamic";
import axios from "axios";
import { motion, AnimatePresence } from "motion/react";
import { useState, useEffect, useCallback } from "react";
import {
  CloudRain, Cloud, Sun, Zap, MapPin, Navigation,
  Bus, Train, Wind, PersonStanding, Car, Bike,
  ArrowRight, AlertTriangle, ThumbsUp, RefreshCw,
  Clock, Route, Gauge, Database, ChevronDown, ChevronUp,
  FlaskConical, History, CheckCircle2, ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useAppStore, type AppStore } from "@/lib/store";
import { scoreRoute, buildRecommendationText, suggestModalShift } from "@/lib/routing/discomfort";
import type {
  Coordinates, WeatherData, RouteOption, RainfallIntensity, TransportMode,
} from "@/types";

// ── dynamic import — Leaflet can't SSR ──────────────────────────────────────
const AppMap = dynamic(() => import("./AppMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-slate-900/60">
      <span className="text-slate-500 text-sm animate-pulse">Initialising map…</span>
    </div>
  ),
});

// ── constants ────────────────────────────────────────────────────────────────

const PRESETS: Record<string, Coordinates> = {
  "Monas": { lat: -6.1753, lng: 106.8272 },
  "Bundaran HI": { lat: -6.1944, lng: 106.8229 },
  "Dukuh Atas": { lat: -6.2014, lng: 106.8229 },
  "Sudirman": { lat: -6.2087, lng: 106.8182 },
  "Blok M": { lat: -6.2442, lng: 106.7973 },
  "Kota Tua": { lat: -6.1378, lng: 106.8135 },
  "Tebet": { lat: -6.2338, lng: 106.8555 },
  "Kelapa Gading": { lat: -6.1684, lng: 106.9036 },
  "Lebak Bulus": { lat: -6.3194, lng: 106.7741 },
  "Tanjung Priok": { lat: -6.1089, lng: 106.8791 },
};

const INTENSITY_META: Record<RainfallIntensity, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  none:     { label: "Cerah / Clear",          icon: <Sun size={14} />,       color: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/20" },
  light:    { label: "Hujan Ringan / Light",    icon: <Cloud size={14} />,     color: "text-sky-400",    bg: "bg-sky-500/10 border-sky-500/20" },
  moderate: { label: "Hujan Sedang / Moderate", icon: <CloudRain size={14} />, color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/20" },
  heavy:    { label: "Hujan Lebat / Heavy",     icon: <CloudRain size={14} />, color: "text-indigo-400", bg: "bg-indigo-500/10 border-indigo-500/20" },
  extreme:  { label: "Hujan Ekstrem / Extreme", icon: <Zap size={14} />,       color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
};

const MODE_ICON: Record<TransportMode, React.ReactNode> = {
  motorcycle:  <Wind size={14} />,
  walking:     <PersonStanding size={14} />,
  transjakarta: <Bus size={14} />,
  mrt:         <Train size={14} />,
  lrt:         <Train size={14} />,
  car:         <Car size={14} />,
  bicycle:     <Bike size={14} />,
};

const SIM_INTENSITIES: RainfallIntensity[] = ["none", "light", "moderate", "heavy", "extreme"];

const SIM_PRESETS: Record<RainfallIntensity, { windSpeedKmh: number; humidityPct: number }> = {
  none:     { windSpeedKmh: 5,  humidityPct: 70 },
  light:    { windSpeedKmh: 12, humidityPct: 85 },
  moderate: { windSpeedKmh: 22, humidityPct: 90 },
  heavy:    { windSpeedKmh: 35, humidityPct: 95 },
  extreme:  { windSpeedKmh: 55, humidityPct: 98 },
};

// ── types ────────────────────────────────────────────────────────────────────

interface HistoryEntry {
  id: string;
  originLat: number; originLng: number;
  destinationLat: number; destinationLng: number;
  chosenMode: string;
  weatherIntensity: string;
  discomfortScore: number;
  routeLabel: string;
  createdAt: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(m: number) { return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`; }
function fmtTime(s: number) {
  const min = Math.round(s / 60);
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min} min`;
}
function scoreColor(n: number) {
  if (n <= 3)  return "text-emerald-400";
  if (n <= 12) return "text-yellow-400";
  if (n <= 25) return "text-orange-400";
  return "text-red-400";
}

// ── main component ───────────────────────────────────────────────────────────

export default function AppDemo() {
  const store = useAppStore();
  const {
    origin, destination, weather, routes, selectedRoute, simulation,
    setOrigin, setDestination, setWeather, setRoutes, setSelectedRoute,
    setSimulation, setLoading, setError, isLoading, error, reset,
  } = store;

  const [showBreakdown, setShowBreakdown]   = useState(false);
  const [showStorePanel, setShowStorePanel] = useState(false);
  const [history, setHistory]               = useState<HistoryEntry[]>([]);
  const [saving, setSaving]                 = useState(false);
  const [saved, setSaved]                   = useState(false);

  // ── active intensity (sim overrides real) ───────────────────────────────
  const activeIntensity: RainfallIntensity =
    simulation.active ? simulation.intensity : (weather?.intensity ?? "none");

  // ── load history on mount ────────────────────────────────────────────────
  useEffect(() => {
    axios.get<HistoryEntry[]>("/api/history?limit=5")
      .then((r) => setHistory(r.data))
      .catch(() => {});
  }, [saved]);

  // ── find routes ──────────────────────────────────────────────────────────
  const findRoutes = useCallback(async () => {
    if (!origin || !destination) return;
    setLoading(true);
    setError(null);
    setRoutes([]);
    setSelectedRoute(null);
    setSaved(false);

    // retry helper — OSRM public servers are sometimes slow
    async function fetchWithRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
      for (let i = 0; i < tries; i++) {
        try { return await fn(); } catch (e) {
          if (i === tries - 1) throw e;
          await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
        }
      }
      throw new Error("unreachable");
    }

    try {
      const [weatherRes, routesRes] = await Promise.all([
        fetchWithRetry(() =>
          axios.get<WeatherData>(`/api/weather?lat=${origin.lat}&lng=${origin.lng}${
            simulation.active ? `&simulate=${simulation.intensity}` : ""
          }`)
        ),
        fetchWithRetry(() =>
          axios.post<{
            fastest: RouteOption;
            weatherAware: RouteOption;
            shouldShift: boolean;
            shiftReason: string;
          }>("/api/routes", {
            origin,
            destination,
            weatherIntensity: simulation.active ? simulation.intensity : "none",
          })
        ),
      ]);

      setWeather(weatherRes.data);

      // Re-score with actual intensity + real weather factors on the client
      const intensity = simulation.active ? simulation.intensity : weatherRes.data.intensity;
      const windSpeedKmh = simulation.active
        ? simulation.windSpeedKmh
        : (weatherRes.data.windSpeedKmh ?? 0);
      const humidityPct = simulation.active
        ? simulation.humidityPct
        : (weatherRes.data.humidityPct ?? 80);
      const { fastest, weatherAware } = routesRes.data;

      const { totalScore: fs, breakdown: fb } = scoreRoute(fastest.segments, intensity, windSpeedKmh, humidityPct);
      const { totalScore: ws, breakdown: wb } = scoreRoute(weatherAware.segments, intensity, windSpeedKmh, humidityPct);

      const scoredFastest: RouteOption = {
        ...fastest,
        discomfortScore: fs,
        discomfortBreakdown: fb,
        recommendation: buildRecommendationText({ ...fastest, discomfortScore: fs, discomfortBreakdown: fb }, intensity),
      };
      const scoredWeatherAware: RouteOption = {
        ...weatherAware,
        discomfortScore: ws,
        discomfortBreakdown: wb,
        recommendation: buildRecommendationText({ ...weatherAware, discomfortScore: ws, discomfortBreakdown: wb }, intensity),
      };

      setRoutes([scoredFastest, scoredWeatherAware]);

      // Auto-select recommended
      const { shouldShift } = suggestModalShift(scoredFastest, scoredWeatherAware, intensity);
      setSelectedRoute(shouldShift ? "weather_aware" : "fastest");
    } catch (e: unknown) {
      const msg = axios.isAxiosError(e) ? e.response?.data?.error ?? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [origin, destination, simulation, setLoading, setError, setRoutes, setSelectedRoute, setWeather]);

  // ── save history ─────────────────────────────────────────────────────────
  const saveHistory = useCallback(async () => {
    if (!origin || !destination || !selectedRoute) return;
    const chosen = routes.find((r) => r.id === selectedRoute);
    if (!chosen) return;
    setSaving(true);
    try {
      await axios.post("/api/history", {
        origin, destination,
        chosenMode: chosen.segments[0]?.mode ?? "unknown",
        weatherIntensity: activeIntensity,
        discomfortScore: chosen.discomfortScore,
        routeLabel: chosen.label,
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }, [origin, destination, selectedRoute, routes, activeIntensity]);

  const fastest     = routes.find((r) => r.label === "fastest");
  const weatherAware = routes.find((r) => r.label === "weather_aware");
  const shift = fastest && weatherAware
    ? suggestModalShift(fastest, weatherAware, activeIntensity)
    : null;

  return (
    <div className="flex h-screen bg-[#0a0f1e] text-white overflow-hidden">
      {/* ── LEFT PANEL ─────────────────────────────────────────────────────── */}
      <aside className="w-[380px] shrink-0 flex flex-col border-r border-slate-800 overflow-y-auto">

        {/* Header */}
        <div className="p-4 border-b border-slate-800">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-6 bg-blue-500 rounded-full" />
            <span className="text-[10px] font-mono text-blue-400 tracking-widest uppercase">W-MPTRS</span>
            <span className="ml-auto text-[10px] font-mono text-slate-600">Jakarta · Indonesia</span>
          </div>
          <h1 className="text-base font-bold">Smart Route Finder</h1>
          <p className="text-xs text-slate-500 mt-0.5">Weather-aware multimodal navigation</p>
        </div>

        {/* Simulation bar */}
        <div className="p-3 border-b border-slate-800 bg-slate-900/40">
          <div className="flex items-center gap-2 mb-2">
            <FlaskConical size={13} className="text-violet-400" />
            <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">Simulation Mode</span>
            <button
              onClick={() => {
              if (simulation.active) {
                setSimulation(false);
              } else {
                const p = SIM_PRESETS[simulation.intensity];
                setSimulation(true, simulation.intensity, p.windSpeedKmh, p.humidityPct);
              }
            }}
              className={cn(
                "ml-auto w-9 h-5 rounded-full transition-colors relative",
                simulation.active ? "bg-violet-600" : "bg-slate-700",
              )}
            >
              <span className={cn(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all",
                simulation.active ? "left-[18px]" : "left-0.5",
              )} />
            </button>
          </div>
          <AnimatePresence>
            {simulation.active && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="flex gap-1.5 flex-wrap">
                  {SIM_INTENSITIES.map((i) => (
                    <button
                      key={i}
                      onClick={() => {
                        const p = SIM_PRESETS[i];
                        setSimulation(true, i, p.windSpeedKmh, p.humidityPct);
                      }}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-[11px] font-medium border capitalize transition-colors",
                        simulation.intensity === i
                          ? "bg-violet-600 border-violet-500 text-white"
                          : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500",
                      )}
                    >
                      {i}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Location pickers */}
        <div className="p-4 border-b border-slate-800 space-y-3">
          <LocationPicker
            label="Origin"
            icon={<MapPin size={13} className="text-emerald-400" />}
            value={origin}
            onSelect={setOrigin}
            hint="Click map or pick preset"
          />
          <LocationPicker
            label="Destination"
            icon={<Navigation size={13} className="text-red-400" />}
            value={destination}
            onSelect={setDestination}
            hint="Click map or pick preset"
          />

          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={findRoutes}
              disabled={!origin || !destination || isLoading}
            >
              {isLoading
                ? <RefreshCw size={13} className="animate-spin" />
                : <Route size={13} />}
              {isLoading ? "Fetching…" : "Find Routes"}
            </Button>
            <Button variant="ghost" size="icon" onClick={reset} title="Reset">
              <RefreshCw size={13} />
            </Button>
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-xs text-red-400 font-mono bg-red-950/30 border border-red-800/30 rounded-lg px-3 py-2"
            >
              {error}
            </motion.p>
          )}
        </div>

        {/* Weather block */}
        <AnimatePresence>
          {weather && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-4 border-b border-slate-800"
            >
              <SectionLabel icon={<CloudRain size={12} />} text="BMKG Live Weather" />
              <WeatherCard weather={weather} simulation={simulation} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Route comparison */}
        <AnimatePresence>
          {routes.length > 0 && fastest && weatherAware && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-4 border-b border-slate-800 space-y-3"
            >
              <SectionLabel icon={<Route size={12} />} text="Route Comparison" />

              <div className="grid grid-cols-2 gap-2">
                <RouteCard
                  route={fastest}
                  selected={selectedRoute === "fastest"}
                  onClick={() => setSelectedRoute("fastest")}
                  accent="orange"
                />
                <RouteCard
                  route={weatherAware}
                  selected={selectedRoute === "weather_aware"}
                  onClick={() => setSelectedRoute("weather_aware")}
                  accent="sky"
                  recommended={shift?.shouldShift ?? false}
                />
              </div>

              {/* Modal shift banner */}
              <AnimatePresence>
                {shift && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={cn(
                      "flex items-start gap-2.5 p-3 rounded-xl border text-xs",
                      shift.shouldShift
                        ? "bg-indigo-950/40 border-indigo-700/40 text-indigo-200"
                        : "bg-slate-800/40 border-slate-700/40 text-slate-400",
                    )}
                  >
                    {shift.shouldShift
                      ? <ShieldAlert size={13} className="text-indigo-400 mt-0.5 shrink-0" />
                      : <CheckCircle2 size={13} className="text-emerald-400 mt-0.5 shrink-0" />}
                    {shift.reason}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Recommendation text */}
              {selectedRoute && (
                <p className="text-xs text-slate-400 italic leading-relaxed">
                  {routes.find((r) => r.id === selectedRoute)?.recommendation}
                </p>
              )}

              {/* Discomfort breakdown toggle */}
              <button
                onClick={() => setShowBreakdown((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
              >
                <Gauge size={12} />
                Discomfort breakdown
                {showBreakdown ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>

              <AnimatePresence>
                {showBreakdown && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <DiscomfortBreakdown routes={routes} selectedRoute={selectedRoute} />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Save / saved */}
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  onClick={saveHistory}
                  disabled={saving || saved || !selectedRoute}
                >
                  {saving ? <RefreshCw size={12} className="animate-spin" /> : <Database size={12} />}
                  {saved ? "Saved to History ✓" : "Save to History"}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Route history */}
        <div className="p-4 border-b border-slate-800 space-y-2">
          <SectionLabel icon={<History size={12} />} text="Route History (DB)" />
          {history.length === 0 ? (
            <p className="text-xs text-slate-600 italic">No history yet — save a route above.</p>
          ) : (
            <div className="space-y-1.5">
              {history.map((h) => (
                <motion.div
                  key={h.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-2 text-[11px] bg-slate-800/40 rounded-lg px-3 py-2 border border-slate-700/30"
                >
                  <span className="font-mono text-slate-500 shrink-0">
                    {new Date(h.createdAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <ArrowRight size={10} className="text-slate-600 shrink-0" />
                  <span className="text-slate-300 capitalize">{h.chosenMode}</span>
                  <span className="ml-auto font-mono">
                    <span className={scoreColor(h.discomfortScore)}>{h.discomfortScore}</span>
                    <span className="text-slate-600"> pts</span>
                  </span>
                  <Badge variant="outline" className="text-[9px] py-0 px-1.5 capitalize">
                    {h.weatherIntensity}
                  </Badge>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Zustand store panel */}
        <div className="p-4">
          <button
            onClick={() => setShowStorePanel((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-slate-400 transition-colors w-full"
          >
            <Database size={12} />
            Zustand store state
            {showStorePanel ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          <AnimatePresence>
            {showStorePanel && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden mt-2"
              >
                <StorePanel store={store} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </aside>

      {/* ── RIGHT: MAP ────────────────────────────────────────────────────── */}
      <div className="flex-1 relative">
        {/* Map hint overlay */}
        {(!origin || !destination) && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
            <div className="bg-slate-900/90 backdrop-blur-sm border border-slate-700 text-xs text-slate-300 px-4 py-2 rounded-full">
              {!origin
                ? "Click map to set origin"
                : "Click map to set destination"}
            </div>
          </div>
        )}

        {/* Intensity badge overlay */}
        <div className="absolute bottom-4 right-4 z-[1000]">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeIntensity}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium backdrop-blur-sm",
                INTENSITY_META[activeIntensity].bg,
                INTENSITY_META[activeIntensity].color,
              )}
            >
              {INTENSITY_META[activeIntensity].icon}
              {INTENSITY_META[activeIntensity].label}
              {simulation.active && <span className="text-violet-400 ml-1">[SIM]</span>}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Legend */}
        {routes.length > 0 && (
          <div className="absolute top-4 right-4 z-[1000] bg-slate-900/90 backdrop-blur-sm border border-slate-700 rounded-xl p-3 text-[11px] space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-1 bg-orange-500 rounded" />
              <span className="text-slate-300">Fastest (Motorcycle)</span>
              {fastest && <span className={cn("ml-auto font-mono", scoreColor(fastest.discomfortScore))}>{fastest.discomfortScore}</span>}
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-1 bg-sky-400 rounded" />
              <span className="text-slate-300">Weather-Aware (TransJakarta)</span>
              {weatherAware && <span className={cn("ml-auto font-mono", scoreColor(weatherAware.discomfortScore))}>{weatherAware.discomfortScore}</span>}
            </div>
          </div>
        )}

        <AppMap
          origin={origin}
          destination={destination}
          routes={routes}
          selectedRoute={selectedRoute}
          intensity={activeIntensity}
          onOriginSet={setOrigin}
          onDestinationSet={setDestination}
        />
      </div>
    </div>
  );
}

// ── sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <span className="text-slate-500">{icon}</span>
      <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">{text}</span>
    </div>
  );
}

function LocationPicker({
  label, icon, value, onSelect, hint,
}: {
  label: string;
  icon: React.ReactNode;
  value: Coordinates | null;
  onSelect: (c: Coordinates) => void;
  hint: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <Label className="text-xs text-slate-400 flex items-center gap-1.5 mb-1.5">
        {icon} {label}
      </Label>
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full text-left px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/60 text-xs hover:border-slate-600 transition-colors flex items-center justify-between"
        >
          {value ? (
            <span className="text-white font-mono">{value.lat.toFixed(4)}, {value.lng.toFixed(4)}</span>
          ) : (
            <span className="text-slate-500">{hint}</span>
          )}
          <ChevronDown size={12} className="text-slate-500" />
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              className="absolute z-50 top-full mt-1 w-full bg-slate-900 border border-slate-700 rounded-xl shadow-xl overflow-hidden"
            >
              {Object.entries(PRESETS).map(([name, coords]) => (
                <button
                  key={name}
                  onClick={() => { onSelect(coords); setOpen(false); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-slate-800 transition-colors flex items-center justify-between"
                >
                  <span className="text-slate-200">{name}</span>
                  <span className="text-slate-600 font-mono text-[10px]">{coords.lat.toFixed(3)}, {coords.lng.toFixed(3)}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function WeatherCard({
  weather,
  simulation,
}: {
  weather: WeatherData;
  simulation: { active: boolean; intensity: RainfallIntensity };
}) {
  const display = simulation.active ? simulation.intensity : weather.intensity;
  const meta = INTENSITY_META[display];

  return (
    <motion.div
      key={display}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn(
        "rounded-xl border p-3 space-y-2",
        meta.bg,
      )}
    >
      <div className="flex items-center justify-between">
        <div className={cn("flex items-center gap-1.5 text-sm font-medium", meta.color)}>
          {meta.icon}
          {meta.label}
        </div>
        {simulation.active && (
          <Badge className="text-[9px] bg-violet-600/30 text-violet-300 border-violet-600/40">SIMULASI</Badge>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <p className="text-slate-500 font-mono">rainfall</p>
          <p className="text-white font-medium">{weather.rainfallMmPerHour} mm/h</p>
        </div>
        <div>
          <p className="text-slate-500 font-mono">source</p>
          <p className="text-white font-medium uppercase">{weather.source}</p>
        </div>
        {weather.windSpeedKmh !== undefined && (
          <div>
            <p className="text-slate-500 font-mono">wind</p>
            <p className="text-white font-medium">{weather.windSpeedKmh} km/h</p>
          </div>
        )}
        {weather.humidityPct !== undefined && (
          <div>
            <p className="text-slate-500 font-mono">humidity</p>
            <p className="text-white font-medium">{weather.humidityPct}%</p>
          </div>
        )}
        {weather.temperatureC !== undefined && (
          <div>
            <p className="text-slate-500 font-mono">temp</p>
            <p className="text-white font-medium">{weather.temperatureC}°C</p>
          </div>
        )}
        <div className={weather.windSpeedKmh !== undefined ? "" : "col-span-2"}>
          <p className="text-slate-500 font-mono">station</p>
          <p className="text-white truncate">{weather.description}</p>
        </div>
      </div>
    </motion.div>
  );
}

function RouteCard({
  route, selected, onClick, accent, recommended,
}: {
  route: RouteOption;
  selected: boolean;
  onClick: () => void;
  accent: "orange" | "sky";
  recommended?: boolean;
}) {
  const accentCls = {
    orange: { border: "border-orange-500/60 bg-orange-500/10", ring: "ring-orange-500/40", dot: "bg-orange-400" },
    sky:    { border: "border-sky-500/60 bg-sky-500/10",       ring: "ring-sky-500/40",    dot: "bg-sky-400" },
  }[accent];

  const primarySeg = route.segments[0];

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={cn(
        "relative w-full text-left p-3 rounded-xl border transition-all",
        selected
          ? `${accentCls.border} ring-2 ${accentCls.ring}`
          : "border-slate-700/50 bg-slate-800/40 hover:border-slate-600",
      )}
    >
      {recommended && (
        <span className="absolute -top-2 left-2 bg-emerald-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full">
          RECOMMENDED
        </span>
      )}

      <div className="flex items-center gap-1.5 mb-2">
        <div className={cn("w-1.5 h-1.5 rounded-full", accentCls.dot)} />
        <span className="text-[11px] font-semibold capitalize">
          {route.label === "fastest" ? "Fastest" : "Weather-Aware"}
        </span>
      </div>

      {primarySeg && (
        <div className="flex items-center gap-1 text-xs text-slate-400 mb-2">
          {MODE_ICON[primarySeg.mode]}
          <span className="capitalize">{primarySeg.mode}</span>
        </div>
      )}

      <div className="space-y-1 text-[11px]">
        <div className="flex items-center justify-between">
          <span className="text-slate-500 flex items-center gap-1"><Route size={10} /> dist</span>
          <span className="text-slate-200 font-mono">{fmt(route.totalDistanceMeters)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500 flex items-center gap-1"><Clock size={10} /> time</span>
          <span className="text-slate-200 font-mono">{fmtTime(route.totalDurationSeconds)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500 flex items-center gap-1"><Gauge size={10} /> score</span>
          <span className={cn("font-bold font-mono", scoreColor(route.discomfortScore))}>
            {route.discomfortScore}
          </span>
        </div>
      </div>
    </motion.button>
  );
}

function DiscomfortBreakdown({
  routes, selectedRoute,
}: {
  routes: RouteOption[];
  selectedRoute: string | null;
}) {
  const route = routes.find((r) => r.id === selectedRoute) ?? routes[0];
  if (!route) return null;

  return (
    <div className="space-y-1.5 pt-1">
      {route.discomfortBreakdown.map((b, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.05 }}
          className="bg-slate-900/60 rounded-lg p-2.5 border border-slate-700/30 text-[11px]"
        >
          <div className="flex items-center gap-1.5 mb-1">
            {MODE_ICON[b.mode]}
            <span className="capitalize font-medium">{b.mode}</span>
            <span className={cn("ml-auto font-bold font-mono", scoreColor(b.finalPenalty))}>
              {b.finalPenalty} pts
            </span>
          </div>
          <p className="text-slate-500 leading-relaxed">{b.reason}</p>
          <div className="flex gap-3 mt-1 text-slate-600 font-mono text-[10px]">
            <span>base {b.basePenalty}</span>
            <span>×{b.weatherMultiplier}</span>
            <span>= {b.finalPenalty}</span>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function StorePanel({ store }: { store: AppStore }) {
  const snap = {
    origin: store.origin ? `${store.origin.lat.toFixed(4)}, ${store.origin.lng.toFixed(4)}` : null,
    destination: store.destination ? `${store.destination.lat.toFixed(4)}, ${store.destination.lng.toFixed(4)}` : null,
    weather: store.weather ? `${store.weather.intensity} (${store.weather.source})` : null,
    routes: store.routes.length > 0 ? store.routes.map((r) => `${r.label}:${r.discomfortScore}`).join(" | ") : null,
    selectedRoute: store.selectedRoute,
    simulation: `${store.simulation.active ? "ON" : "OFF"} · ${store.simulation.intensity}`,
    isLoading: store.isLoading,
    error: store.error,
  };

  return (
    <div className="space-y-1 text-[10px] font-mono bg-slate-950/60 rounded-xl border border-slate-800 p-3">
      {Object.entries(snap).map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="text-slate-600 shrink-0 w-28">{k}</span>
          <span className={cn("truncate", v ? "text-emerald-400" : "text-slate-700")}>
            {v === null ? "null" : v === false ? "false" : v === true ? "true" : String(v)}
          </span>
        </div>
      ))}
    </div>
  );
}
