export type TransportMode =
  | "motorcycle"
  | "walking"
  | "transjakarta"
  | "mrt"
  | "lrt"
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

export interface RouteSegment {
  mode: TransportMode;
  distanceMeters: number;
  durationSeconds: number;
  geometry: [number, number][];
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
