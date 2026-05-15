"use client";

import dynamic from "next/dynamic";
import axios from "axios";
import type { TransitStopDot, NearbyStopDot } from "./AppMap";
import { motion, AnimatePresence } from "motion/react";
import { useState, useEffect, useCallback } from "react";
import {
  CloudRain, Cloud, Sun, Zap, MapPin, Navigation,
  Bus, Train, Wind, PersonStanding, Car, Bike,
  ArrowRight, RefreshCw,
  Clock, Route, Gauge, Database, ChevronDown, ChevronUp,
  FlaskConical, History, CheckCircle2, ShieldAlert, Layers,
  Footprints, ArrowDownToLine, ArrowUpFromLine, ChevronsRight,
  LayoutList, X, Search, Banknote, Timer, AlarmClock,
} from "lucide-react";
import type { RouteSegment } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useAppStore, type AppStore } from "@/lib/store";
import { scoreRoute, buildRecommendationText, suggestModalShift } from "@/lib/routing/discomfort";
import type {
  Coordinates, WeatherData, RouteOption, RainfallIntensity, TransportMode, TransitPlan,
} from "@/types";

// ── dynamic import — Leaflet can't SSR ──────────────────────────────────────
import ShowcaseResearchView from "./ShowcaseResearchView";

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
  krl:         <Train size={14} />,
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
function fmtRp(idr: number) {
  if (idr === 0) return "—";
  return `Rp ${idr.toLocaleString("id-ID")}`;
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

  const [viewMode, setViewMode]             = useState<"app" | "research">("app");
  const [showBreakdown, setShowBreakdown]   = useState(false);
  const [showStorePanel, setShowStorePanel] = useState(false);
  const [history, setHistory]               = useState<HistoryEntry[]>([]);
  const [saving, setSaving]                 = useState(false);
  const [saved, setSaved]                   = useState(false);
  const [showTransit, setShowTransit]       = useState(false);
  const [transitStops, setTransitStops]     = useState<TransitStopDot[]>([]);
  const [transitLoading, setTransitLoading] = useState(false);
  const [showRoutesBrowser, setShowRoutesBrowser] = useState(false);
  const [transitPlans, setTransitPlans]     = useState<TransitPlan[]>([]);
  const [activePlanId, setActivePlanId]     = useState<string | null>(null);
  const [activePlanSegs, setActivePlanSegs] = useState<RouteSegment[] | null>(null);
  const [fetchingPlan, setFetchingPlan]     = useState(false);
  const [nearbyStops, setNearbyStops]       = useState<NearbyStopDot[]>([]);
  const [nearbyLoading, setNearbyLoading]   = useState(false);

  // ── active intensity (sim overrides real) ───────────────────────────────
  const activeIntensity: RainfallIntensity =
    simulation.active ? simulation.intensity : (weather?.intensity ?? "none");

  // ── load history on mount ────────────────────────────────────────────────
  useEffect(() => {
    axios.get<HistoryEntry[]>("/api/history?limit=5")
      .then((r) => setHistory(r.data))
      .catch(() => {});
  }, [saved]);

  // ── fetch nearby stops whenever origin changes ───────────────────────────
  useEffect(() => {
    if (!origin) { setNearbyStops([]); return; }
    setNearbyLoading(true);
    axios.get<{ stops: NearbyStopDot[] }>(
      `/api/transit/nearby?lat=${origin.lat}&lng=${origin.lng}&radius=700`,
    )
      .then((r) => setNearbyStops(r.data.stops))
      .catch(() => setNearbyStops([]))
      .finally(() => setNearbyLoading(false));
  }, [origin]);

  // ── lazy-load transit stops on first toggle ───────────────────────────────
  useEffect(() => {
    if (!showTransit || transitStops.length > 0) return;
    setTransitLoading(true);
    axios.get<{ stops: TransitStopDot[] }>("/api/transit?types=krl,mrt,lrt")
      .then((r) => setTransitStops(r.data.stops))
      .catch(() => {})
      .finally(() => setTransitLoading(false));
  }, [showTransit, transitStops.length]);

  // ── find routes ──────────────────────────────────────────────────────────
  const findRoutes = useCallback(async () => {
    if (!origin || !destination) return;
    setLoading(true);
    setError(null);
    setRoutes([]);
    setSelectedRoute(null);
    setSaved(false);
    setTransitPlans([]);
    setActivePlanId(null);
    setActivePlanSegs(null);

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
            transitPlans: TransitPlan[];
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

      // Transit plans from API
      const plans = routesRes.data.transitPlans ?? [];
      setTransitPlans(plans);
      if (plans.length > 0) {
        setActivePlanId(plans[0].id);
      }

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

  const fastest      = routes.find((r) => r.label === "fastest");
  const weatherAware = routes.find((r) => r.label === "weather_aware");
  const shift = fastest && weatherAware
    ? suggestModalShift(fastest, weatherAware, activeIntensity)
    : null;

  // Handler: user picks an alternative transit plan
  const selectTransitPlan = useCallback(async (plan: TransitPlan) => {
    setActivePlanId(plan.id);
    if (plan.rank === 1) {
      // Already have primary segments in weatherAware — no extra fetch
      setActivePlanSegs(null);
      return;
    }
    setFetchingPlan(true);
    try {
      const res = await axios.post<{ segments: RouteSegment[] }>("/api/transit/plan", {
        origin, dest: destination,
        routeId:     plan.id.split("|")[0],
        boardStopId: plan.boardStop.id,
        alightStopId: plan.alightStop.id,
      });
      setActivePlanSegs(res.data.segments);
    } catch {
      setActivePlanSegs(null);
    } finally {
      setFetchingPlan(false);
    }
  }, [origin, destination]);

  // Which segments drive the transit itinerary + map
  const activePlan      = transitPlans.find((p) => p.id === activePlanId) ?? null;
  const displaySegments = activePlanSegs ?? weatherAware?.segments ?? [];

  // Extract board/alight stops from active transit plan (or selected weather-aware segments)
  const transitSegment = displaySegments.find((s) => s.transitLine);
  const boardStop  = transitSegment?.boardStop  ?? activePlan?.boardStop  ?? null;
  const alightStop = transitSegment?.alightStop ?? activePlan?.alightStop ?? null;

  return (
    <div className="flex h-screen bg-[#0a0f1e] text-white overflow-hidden">
      {/* ── LEFT PANEL ─────────────────────────────────────────────────────── */}
      <aside className="w-[380px] shrink-0 flex flex-col border-r border-slate-800 overflow-y-auto">

        {/* Header */}
        <div className="p-4 border-b border-slate-800">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-6 bg-blue-500 rounded-full" />
            <span className="text-[10px] font-mono text-blue-400 tracking-widest uppercase">W-MPTRS</span>
            <button
              onClick={() => setViewMode("research")}
              className="ml-auto text-[10px] px-2.5 py-1 rounded-full bg-blue-900/40 border border-blue-700/40 text-blue-400 hover:bg-blue-900/70 transition-colors font-medium"
            >
              Research Data →
            </button>
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

        {/* Nearby transit stops */}
        <AnimatePresence>
          {origin && (nearbyLoading || nearbyStops.length > 0) && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-4 border-b border-slate-800"
            >
              <NearbyTransit stops={nearbyStops} loading={nearbyLoading} />
            </motion.div>
          )}
        </AnimatePresence>

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

              {/* Walk-to-station guidance — shown above selector when plan active */}
              {activePlan && (
                <WalkToStationCard
                  plan={activePlan}
                  segments={displaySegments}
                  intensity={activeIntensity}
                />
              )}

              {/* Transit plan selector — shown when plans are available */}
              {transitPlans.length > 0 && (
                <TransitSelector
                  plans={transitPlans}
                  activePlanId={activePlanId}
                  onSelect={selectTransitPlan}
                  fetchingPlan={fetchingPlan}
                  intensity={activeIntensity}
                />
              )}

              {/* Transit itinerary — driven by active plan segments */}
              {(weatherAware?.hasTransitPlan || activePlanSegs) && (
                <TransitItinerary segments={displaySegments} />
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
        {/* Top-center status badge */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
          <AnimatePresence mode="wait">
            {/* 1 — loading / rerouting */}
            {isLoading && origin && destination && (
              <motion.div
                key="loading"
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                transition={{ duration: 0.18 }}
                className="flex items-center gap-2 bg-violet-950/90 backdrop-blur-sm border border-violet-700/60 text-violet-200 text-xs px-4 py-2 rounded-full shadow-lg"
              >
                <RefreshCw size={12} className="animate-spin shrink-0" />
                <span>Searching transit routes…</span>
              </motion.div>
            )}

            {/* 2 — no transit found */}
            {!isLoading && routes.length > 0 && transitPlans.length === 0 && (
              <motion.div
                key="no-transit"
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                transition={{ duration: 0.18 }}
                className="flex items-center gap-2 bg-slate-900/90 backdrop-blur-sm border border-slate-600/60 text-slate-400 text-xs px-4 py-2 rounded-full shadow-lg"
              >
                <Bus size={12} className="shrink-0" />
                <span>No transit stops within range — showing road route only</span>
              </motion.div>
            )}

            {/* 3 — transit found (brief confirmation) */}
            {!isLoading && transitPlans.length > 0 && (
              <motion.div
                key="transit-found"
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                transition={{ duration: 0.18 }}
                className="flex items-center gap-2 bg-emerald-950/80 backdrop-blur-sm border border-emerald-700/50 text-emerald-300 text-xs px-4 py-2 rounded-full shadow-lg"
              >
                <CheckCircle2 size={12} className="shrink-0" />
                <span>{transitPlans.length} transit option{transitPlans.length > 1 ? "s" : ""} found</span>
              </motion.div>
            )}

            {/* 4 — pin placement hint (no loading, no routes yet) */}
            {!isLoading && routes.length === 0 && (!origin || !destination) && (
              <motion.div
                key="hint"
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                transition={{ duration: 0.18 }}
                className="bg-slate-900/90 backdrop-blur-sm border border-slate-700 text-xs text-slate-300 px-4 py-2 rounded-full"
              >
                {!origin ? "Click map to set origin" : "Click map to set destination"}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Routes browser drawer */}
        <AnimatePresence>
          {showRoutesBrowser && (
            <motion.div
              key="routes-browser"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="absolute inset-y-0 right-0 z-[1001] w-full max-w-md bg-[#0a0f1e]/97 backdrop-blur-md border-l border-slate-700 flex flex-col"
            >
              <TransitRoutesBrowser onClose={() => setShowRoutesBrowser(false)} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Transit network toggle */}
        <div className="absolute bottom-4 left-4 z-[1000] flex flex-col gap-2">
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => setShowTransit((v) => !v)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium backdrop-blur-sm transition-colors",
                showTransit
                  ? "bg-slate-800/90 border-slate-600 text-white"
                  : "bg-slate-900/70 border-slate-700/60 text-slate-400 hover:border-slate-600",
              )}
            >
              <Layers size={12} />
              {transitLoading ? "Loading…" : "Transit Network"}
            </button>
            <button
              onClick={() => setShowRoutesBrowser((v) => !v)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium backdrop-blur-sm transition-colors",
                showRoutesBrowser
                  ? "bg-sky-800/80 border-sky-600 text-white"
                  : "bg-slate-900/70 border-slate-700/60 text-slate-400 hover:border-slate-600",
              )}
            >
              <LayoutList size={12} />
              Browse Lines
            </button>
          </div>
          {showTransit && transitStops.length > 0 && (
            <div className="bg-slate-900/90 backdrop-blur-sm border border-slate-700 rounded-xl px-3 py-2 text-[10px] space-y-1">
              {(["krl", "mrt", "lrt"] as const).map((t) => {
                const count = transitStops.filter((s) => s.type === t).length;
                const color = { krl: "#3b82f6", mrt: "#ef4444", lrt: "#10b981" }[t];
                return (
                  <div key={t} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                    <span className="uppercase font-mono text-slate-400">{t}</span>
                    <span className="ml-auto text-slate-500">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

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
            {fastest && (
              <div className="flex items-center gap-2">
                <div className="w-8 h-1 bg-orange-500 rounded" />
                <span className="text-slate-300 capitalize">
                  Fastest · {fastest.segments[0]?.mode ?? "—"}
                </span>
                <span className={cn("ml-auto font-mono font-bold", scoreColor(fastest.discomfortScore))}>
                  {fastest.discomfortScore}
                </span>
              </div>
            )}
            {weatherAware && (
              <div className="flex items-center gap-2">
                <div className="w-8 h-1 bg-sky-400 rounded" />
                <span className="text-slate-300 capitalize">
                  Weather-Aware · {weatherAware.segments.map((s) => s.mode).filter((m, i, a) => a.indexOf(m) === i).join("+")}
                </span>
                <span className={cn("ml-auto font-mono font-bold", scoreColor(weatherAware.discomfortScore))}>
                  {weatherAware.discomfortScore}
                </span>
              </div>
            )}
            <div className="border-t border-slate-700/50 pt-1.5 flex gap-3 text-slate-600 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block"/>KRL</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block"/>MRT</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"/>LRT</span>
            </div>
          </div>
        )}

        <AppMap
          origin={origin}
          destination={destination}
          routes={activePlanSegs && weatherAware
            ? routes.map((r) =>
                r.label === "weather_aware"
                  ? { ...r, segments: activePlanSegs }
                  : r,
              )
            : routes}
          selectedRoute={selectedRoute}
          intensity={activeIntensity}
          onOriginSet={setOrigin}
          onDestinationSet={setDestination}
          transitStops={transitStops}
          showTransit={showTransit}
          boardStop={boardStop}
          alightStop={alightStop}
          nearbyOriginStops={routes.length === 0 ? nearbyStops : []}
        />
      </div>

      {/* ── RESEARCH OVERLAY ─────────────────────────────────────────────── */}
      {viewMode === "research" && (
        <div className="absolute inset-0 z-50 bg-[#060810] flex flex-col">
          <ShowcaseResearchView onClose={() => setViewMode("app")} />
        </div>
      )}
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

const MODE_TRANSIT_ICON: Record<string, React.ReactNode> = {
  walking:      <Footprints size={13} className="text-slate-400" />,
  transjakarta: <Bus   size={13} className="text-amber-400" />,
  krl:          <Train size={13} className="text-blue-400" />,
  mrt:          <Train size={13} className="text-red-400" />,
  lrt:          <Train size={13} className="text-emerald-400" />,
};
const MODE_LABEL: Record<string, string> = {
  transjakarta: "TransJakarta",
  krl: "KRL Commuterline",
  mrt: "MRT Jakarta",
  lrt: "LRT",
};

function TransitItinerary({ segments }: { segments: RouteSegment[] }) {
  const totalMin = Math.round(segments.reduce((s, seg) => s + seg.durationSeconds, 0) / 60);
  const totalWalkM = segments
    .filter((s) => s.mode === "walking")
    .reduce((s, seg) => s + seg.distanceMeters, 0);

  return (
    <div className="rounded-xl border border-slate-700/50 overflow-hidden text-[11px]">
      {/* Header */}
      <div className="px-3 py-2 bg-slate-800/60 border-b border-slate-700/40 flex items-center gap-1.5">
        <ChevronsRight size={12} className="text-sky-400" />
        <span className="font-mono text-slate-400 uppercase tracking-wider text-[10px]">Step-by-Step</span>
        <div className="ml-auto flex items-center gap-2 text-[10px] font-mono text-slate-500">
          <span><Clock size={9} className="inline mr-0.5" />{totalMin} min</span>
          {totalWalkM > 0 && <span><Footprints size={9} className="inline mr-0.5" />{Math.round(totalWalkM)}m walk</span>}
        </div>
      </div>

      {/* Steps */}
      <div className="relative">
        {/* Vertical connector line */}
        <div className="absolute left-[26px] top-3 bottom-3 w-px bg-slate-700/50" />

        {segments.map((seg, i) => {
          const isWalk    = seg.mode === "walking";
          const isFirst   = i === 0;
          const isLast    = i === segments.length - 1;
          const dir       = isWalk ? compassDir(seg.geometry as [number, number][]) : null;

          return (
            <div key={i} className="flex gap-3 px-3 py-2.5 relative">
              {/* Step icon bubble */}
              <div className={cn(
                "shrink-0 w-6 h-6 rounded-full flex items-center justify-center z-10 mt-0.5",
                isWalk && seg.distanceMeters === 0
                  ? "bg-purple-900/60 border border-purple-700/60"
                  : isWalk
                  ? "bg-slate-700 border border-slate-600"
                  : "bg-sky-900/60 border border-sky-700/60",
              )}>
                {seg.distanceMeters === 0 && isWalk
                  ? <ChevronsRight size={11} className="text-purple-400" />
                  : MODE_TRANSIT_ICON[seg.mode] ?? <Bus size={11} />}
              </div>

              <div className="flex-1 min-w-0 pb-1">
                {/* Transfer step (0m walk) */}
                {isWalk && seg.distanceMeters === 0 ? (
                  <div className="bg-purple-950/30 border border-purple-800/30 rounded-lg px-2.5 py-2">
                    <p className="text-purple-300 font-medium text-[11px]">{seg.instruction ?? "Transfer"}</p>
                    <p className="text-[10px] text-purple-400/70 mt-0.5">Change platform · ~2 min</p>
                  </div>
                ) : isWalk ? (
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-slate-200 font-medium">
                        {seg.instruction ?? (isFirst ? "Walk to stop" : "Walk to destination")}
                      </p>
                      {dir && (
                        <span className="text-[9px] font-mono bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded-full shrink-0">
                          {dir}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] font-mono text-slate-500">
                      <span className="text-slate-300 font-semibold">{Math.round(seg.distanceMeters)}m</span>
                      <span>·</span>
                      <span>~{Math.max(1, Math.round(seg.durationSeconds / 60))} min</span>
                      {seg.distanceMeters > 400 && (
                        <span className="text-orange-400/80 flex items-center gap-0.5">
                          <ShieldAlert size={9} /> long walk
                        </span>
                      )}
                    </div>
                  </div>
                ) : seg.transitLine ? (
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-slate-100 font-bold">{seg.transitLine.shortName}</span>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-300">{MODE_LABEL[seg.mode] ?? seg.mode.toUpperCase()}</span>
                    </div>
                    <p className="text-slate-500 text-[10px] truncate mt-0.5 mb-1.5">{seg.transitLine.longName}</p>

                    <div className="bg-slate-900/50 rounded-lg border border-slate-700/30 p-2 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-slate-300">
                        <ArrowUpFromLine size={10} className="text-emerald-400 shrink-0" />
                        <span className="text-[10px]">Board at</span>
                        <span className="text-emerald-300 font-medium truncate">{seg.boardStop?.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-500 text-[10px] pl-4">
                        <span>{seg.stopCount} stop{(seg.stopCount ?? 0) > 1 ? "s" : ""}</span>
                        <span>·</span>
                        <span>~{Math.round(seg.durationSeconds / 60)} min ride</span>
                        <span>·</span>
                        <span className="text-sky-400/80">🛡 sheltered</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-300">
                        <ArrowDownToLine size={10} className="text-red-400 shrink-0" />
                        <span className="text-[10px]">Alight at</span>
                        <span className="text-red-300 font-medium truncate">{seg.alightStop?.name}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-400">{seg.instruction ?? seg.mode}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Walk-to-Station Guidance Card ────────────────────────────────────────────

const TYPE_BG: Record<string, string> = {
  mrt:          "bg-red-950/40 border-red-800/40",
  lrt:          "bg-emerald-950/40 border-emerald-800/40",
  krl:          "bg-blue-950/40 border-blue-800/40",
  transjakarta: "bg-amber-950/40 border-amber-800/40",
};
const TYPE_TEXT: Record<string, string> = {
  mrt: "text-red-300", lrt: "text-emerald-300", krl: "text-blue-300", transjakarta: "text-amber-300",
};
const TYPE_DOT: Record<string, string> = {
  mrt: "bg-red-400", lrt: "bg-emerald-400", krl: "bg-blue-400", transjakarta: "bg-amber-400",
};

function WalkToStationCard({
  plan, segments, intensity,
}: {
  plan: TransitPlan;
  segments: RouteSegment[];
  intensity: RainfallIntensity;
}) {
  const walkSeg   = segments.find((s) => s.mode === "walking" && (s.instruction?.toLowerCase().includes("walk to") || s.instruction?.toLowerCase().includes("walk")));
  const alightSeg = [...segments].reverse().find((s) => s.mode === "walking");

  const bg   = TYPE_BG[plan.type]   ?? "bg-slate-800/60 border-slate-700/40";
  const txt  = TYPE_TEXT[plan.type] ?? "text-slate-300";
  const dot  = TYPE_DOT[plan.type]  ?? "bg-slate-400";
  const isRainy = intensity === "heavy" || intensity === "extreme";

  const boardDir = walkSeg ? compassDir(walkSeg.geometry as [number, number][]) : null;
  const boardM   = walkSeg ? Math.round(walkSeg.distanceMeters) : Math.round(plan.walkToBoard.distanceMeters);
  const boardMin = walkSeg
    ? Math.max(1, Math.round(walkSeg.durationSeconds / 60))
    : Math.max(1, Math.round(plan.walkToBoard.durationSeconds / 60));

  const alightM   = alightSeg && alightSeg !== walkSeg
    ? Math.round(alightSeg.distanceMeters)
    : Math.round(plan.walkFromAlight.distanceMeters);
  const alightMin = alightSeg && alightSeg !== walkSeg
    ? Math.max(1, Math.round(alightSeg.durationSeconds / 60))
    : Math.max(1, Math.round(plan.walkFromAlight.durationSeconds / 60));

  return (
    <div className={`rounded-xl border overflow-hidden text-[11px] ${bg}`}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-1.5">
        <Footprints size={11} className="text-slate-400 shrink-0" />
        <span className="font-mono text-slate-400 uppercase tracking-wider text-[10px]">Your Journey</span>
        {isRainy && (
          <span className="ml-auto text-[9px] font-mono bg-orange-800/40 text-orange-300 border border-orange-700/40 px-1.5 py-0.5 rounded-full">
            Rain active
          </span>
        )}
      </div>

      <div className="p-3 space-y-2.5">
        {/* Step 1 — walk to board */}
        <div className="flex gap-2.5 items-start">
          <div className="w-5 h-5 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center shrink-0 text-[9px] font-bold text-slate-300 mt-0.5">1</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-slate-200 font-semibold">Walk to board</span>
              {boardDir && (
                <span className="text-[9px] font-mono bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded-full">{boardDir}</span>
              )}
              {boardM > 0 && isRainy && (
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full border ${
                  boardM <= 300 ? "bg-emerald-900/40 text-emerald-300 border-emerald-700/40" :
                  boardM <= 600 ? "bg-yellow-900/40 text-yellow-300 border-yellow-700/40" :
                  "bg-orange-900/40 text-orange-300 border-orange-700/40"
                }`}>
                  {boardM <= 300 ? "Short walk ✓" : boardM <= 600 ? "Moderate walk" : "Long walk ⚠"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <div className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
              <span className={`font-semibold truncate ${txt}`}>{plan.boardStop.name}</span>
            </div>
            <p className="text-slate-500 font-mono text-[10px] mt-0.5">
              {boardM}m · ~{boardMin} min walk
            </p>
          </div>
        </div>

        {/* Connector */}
        <div className="ml-2.5 flex items-center gap-2">
          <div className="w-px h-4 bg-slate-700 ml-[9px]" />
          <div className="flex items-center gap-1.5 ml-2 text-[10px] text-slate-500">
            {plan.lines.map((l) => (
              <span key={l.routeId} className={cn(
                "px-2 py-0.5 rounded-full border font-mono font-bold text-[9px]",
                TYPE_BG[l.type] ?? "bg-slate-700 border-slate-600",
                TYPE_TEXT[l.type] ?? "text-slate-300",
              )}>
                {l.type === "transjakarta" ? "TJ" : l.type.toUpperCase()} {l.shortName}
              </span>
            ))}
            <span>·</span>
            <span>{Math.round(plan.transitDurationSeconds / 60)} min ride</span>
            <span>·</span>
            <span className="text-sky-400/80">🛡 sheltered</span>
          </div>
        </div>

        {/* Transfer (if any) */}
        {plan.transferStop && (
          <>
            <div className="ml-2.5 flex items-center gap-2">
              <div className="w-px h-4 bg-slate-700 ml-[9px]" />
            </div>
            <div className="flex gap-2.5 items-start">
              <div className="w-5 h-5 rounded-full bg-purple-900/60 border border-purple-700/60 flex items-center justify-center shrink-0 text-[9px] font-bold text-purple-300 mt-0.5">⇄</div>
              <div className="flex-1">
                <p className="text-purple-300 font-medium">Transfer at</p>
                <p className="text-purple-400/80 font-semibold truncate">{plan.transferStop.name}</p>
                <p className="text-slate-500 text-[10px]">Change platform · ~2 min</p>
              </div>
            </div>
          </>
        )}

        {/* Connector */}
        <div className="ml-2.5 flex items-center gap-2">
          <div className="w-px h-4 bg-slate-700 ml-[9px]" />
        </div>

        {/* Step 2 — alight + walk to dest */}
        <div className="flex gap-2.5 items-start">
          <div className="w-5 h-5 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center shrink-0 text-[9px] font-bold text-slate-300 mt-0.5">2</div>
          <div className="flex-1 min-w-0">
            <span className="text-slate-200 font-semibold">Alight + walk to destination</span>
            <div className="flex items-center gap-1.5 mt-1">
              <div className="w-2 h-2 rounded-full shrink-0 bg-red-400" />
              <span className="text-red-300 font-semibold truncate">{plan.alightStop.name}</span>
            </div>
            {alightM > 0 && (
              <p className="text-slate-500 font-mono text-[10px] mt-0.5">
                {alightM}m · ~{alightMin} min walk to destination
              </p>
            )}
          </div>
        </div>

        {/* Total summary */}
        <div className="mt-1 pt-2 border-t border-white/5 space-y-1.5">
          <div className="flex items-center gap-3 text-[10px] font-mono">
            <span className="text-slate-300 font-semibold">{Math.round(plan.totalDurationSeconds / 60)} min total</span>
            <span className="text-slate-600">·</span>
            <span className={plan.shelteredPct >= 80 ? "text-emerald-400" : plan.shelteredPct >= 60 ? "text-yellow-400" : "text-orange-400"}>
              {plan.shelteredPct}% sheltered
            </span>
            <span className="text-slate-600">·</span>
            <span className={plan.rainExposureMinutes <= 3 ? "text-emerald-400" : plan.rainExposureMinutes <= 6 ? "text-yellow-400" : "text-orange-400"}>
              {plan.rainExposureMinutes <= 0 ? "no rain exp." : `~${plan.rainExposureMinutes} min rain`}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono flex-wrap">
            {plan.fareEstimateIdr > 0 && (
              <span className="flex items-center gap-1 text-emerald-300 font-semibold">
                <Banknote size={10} />
                {fmtRp(plan.fareEstimateIdr)}
              </span>
            )}
            {plan.frequency > 0 && (
              <span className="flex items-center gap-1 text-slate-400">
                <Timer size={10} />
                every ~{plan.frequency} min
              </span>
            )}
            {plan.operatingHours && (
              <span className="flex items-center gap-1 text-slate-400">
                <AlarmClock size={10} />
                {plan.operatingHours}
              </span>
            )}
          </div>
          {plan.fareNote && (
            <p className="text-[9px] text-slate-600 font-mono leading-relaxed">{plan.fareNote}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Nearby Transit ───────────────────────────────────────────────────────────

const NEARBY_TYPE_COLOR: Record<string, string> = {
  mrt:          "#ef4444",
  lrt:          "#10b981",
  krl:          "#3b82f6",
  transjakarta: "#f59e0b",
};
const NEARBY_TYPE_LABEL: Record<string, string> = {
  mrt: "MRT Jakarta", lrt: "LRT", krl: "KRL Commuterline", transjakarta: "TransJakarta BRT",
};

function NearbyTransit({ stops, loading }: { stops: NearbyStopDot[]; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? stops : stops.slice(0, 3);

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <MapPin size={12} className="text-emerald-400" />
        <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Nearby Transit</span>
        {loading && <RefreshCw size={10} className="animate-spin text-slate-600 ml-1" />}
        {!loading && stops.length > 0 && (
          <span className="ml-auto text-[10px] font-mono text-slate-600">{stops.length} stop{stops.length > 1 ? "s" : ""} ≤700m</span>
        )}
      </div>

      {!loading && stops.length === 0 && (
        <p className="text-xs text-slate-600 italic">No transit stops within 700m of origin.</p>
      )}

      <div className="space-y-1.5">
        {visible.map((s) => {
          const color = NEARBY_TYPE_COLOR[s.type] ?? "#94a3b8";
          return (
            <div
              key={s.id}
              className="flex items-center gap-2.5 bg-slate-800/40 border border-slate-700/30 rounded-lg px-2.5 py-2"
            >
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-white font-medium truncate">{s.name}</p>
                <p className="text-[10px] font-mono" style={{ color }}>{NEARBY_TYPE_LABEL[s.type] ?? s.type}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[11px] text-slate-300 font-mono">{s.distanceMeters}m</p>
                <p className="text-[10px] text-slate-500 font-mono">~{s.walkMinutes} min</p>
              </div>
            </div>
          );
        })}
      </div>

      {stops.length > 3 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-[10px] text-slate-600 hover:text-slate-400 flex items-center gap-1 transition-colors"
        >
          {expanded
            ? <><ChevronUp size={10} /> Show less</>
            : <><ChevronDown size={10} /> {stops.length - 3} more stop{stops.length - 3 > 1 ? "s" : ""}</>}
        </button>
      )}
    </div>
  );
}

// ── Bearing helper ────────────────────────────────────────────────────────────

function compassDir(geometry: [number, number][]): string | null {
  if (geometry.length < 2) return null;
  const [lng1, lat1] = geometry[0];
  const [lng2, lat2] = geometry[1];
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const lat1R = lat1 * Math.PI / 180;
  const lat2R = lat2 * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
  const angle = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(angle / 45) % 8];
}

// ── Transit Plan Selector ────────────────────────────────────────────────────

const PLAN_TYPE_COLOR: Record<string, { badge: string; dot: string; text: string }> = {
  mrt:          { badge: "bg-red-500/20 border-red-500/40 text-red-300",          dot: "bg-red-400",     text: "text-red-300" },
  lrt:          { badge: "bg-emerald-500/20 border-emerald-500/40 text-emerald-300", dot: "bg-emerald-400", text: "text-emerald-300" },
  krl:          { badge: "bg-blue-500/20 border-blue-500/40 text-blue-300",       dot: "bg-blue-400",    text: "text-blue-300" },
  transjakarta: { badge: "bg-amber-500/20 border-amber-500/40 text-amber-300",    dot: "bg-amber-400",   text: "text-amber-300" },
};
const PLAN_TYPE_LABEL: Record<string, string> = {
  mrt: "MRT Jakarta", lrt: "LRT", krl: "KRL Commuterline", transjakarta: "TransJakarta",
};

function shelterBar(pct: number) {
  const color = pct >= 90 ? "bg-emerald-500" : pct >= 70 ? "bg-yellow-500" : "bg-orange-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-slate-400 w-7 text-right">{pct}%</span>
    </div>
  );
}

type TransitSort = "recommended" | "fastest" | "safest" | "cheapest";

function sortPlans(plans: TransitPlan[], sort: TransitSort): TransitPlan[] {
  const sorted = [...plans];
  if (sort === "fastest")  sorted.sort((a, b) => a.totalDurationSeconds - b.totalDurationSeconds);
  if (sort === "safest")   sorted.sort((a, b) => b.shelteredPct - a.shelteredPct || a.rainExposureMinutes - b.rainExposureMinutes);
  if (sort === "cheapest") sorted.sort((a, b) => a.fareEstimateIdr - b.fareEstimateIdr || a.totalDurationSeconds - b.totalDurationSeconds);
  // "recommended" keeps server-side rank order
  return sorted.map((p, i) => ({ ...p, rank: i + 1 }));
}

function TransitSelector({
  plans,
  activePlanId,
  onSelect,
  fetchingPlan,
  intensity,
}: {
  plans: TransitPlan[];
  activePlanId: string | null;
  onSelect: (plan: TransitPlan) => void;
  fetchingPlan: boolean;
  intensity: RainfallIntensity;
}) {
  const [sort, setSort] = useState<TransitSort>(
    intensity === "heavy" || intensity === "extreme" ? "safest" : "recommended",
  );

  const displayed = sortPlans(plans, sort);
  const isRainy = intensity === "heavy" || intensity === "extreme";

  return (
    <div className="rounded-xl border border-slate-700/50 overflow-hidden text-[11px]">
      {/* Header */}
      <div className="px-3 py-2 bg-slate-800/60 border-b border-slate-700/40 flex items-center gap-1.5">
        <Bus size={12} className="text-sky-400" />
        <span className="font-mono text-slate-400 uppercase tracking-wider text-[10px]">Transit Options</span>
        <span className="ml-auto bg-slate-700 text-slate-400 text-[9px] px-1.5 py-0.5 rounded-full font-mono">{plans.length}</span>
      </div>

      {/* Sort tabs */}
      <div className="px-3 py-2 border-b border-slate-800/60 flex gap-1.5 flex-wrap">
        {(["recommended", "fastest", "safest", "cheapest"] as TransitSort[]).map((s) => (
          <button
            key={s}
            onClick={() => setSort(s)}
            className={cn(
              "px-2.5 py-1 rounded-lg text-[10px] font-medium border capitalize transition-colors",
              sort === s
                ? s === "safest"   ? "bg-emerald-700/40 border-emerald-600/60 text-emerald-300"
                : s === "cheapest" ? "bg-teal-700/40 border-teal-600/60 text-teal-300"
                :                    "bg-sky-700/40 border-sky-600/60 text-sky-300"
                : "bg-slate-800 border-slate-700 text-slate-500 hover:border-slate-600",
            )}
          >
            {s === "recommended" ? "⭐ Best" : s === "fastest" ? "⚡ Fast" : s === "safest" ? "🛡 Driest" : "💰 Cheapest"}
          </button>
        ))}
      </div>

      {/* Rain warning */}
      {isRainy && (
        <div className="px-3 py-2 bg-orange-950/30 border-b border-orange-800/30 flex items-start gap-2 text-[10px] text-orange-300">
          <ShieldAlert size={11} className="mt-0.5 shrink-0" />
          <span>{intensity === "extreme" ? "Extreme rain" : "Heavy rain"} — driest route auto-recommended. Minimize walk time.</span>
        </div>
      )}

      <div className="divide-y divide-slate-800/60">
        {displayed.map((plan) => {
          const tc       = PLAN_TYPE_COLOR[plan.type] ?? PLAN_TYPE_COLOR.transjakarta;
          const isActive = plan.id === activePlanId;
          const totalWalkM = plan.walkToBoard.distanceMeters + plan.walkFromAlight.distanceMeters;
          const rainMins   = plan.rainExposureMinutes;

          return (
            <motion.button
              key={plan.id}
              onClick={() => onSelect(plan)}
              whileTap={{ scale: 0.99 }}
              className={cn(
                "w-full text-left px-3 py-2.5 transition-colors flex gap-2.5 items-start",
                isActive
                  ? "bg-sky-950/40 border-l-2 border-sky-400"
                  : "hover:bg-slate-800/30 border-l-2 border-transparent",
              )}
            >
              {/* Rank bubble */}
              <div className={cn(
                "shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold",
                isActive ? "bg-sky-700 text-white" : "bg-slate-700 text-slate-400",
              )}>
                {isActive && fetchingPlan ? <RefreshCw size={9} className="animate-spin" /> : plan.rank}
              </div>

              <div className="flex-1 min-w-0 space-y-1">
                {/* Line badges + name */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {plan.lines.map((l) => (
                    <span key={l.routeId} className={cn("text-[9px] font-mono px-1.5 py-0.5 rounded border uppercase font-bold", PLAN_TYPE_COLOR[l.type]?.badge ?? "bg-slate-700 text-slate-300 border-slate-600")}>
                      {l.type === "transjakarta" ? "TJ" : l.type.toUpperCase()} {l.shortName}
                    </span>
                  ))}
                  {plan.transfers > 0 && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-purple-900/40 text-purple-300 border-purple-700/50">
                      1 transfer
                    </span>
                  )}
                  {plan.rank === 1 && sort === "recommended" && (
                    <span className="ml-auto shrink-0 text-[9px] bg-emerald-700/40 text-emerald-300 border border-emerald-700/40 px-1.5 py-0.5 rounded-full font-mono">BEST</span>
                  )}
                </div>

                {/* Transfer stop */}
                {plan.transferStop && (
                  <p className="text-[10px] text-purple-400/80 font-mono">
                    Transfer @ {plan.transferStop.name}
                  </p>
                )}

                {/* Board → Alight */}
                <div className="flex items-center gap-1 text-[10px] text-slate-500">
                  <ArrowUpFromLine size={8} className="text-emerald-500 shrink-0" />
                  <span className="text-emerald-400/80 truncate max-w-[90px]">{plan.boardStop.name}</span>
                  <ArrowRight size={8} className="shrink-0 text-slate-600" />
                  <ArrowDownToLine size={8} className="text-red-500 shrink-0" />
                  <span className="text-red-400/80 truncate max-w-[90px]">{plan.alightStop.name}</span>
                </div>

                {/* Stats row */}
                <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500">
                  <span className="text-slate-300 font-semibold">{Math.round(plan.totalDurationSeconds / 60)} min</span>
                  <span>{plan.stopCount} stop{plan.stopCount !== 1 ? "s" : ""}</span>
                  <span className={totalWalkM > 500 && isRainy ? "text-orange-400" : ""}>
                    <Footprints size={9} className="inline mr-0.5" />{Math.round(totalWalkM)}m walk
                  </span>
                </div>

                {/* Fare + service row */}
                <div className="flex items-center gap-2 flex-wrap">
                  {plan.fareEstimateIdr > 0 && (
                    <span className="flex items-center gap-1 text-[10px] font-mono font-semibold text-emerald-300 bg-emerald-900/30 border border-emerald-700/40 px-1.5 py-0.5 rounded-full">
                      <Banknote size={9} />{fmtRp(plan.fareEstimateIdr)}
                    </span>
                  )}
                  {plan.frequency > 0 && (
                    <span className="flex items-center gap-1 text-[9px] font-mono text-slate-400 bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded-full">
                      <Timer size={9} />~{plan.frequency} min
                    </span>
                  )}
                  {plan.operatingHours && (
                    <span className="flex items-center gap-1 text-[9px] font-mono text-slate-400 bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded-full">
                      <AlarmClock size={9} />{plan.operatingHours}
                    </span>
                  )}
                </div>

                {/* Rain exposure + shelter bar side by side */}
                <div className="grid grid-cols-2 gap-2 items-center">
                  <div>
                    <p className="text-[9px] text-slate-600 font-mono mb-0.5">SHELTER</p>
                    {shelterBar(plan.shelteredPct)}
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-600 font-mono mb-0.5">RAIN EXPOSURE</p>
                    <p className={cn("text-[10px] font-mono font-semibold", rainMins <= 2 ? "text-emerald-400" : rainMins <= 5 ? "text-yellow-400" : "text-orange-400")}>
                      {rainMins <= 0 ? "none" : `~${rainMins} min`}
                    </p>
                  </div>
                </div>

                {/* Safety note */}
                <p className="text-[10px] text-slate-500 leading-relaxed">{plan.safetyNote}</p>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

// ── Transit Routes Browser ───────────────────────────────────────────────────

interface TransitRouteEntry {
  id: string;
  shortName: string;
  longName: string;
  type: string;
  stopCount: number;
  firstStop: string | null;
  lastStop: string | null;
  fareMin: number;
  fareMax: number;
  fareNote: string;
  operatingHours: string;
  frequency: number;
  color: string;
}

const TYPE_TABS = [
  { key: "all",          label: "All" },
  { key: "transjakarta", label: "TransJakarta" },
  { key: "mrt",          label: "MRT" },
  { key: "lrt",          label: "LRT" },
  { key: "krl",          label: "KRL" },
] as const;

const TYPE_COLOR: Record<string, string> = {
  transjakarta: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  mrt:          "bg-red-500/20 text-red-300 border-red-500/30",
  lrt:          "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  krl:          "bg-blue-500/20 text-blue-300 border-blue-500/30",
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  transjakarta: <Bus   size={12} className="text-amber-400" />,
  mrt:          <Train size={12} className="text-red-400" />,
  lrt:          <Train size={12} className="text-emerald-400" />,
  krl:          <Train size={12} className="text-blue-400" />,
};

function TransitRoutesBrowser({ onClose }: { onClose: () => void }) {
  const [activeType, setActiveType] = useState<string>("all");
  const [search, setSearch]         = useState("");
  const [routes, setRoutes]         = useState<TransitRouteEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [expanded, setExpanded]     = useState<string | null>(null);

  // Fetch whenever type changes (search is client-side filtered for speed)
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (activeType !== "all") params.set("type", activeType);
    axios.get<{ routes: TransitRouteEntry[] }>(`/api/transit/routes?${params}`)
      .then((r) => setRoutes(r.data.routes))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeType]);

  const filtered = search.trim()
    ? routes.filter(
        (r) =>
          r.shortName.toLowerCase().includes(search.toLowerCase()) ||
          r.longName.toLowerCase().includes(search.toLowerCase()) ||
          (r.firstStop ?? "").toLowerCase().includes(search.toLowerCase()) ||
          (r.lastStop  ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : routes;

  const counts = {
    transjakarta: routes.filter((r) => r.type === "transjakarta").length,
    mrt:          routes.filter((r) => r.type === "mrt").length,
    lrt:          routes.filter((r) => r.type === "lrt").length,
    krl:          routes.filter((r) => r.type === "krl").length,
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <LayoutList size={14} className="text-sky-400" />
          <span className="text-sm font-semibold">Transit Lines</span>
          <span className="text-[10px] font-mono text-slate-500 ml-1">Jakarta</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-white transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Summary chips */}
      <div className="px-4 py-2 border-b border-slate-800 flex gap-2 flex-wrap shrink-0">
        {(["transjakarta", "mrt", "lrt", "krl"] as const).map((t) => (
          <div key={t} className={cn("flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium", TYPE_COLOR[t])}>
            {TYPE_ICON[t]}
            <span className="uppercase">{t === "transjakarta" ? "TJ" : t}</span>
            <span className="opacity-70">{counts[t]}</span>
          </div>
        ))}
      </div>

      {/* Type filter tabs */}
      <div className="px-3 pt-3 flex gap-1.5 flex-wrap shrink-0">
        {TYPE_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveType(tab.key); setSearch(""); }}
            className={cn(
              "px-3 py-1 rounded-full text-[11px] font-medium border transition-colors",
              activeType === tab.key
                ? "bg-sky-600 border-sky-500 text-white"
                : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="px-3 pt-2 pb-2 shrink-0">
        <div className="flex items-center gap-2 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-1.5">
          <Search size={12} className="text-slate-500 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or stop…"
            className="bg-transparent text-xs text-white placeholder-slate-600 outline-none w-full"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-slate-500 hover:text-white">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Route count */}
      <div className="px-4 pb-1 shrink-0">
        <span className="text-[10px] font-mono text-slate-600">
          {loading ? "Loading…" : `${filtered.length} route${filtered.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* Route list */}
      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1.5">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw size={16} className="animate-spin text-slate-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-slate-600">
            <Search size={20} className="mb-2" />
            <p className="text-xs">No routes found</p>
          </div>
        ) : (
          filtered.map((r) => (
            <motion.div
              key={r.id}
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-slate-700/50 bg-slate-800/30 overflow-hidden"
            >
              <button
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                className="w-full text-left px-3 py-2.5 hover:bg-slate-700/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {TYPE_ICON[r.type] ?? <Bus size={12} />}
                  <span className="text-xs font-semibold text-white truncate flex-1">
                    {r.shortName}
                  </span>
                  <span className={cn("text-[9px] font-mono px-1.5 py-0.5 rounded border uppercase shrink-0", TYPE_COLOR[r.type])}>
                    {r.type === "transjakarta" ? "TJ" : r.type}
                  </span>
                  {expanded === r.id
                    ? <ChevronUp size={11} className="text-slate-500 shrink-0" />
                    : <ChevronDown size={11} className="text-slate-500 shrink-0" />}
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5 truncate">{r.longName}</p>
                {r.firstStop && r.lastStop && (
                  <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-500 font-mono">
                    <span className="text-emerald-500/70 truncate max-w-[120px]">{r.firstStop}</span>
                    <ArrowRight size={9} className="shrink-0" />
                    <span className="text-red-500/70 truncate max-w-[120px]">{r.lastStop}</span>
                  </div>
                )}
              </button>

              <AnimatePresence>
                {expanded === r.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden border-t border-slate-700/40"
                  >
                    <div className="px-3 py-2 bg-slate-900/40 space-y-2 text-[11px]">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-slate-600 font-mono text-[10px]">STOPS</p>
                          <p className="text-white font-semibold">{r.stopCount}</p>
                        </div>
                        <div>
                          <p className="text-slate-600 font-mono text-[10px]">TYPE</p>
                          <p className={cn("font-semibold capitalize", r.type === "transjakarta" ? "text-amber-300" : r.type === "mrt" ? "text-red-300" : r.type === "lrt" ? "text-emerald-300" : "text-blue-300")}>
                            {r.type === "transjakarta" ? "TransJakarta BRT" : r.type.toUpperCase()}
                          </p>
                        </div>
                        {r.fareMin > 0 && (
                          <div>
                            <p className="text-slate-600 font-mono text-[10px]">FARE</p>
                            <p className="text-emerald-300 font-semibold font-mono">
                              {r.fareMin === r.fareMax
                                ? fmtRp(r.fareMin)
                                : `${fmtRp(r.fareMin)}–${fmtRp(r.fareMax)}`}
                            </p>
                          </div>
                        )}
                        {r.frequency > 0 && (
                          <div>
                            <p className="text-slate-600 font-mono text-[10px]">FREQUENCY</p>
                            <p className="text-slate-300 font-semibold">every ~{r.frequency} min</p>
                          </div>
                        )}
                        {r.operatingHours && (
                          <div className="col-span-2">
                            <p className="text-slate-600 font-mono text-[10px]">HOURS</p>
                            <p className="text-slate-300 font-semibold">{r.operatingHours}</p>
                          </div>
                        )}
                        {r.firstStop && (
                          <div className="col-span-2">
                            <p className="text-slate-600 font-mono text-[10px]">TERMINALS</p>
                            <p className="text-slate-300 truncate">{r.firstStop} ↔ {r.lastStop}</p>
                          </div>
                        )}
                      </div>
                      {r.fareNote && (
                        <p className="text-[9px] text-slate-600 font-mono leading-relaxed border-t border-slate-800 pt-2">{r.fareNote}</p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))
        )}
      </div>
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
