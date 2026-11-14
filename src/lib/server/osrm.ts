import "server-only";
import type { LatLng } from "@/lib/core/polyline";

// Road geometry from the public OSRM demo servers (rate-limited: results
// are cached in memory, keyed by coordinates rounded to ~100 m).

const ENDPOINTS: Record<"car" | "foot", string[]> = {
  car: [
    "https://router.project-osrm.org/route/v1/driving",
    "https://routing.openstreetmap.de/routed-car/route/v1/driving",
  ],
  foot: ["https://routing.openstreetmap.de/routed-foot/route/v1/foot"],
};

export interface Road {
  path: LatLng[];
  meters: number;
  seconds: number;
}

const cache = new Map<string, Road | null>();

export async function road(
  profile: "car" | "foot",
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): Promise<Road | null> {
  const r = (x: number) => x.toFixed(3);
  const key = `${profile}:${r(a.lat)},${r(a.lng)};${r(b.lat)},${r(b.lng)}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let out: Road | null = null;
  for (const base of ENDPOINTS[profile]) {
    try {
      const res = await fetch(
        `${base}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson`,
        {
          signal: AbortSignal.timeout(profile === "car" ? 8_000 : 5_000),
          next: { revalidate: 86_400 },
        },
      );
      if (!res.ok) continue;
      const j = await res.json();
      const route = j?.routes?.[0];
      if (j.code !== "Ok" || !route) continue;
      out = {
        path: (route.geometry.coordinates as [number, number][]).map(
          ([lng, lat]) => [lat, lng],
        ),
        meters: route.distance,
        seconds: route.duration,
      };
      break;
    } catch {
      // next endpoint
    }
  }
  if (cache.size > 5000) cache.clear();
  cache.set(key, out);
  return out;
}
