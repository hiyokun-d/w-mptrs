import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type {
  AppState, Coordinates, RainfallIntensity, RouteOption,
  WeatherData, WeatherForecastEntry,
} from "@/types";

export interface AppStore extends AppState {
  setOrigin: (coords: Coordinates | null) => void;
  setDestination: (coords: Coordinates | null) => void;
  setWeather: (weather: WeatherData | null) => void;
  setForecast: (forecast: WeatherForecastEntry[]) => void;
  setRoutes: (routes: RouteOption[]) => void;
  setSelectedRoute: (id: string | null) => void;
  setSimulation: (
    active: boolean,
    intensity?: RainfallIntensity,
    windSpeedKmh?: number,
    humidityPct?: number,
  ) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState: AppState = {
  origin: null,
  destination: null,
  weather: null,
  forecast: [],
  routes: [],
  selectedRoute: null,
  simulation: { active: false, intensity: "none", windSpeedKmh: 0, humidityPct: 80 },
  isLoading: false,
  error: null,
};

export const useAppStore = create<AppStore>()(
  devtools(
    (set) => ({
      ...initialState,

      setOrigin: (coords) => set({ origin: coords }),
      setDestination: (coords) => set({ destination: coords }),
      setWeather: (weather) => set({ weather }),
      setForecast: (forecast) => set({ forecast }),
      setRoutes: (routes) => set({ routes }),
      setSelectedRoute: (id) => set({ selectedRoute: id }),

      setSimulation: (active, intensity = "heavy", windSpeedKmh = 20, humidityPct = 85) =>
        set({
          simulation: {
            active,
            intensity: active ? intensity : "none",
            windSpeedKmh: active ? windSpeedKmh : 0,
            humidityPct: active ? humidityPct : 80,
          },
        }),

      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),

      reset: () => set(initialState),
    }),
    { name: "w-mptrs" },
  ),
);
