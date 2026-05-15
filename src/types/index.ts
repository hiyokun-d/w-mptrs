export type TransportMode =
  | "motorcycle"
  | "walking"
  | "transjakarta"
  | "mrt"
  | "lrt"
  | "krl"
  | "car"
  | "bicycle";

export type RainfallIntensity = "none" | "light" | "moderate" | "heavy" | "extreme";

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface WeatherData {
  intensity: RainfallIntensity;
  rainfallMmPerHour: number;
  description: string;
  timestamp: number;
  source: "bmkg" | "simulation";
  location: Coordinates;
  // Extended BMKG fields — used by multi-factor discomfort engine
  windSpeedKmh?: number;
  humidityPct?: number;
  temperatureC?: number;
  visibilityKm?: number;
}

export interface TransitStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface TransitLine {
  routeId: string;
  shortName: string;
  longName: string;
}

export interface RouteSegment {
  mode: TransportMode;
  distanceMeters: number;
  durationSeconds: number;
  geometry: [number, number][];
  // Transit-specific — present only on transit segments
  transitLine?: TransitLine;
  boardStop?: TransitStop;
  alightStop?: TransitStop;
  stopCount?: number;
  instruction?: string;
}

export interface RouteOption {
  id: string;
  label: "fastest" | "weather_aware";
  segments: RouteSegment[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  discomfortScore: number;
  discomfortBreakdown: DiscomfortBreakdown[];
  recommendation?: string;
  // Convenience — set when a transit plan was found
  hasTransitPlan?: boolean;
}

export interface DiscomfortBreakdown {
  mode: TransportMode;
  basePenalty: number;
  weatherMultiplier: number;
  windPenalty: number;
  humidityPenalty: number;
  finalPenalty: number;
  reason: string;
}

export interface WeatherForecastEntry {
  localDatetime: string;
  intensity: RainfallIntensity;
  rainfallMmPerHour: number;
  description: string;
  windSpeedKmh: number;
  humidityPct: number;
  temperatureC: number;
}

export interface TransitPlanLine {
  routeId: string;
  shortName: string;
  longName: string;
  type: string;
}

export interface TransitPlan {
  id: string;
  rank: number;
  type: string;
  shortName: string;
  longName: string;
  lines: TransitPlanLine[];
  transfers: number;
  transferStop?: TransitStop;
  boardStop: TransitStop;
  alightStop: TransitStop;
  stopCount: number;
  transitDurationSeconds: number;
  transitDistanceMeters: number;
  walkToBoard: { distanceMeters: number; durationSeconds: number };
  walkFromAlight: { distanceMeters: number; durationSeconds: number };
  totalDurationSeconds: number;
  totalDistanceMeters: number;
  shelteredPct: number;
  rainExposureMinutes: number;
  modePreference: number;
  safetyNote: string;
  // Fare + service info
  fareEstimateIdr: number;
  fareNote: string;
  operatingHours: string;
  frequency: number;
  color: string;
}

export interface SearchHistory {
  id: string;
  userId?: string;
  origin: Coordinates;
  destination: Coordinates;
  chosenMode: TransportMode;
  weatherIntensity: RainfallIntensity;
  discomfortScore: number;
  createdAt: string;
}

export interface SimulationState {
  active: boolean;
  intensity: RainfallIntensity;
  windSpeedKmh: number;
  humidityPct: number;
}

export interface AppState {
  origin: Coordinates | null;
  destination: Coordinates | null;
  weather: WeatherData | null;
  forecast: WeatherForecastEntry[];
  routes: RouteOption[];
  selectedRoute: string | null;
  simulation: SimulationState;
  isLoading: boolean;
  error: string | null;
}
