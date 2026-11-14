import type {
  DiscomfortBreakdown,
  RainfallIntensity,
  RouteOption,
  RouteSegment,
  TransportMode,
} from "@/types";

// Discomfort Penalty (DP) model — identical to the paper and to wmptrs-sim:
//
//   c = τ · w_m · (1 + β · E_m · φ(r))
//   φ(r) = (σ(r) − σ(0)) / (1 − σ(0)),  σ(r) = 1 / (1 + e^(−k(r − r0)))
//
// τ = segment minutes, w_m = value-of-time weight, E_m = rain exposure,
// r = rain intensity in mm/h. The rain part of the cost, τ·w_m·β·E_m·φ(r),
// is reported as the segment's discomfort in "perceived minutes".
// Waiting exposure is not priced: the paper's ablation (A4) showed that
// penalising waits deters the sheltered transit trips that save the most rain.

export const DP_DEFAULTS = { beta: 1, r0: 5, k: 0.74 } as const;

export interface DPOptions {
  beta?: number;
  r0?: number;
  k?: number;
  /** Exact rain intensity (mm/h); overrides the category's representative value. */
  rainMmh?: number;
}

/** Representative intensity per BMKG hourly category (mid-band; >20 mm/h → 30). */
export const RAIN_MMH: Record<RainfallIntensity, number> = {
  none: 0,
  light: 3,
  moderate: 7.5,
  heavy: 15,
  extreme: 30,
};

const EXPOSURE: Record<TransportMode, number> = {
  walking: 1,
  motorcycle: 1,
  bicycle: 1,
  car: 0,
  transjakarta: 0,
  mrt: 0,
  lrt: 0,
  krl: 0,
};

const TIME_WEIGHT: Record<TransportMode, number> = {
  walking: 1.5,
  motorcycle: 1,
  bicycle: 1,
  car: 1,
  transjakarta: 1,
  mrt: 1,
  lrt: 1,
  krl: 1,
};

const SHELTERED_MODES = new Set<TransportMode>([
  "transjakarta",
  "mrt",
  "lrt",
  "krl",
]);
const OPEN_AIR_MODES = new Set<TransportMode>([
  "motorcycle",
  "walking",
  "bicycle",
]);

function sigmoid(r: number, r0: number, k: number): number {
  return 1 / (1 + Math.exp(-k * (r - r0)));
}

/** Normalised rain-discomfort response in [0, 1): φ(0) = 0, φ(r0) ≈ 0.5. */
export function phi(
  r: number,
  r0: number = DP_DEFAULTS.r0,
  k: number = DP_DEFAULTS.k,
): number {
  if (r <= 0) return 0;
  const s0 = sigmoid(0, r0, k);
  return (sigmoid(r, r0, k) - s0) / (1 - s0);
}

// Wind and humidity are app-only comfort extras (perceived minutes). They are
// not part of the evaluated DP model and are reported separately.
function computeWindPenalty(mode: TransportMode, windSpeedKmh: number): number {
  if (!OPEN_AIR_MODES.has(mode)) return 0;
  if (windSpeedKmh >= 40)
    return mode === "motorcycle" ? 15 : mode === "bicycle" ? 12 : 10;
  if (windSpeedKmh >= 25)
    return mode === "motorcycle" ? 8 : mode === "bicycle" ? 7 : 6;
  if (windSpeedKmh >= 15) return mode === "motorcycle" ? 3 : 2;
  return 0;
}

function computeHumidityPenalty(
  mode: TransportMode,
  humidityPct: number,
): number {
  const isOpen = OPEN_AIR_MODES.has(mode);
  if (humidityPct >= 95) return isOpen ? 5 : 1;
  if (humidityPct >= 85) return isOpen ? 2 : 0.5;
  return 0;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Discomfort of one segment.
 * basePenalty = τ·w_m (dry perceived minutes), weatherMultiplier = β·E·φ(r),
 * finalPenalty = basePenalty · weatherMultiplier + wind + humidity extras.
 */
export function computeSegmentPenalty(
  segment: RouteSegment,
  intensity: RainfallIntensity,
  windSpeedKmh = 0,
  humidityPct = 80,
  opts: DPOptions = {},
): DiscomfortBreakdown {
  const { beta, r0, k } = { ...DP_DEFAULTS, ...opts };
  const r = opts.rainMmh ?? RAIN_MMH[intensity];
  const minutes = segment.durationSeconds / 60;
  const base = minutes * TIME_WEIGHT[segment.mode];
  const exposure = EXPOSURE[segment.mode];
  const p = phi(r, r0, k);
  const multiplier = beta * exposure * p;
  const rainfallPenalty = base * multiplier;

  let reason = buildReason(segment.mode, intensity, minutes, r, exposure, p);

  const windPenalty = computeWindPenalty(segment.mode, windSpeedKmh);
  const humidityPenalty = computeHumidityPenalty(segment.mode, humidityPct);
  if (windPenalty > 0) {
    reason += ` Wind ${windSpeedKmh.toFixed(0)} km/h: +${windPenalty} min.`;
  }
  if (humidityPenalty > 0) {
    reason += ` Humidity ${humidityPct.toFixed(0)}%: +${humidityPenalty} min.`;
  }

  return {
    mode: segment.mode,
    basePenalty: round1(base),
    weatherMultiplier: round2(multiplier),
    windPenalty,
    humidityPenalty,
    finalPenalty: round1(rainfallPenalty + windPenalty + humidityPenalty),
    reason,
  };
}

function buildReason(
  mode: TransportMode,
  intensity: RainfallIntensity,
  minutes: number,
  r: number,
  exposure: number,
  p: number,
): string {
  const m = `${minutes.toFixed(0)} min`;
  if (r <= 0) return `No rain — ${mode} (${m}) has no weather penalty.`;
  if (SHELTERED_MODES.has(mode) || exposure === 0) {
    return `${mode.toUpperCase()} (${m}) is sheltered — E = 0, rain does not add cost.`;
  }
  const label =
    mode === "motorcycle"
      ? "Motorcycle (open-air)"
      : mode === "walking"
        ? "Walking"
        : mode === "bicycle"
          ? "Bicycle (open-air)"
          : mode;
  return `${label} ${m} in ${intensity} rain (${r} mm/h): φ = ${p.toFixed(2)}, E = ${exposure}.`;
}

export function scoreRoute(
  segments: RouteSegment[],
  intensity: RainfallIntensity,
  windSpeedKmh = 0,
  humidityPct = 80,
  opts: DPOptions = {},
): { totalScore: number; breakdown: DiscomfortBreakdown[] } {
  const breakdown = segments.map((s) =>
    computeSegmentPenalty(s, intensity, windSpeedKmh, humidityPct, opts),
  );
  const totalScore = breakdown.reduce((sum, b) => sum + b.finalPenalty, 0);
  return { totalScore: round1(totalScore), breakdown };
}

/**
 * Generalised cost Σ τ·w_m·(1 + β·E·φ) (+ extras) in perceived minutes —
 * the quantity the DP router minimises.
 */
export function generalisedCost(
  route: Pick<RouteOption, "discomfortBreakdown">,
): number {
  return round1(
    route.discomfortBreakdown.reduce(
      (s, b) => s + b.basePenalty + b.finalPenalty,
      0,
    ),
  );
}

export function buildRecommendationText(
  route: Pick<
    RouteOption,
    "label" | "discomfortScore" | "discomfortBreakdown" | "segments"
  >,
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
    const transitSeg = route.segments?.find((s) => s.transitLine);
    if (transitSeg?.transitLine) {
      const line = transitSeg.transitLine.shortName;
      const board = transitSeg.boardStop?.name ?? "";
      const alight = transitSeg.alightStop?.name ?? "";
      return `${capitalize(intensity)} rain — take ${line} from ${board} to ${alight}. Sheltered from rain.`;
    }
    const hasSheltered = route.discomfortBreakdown.some((b) =>
      SHELTERED_MODES.has(b.mode),
    );
    return hasSheltered
      ? `${capitalize(intensity)} rain detected. Sheltered transit recommended for your safety.`
      : `${capitalize(intensity)} rain detected. This route minimizes weather exposure (+${route.discomfortScore} min discomfort).`;
  }

  return `Warning: ${worstSegment.reason} Rain discomfort: +${route.discomfortScore} perceived min.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * DP decision rule: recommend the weather-aware route exactly when its
 * generalised cost (time and rain discomfort together) is lower.
 */
export function suggestModalShift(
  fastest: RouteOption,
  weatherAware: RouteOption,
  intensity: RainfallIntensity,
): { shouldShift: boolean; reason: string } {
  if (intensity === "none") {
    return {
      shouldShift: false,
      reason: "No rain — the fastest route is also the best.",
    };
  }
  const gf = generalisedCost(fastest);
  const gw = generalisedCost(weatherAware);
  const extraMin = Math.round(
    (weatherAware.totalDurationSeconds - fastest.totalDurationSeconds) / 60,
  );
  const saved = round1(fastest.discomfortScore - weatherAware.discomfortScore);
  if (gw < gf) {
    return {
      shouldShift: true,
      reason: `Modal shift recommended: ${saved} min less rain discomfort for ${extraMin >= 0 ? `+${extraMin}` : extraMin} min travel (generalised cost ${gw} vs ${gf}).`,
    };
  }
  return {
    shouldShift: false,
    reason: `Keep the fastest route: saving ${saved} min of rain discomfort is not worth ${extraMin} extra min (generalised cost ${gf} vs ${gw}). A higher β (rain-averse user) would shift.`,
  };
}
