import type {
  DiscomfortBreakdown,
  RainfallIntensity,
  RouteOption,
  RouteSegment,
  TransportMode,
} from "@/types";

const BASE_PENALTY: Record<TransportMode, number> = {
  motorcycle: 40,
  walking: 25,
  transjakarta: 2,
  mrt: 2,
  lrt: 3,
  car: 8,
  bicycle: 20,
};

const RAINFALL_MULTIPLIER: Record<RainfallIntensity, number> = {
  none: 0,
  light: 0.3,
  moderate: 0.65,
  heavy: 1.0,
  extreme: 1.4,
};

const SHELTERED_MODES = new Set<TransportMode>(["transjakarta", "mrt", "lrt"]);
const OPEN_AIR_MODES = new Set<TransportMode>(["motorcycle", "walking", "bicycle"]);

const MIN_WALKING_DISTANCE_M = 500;

function computeWindPenalty(mode: TransportMode, windSpeedKmh: number): number {
  if (!OPEN_AIR_MODES.has(mode)) return 0;
  if (windSpeedKmh >= 40) return mode === "motorcycle" ? 15 : mode === "bicycle" ? 12 : 10;
  if (windSpeedKmh >= 25) return mode === "motorcycle" ? 8 : mode === "bicycle" ? 7 : 6;
  if (windSpeedKmh >= 15) return mode === "motorcycle" ? 3 : 2;
  return 0;
}

function computeHumidityPenalty(mode: TransportMode, humidityPct: number): number {
  const isOpen = OPEN_AIR_MODES.has(mode);
  if (humidityPct >= 95) return isOpen ? 5 : 1;
  if (humidityPct >= 85) return isOpen ? 2 : 0.5;
  return 0;
}

export function computeSegmentPenalty(
  segment: RouteSegment,
  intensity: RainfallIntensity,
  windSpeedKmh = 0,
  humidityPct = 80,
): DiscomfortBreakdown {
  const base = BASE_PENALTY[segment.mode];
  const multiplier = RAINFALL_MULTIPLIER[intensity];

  let rainfallPenalty = 0;
  let reason = "";

  if (SHELTERED_MODES.has(segment.mode)) {
    rainfallPenalty = base;
    reason =
      intensity === "none"
        ? `${segment.mode.toUpperCase()} is sheltered.`
        : `${segment.mode.toUpperCase()} is sheltered — minimal rain exposure.`;
  } else if (
    segment.mode === "walking" &&
    segment.distanceMeters <= MIN_WALKING_DISTANCE_M &&
    intensity !== "none"
  ) {
    rainfallPenalty = base * multiplier * 0.5;
    reason = `Short walk (${segment.distanceMeters}m) under ${intensity} rain — partial penalty.`;
  } else {
    rainfallPenalty = base * multiplier;
    reason = buildReason(segment.mode, intensity, segment.distanceMeters);
  }

  const windPenalty = computeWindPenalty(segment.mode, windSpeedKmh);
  const humidityPenalty = computeHumidityPenalty(segment.mode, humidityPct);

  if (windPenalty > 0) {
    reason += ` Wind ${windSpeedKmh.toFixed(0)} km/h: +${windPenalty} pts.`;
  }
  if (humidityPenalty > 0) {
    reason += ` Humidity ${humidityPct.toFixed(0)}%: +${humidityPenalty} pts.`;
  }

  const finalPenalty = rainfallPenalty + windPenalty + humidityPenalty;

  return {
    mode: segment.mode,
    basePenalty: base,
    weatherMultiplier: multiplier,
    windPenalty,
    humidityPenalty,
    finalPenalty: Math.round(finalPenalty * 10) / 10,
    reason,
  };
}

function buildReason(
  mode: TransportMode,
  intensity: RainfallIntensity,
  distanceM: number,
): string {
  if (intensity === "none") return `No rain — ${mode} has no weather penalty.`;

  const modeLabel =
    mode === "motorcycle"
      ? "Motorcycle (open-air)"
      : mode === "walking"
        ? `Walking (${distanceM}m)`
        : mode === "bicycle"
          ? "Bicycle (open-air)"
          : mode;

  const intensityLabel = {
    light: "light rain",
    moderate: "moderate rain",
    heavy: "heavy rain",
    extreme: "extreme rain",
  }[intensity];

  return `${modeLabel} exposed to ${intensityLabel}.`;
}

export function scoreRoute(
  segments: RouteSegment[],
  intensity: RainfallIntensity,
  windSpeedKmh = 0,
  humidityPct = 80,
): { totalScore: number; breakdown: DiscomfortBreakdown[] } {
  const breakdown = segments.map((s) =>
    computeSegmentPenalty(s, intensity, windSpeedKmh, humidityPct),
  );
  const totalScore = breakdown.reduce((sum, b) => sum + b.finalPenalty, 0);
  return { totalScore: Math.round(totalScore * 10) / 10, breakdown };
}

export function buildRecommendationText(
  route: Pick<RouteOption, "label" | "discomfortScore" | "discomfortBreakdown">,
  intensity: RainfallIntensity,
): string {
  if (intensity === "none" || intensity === "light") {
    return route.label === "fastest"
      ? "Conditions are clear — fastest route is comfortable."
      : "Weather-aware route for extra comfort.";
  }

  const worstSegment = route.discomfortBreakdown.reduce((a, b) =>
    b.finalPenalty > a.finalPenalty ? b : a,
  );

  if (route.label === "weather_aware") {
    const hasSheltered = route.discomfortBreakdown.some((b) =>
      SHELTERED_MODES.has(b.mode),
    );
    return hasSheltered
      ? `${capitalize(intensity)} rain detected. Switching to sheltered transit (TransJakarta/MRT/LRT) is recommended for your safety.`
      : `${capitalize(intensity)} rain detected. This route minimizes your weather exposure (score: ${route.discomfortScore}).`;
  }

  return `Warning: ${worstSegment.reason} Discomfort score: ${route.discomfortScore}.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function suggestModalShift(
  fastest: RouteOption,
  weatherAware: RouteOption,
  intensity: RainfallIntensity,
): { shouldShift: boolean; reason: string } {
  if (intensity === "none" || intensity === "light") {
    return { shouldShift: false, reason: "Conditions acceptable for any mode." };
  }

  const scoreDiff = fastest.discomfortScore - weatherAware.discomfortScore;
  if (scoreDiff >= 10) {
    return {
      shouldShift: true,
      reason: `Modal shift recommended: weather-aware route saves ${scoreDiff.toFixed(1)} discomfort points under ${intensity} rain.`,
    };
  }

  return { shouldShift: false, reason: "Score difference too small to warrant a mode change." };
}
