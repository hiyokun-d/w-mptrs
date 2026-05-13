// OSRM-based routing — free, no API key required.
// Uses multiple public endpoints with retry for reliability.
import type { Coordinates, RouteSegment, TransportMode } from "@/types";

// Public OSRM servers — tried in order on failure
const OSRM_ENDPOINTS = [
  "https://router.project-osrm.org",
  "https://routing.openstreetmap.de/routed-car",
];

interface OsrmRoute {
  geometry: { coordinates: [number, number][] };
  distance: number;
  duration: number;
}

async function fetchOsrmRoute(
  origin: Coordinates,
  destination: Coordinates,
  profile: "car" | "foot",
): Promise<OsrmRoute | null> {
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;

  for (const base of OSRM_ENDPOINTS) {
    try {
      // routing.openstreetmap.de uses path-based profile, project-osrm uses subdomain-style
      const url = `${base}/route/v1/${profile}/${coords}?overview=full&geometries=geojson`;
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });

      if (!res.ok) continue;

      const json = await res.json();
      if (json.code !== "Ok" || !json.routes?.[0]) continue;

      return json.routes[0];
    } catch {
      // try next endpoint
    }
  }

  return null;
}

export async function fetchBothRoutes(origin: Coordinates, destination: Coordinates) {
  const [carRoute, footRoute] = await Promise.all([
    fetchOsrmRoute(origin, destination, "car"),
    fetchOsrmRoute(origin, destination, "foot"),
  ]);

  if (!carRoute || !footRoute) return null;

  const fastest: RouteSegment[] = [{
    mode: "motorcycle" as TransportMode,
    distanceMeters: carRoute.distance,
    durationSeconds: carRoute.duration,
    geometry: carRoute.geometry.coordinates,
  }];

  const weatherAware: RouteSegment[] = [{
    mode: "transjakarta" as TransportMode,
    distanceMeters: footRoute.distance,
    durationSeconds: footRoute.duration,
    geometry: footRoute.geometry.coordinates,
  }];

  return { fastest, weatherAware };
}

// kept for backward compat with any direct callers
export async function fetchRoute(
  origin: Coordinates,
  destination: Coordinates,
  mode: TransportMode,
): Promise<RouteSegment[] | null> {
  const profile = ["transjakarta", "mrt", "lrt", "walking"].includes(mode) ? "foot" : "car";
  const route = await fetchOsrmRoute(origin, destination, profile);
  if (!route) return null;
  return [{
    mode,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    geometry: route.geometry.coordinates,
  }];
}
