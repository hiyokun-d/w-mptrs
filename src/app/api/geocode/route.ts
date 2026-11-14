import type { NextRequest } from "next/server";
import { getNetwork } from "@/lib/server/network";
import { BBOX } from "@/lib/weather/rain-grid";

const KIND_LABEL = [
  "Halte TransJakarta",
  "Halte bus",
  "Stasiun KRL",
  "Stasiun MRT",
  "Stasiun LRT",
];

/** stations and haltes whose name matches, one per name and kind */
async function stops(q: string) {
  const net = await getNetwork();
  const s = net.file.stops;
  const needle = q.toLowerCase();
  const seen = new Set<string>();
  const out: {
    name: string;
    detail: string;
    lat: number;
    lng: number;
    kind: string;
  }[] = [];
  for (let i = 0; i < net.n && out.length < 5; i++) {
    const name = s.name[i];
    if (!name.toLowerCase().includes(needle) || !net.at[i].length) continue;
    const key = `${name}|${s.kind[i]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      detail: KIND_LABEL[s.kind[i]],
      lat: s.lat[i],
      lng: s.lng[i],
      kind: "stop",
    });
  }
  // rail stations first, they are what people search for most
  return out.sort(
    (a, b) =>
      Number(b.detail.startsWith("Stasiun")) -
      Number(a.detail.startsWith("Stasiun")),
  );
}

// GET ?q=… → places in Jabodetabek (Photon / OpenStreetMap), cached for a day.
// Proxied so the browser never calls the public geocoder directly.

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    district?: string;
    city?: string;
    osm_value?: string;
    type?: string;
  };
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || q.length > 120) return Response.json([]);
  const url =
    "https://photon.komoot.io/api/?" +
    new URLSearchParams({
      q,
      limit: "8",
      bbox: `${BBOX.lng0},${BBOX.lat0},${BBOX.lng1},${BBOX.lat1}`,
      lat: "-6.2",
      lon: "106.83",
    });
  const local = await stops(q).catch(() => []);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "w-mptrs-research/1.0 (weather-aware transit routing, Jakarta)",
      },
      signal: AbortSignal.timeout(6_000),
      next: { revalidate: 86_400 },
    });
    if (!res.ok) return Response.json(local);
    const j = (await res.json()) as { features: PhotonFeature[] };
    const places = j.features.map((f) => {
      const p = f.properties;
      return {
        name: p.name ?? p.street ?? q,
        detail: [p.street !== p.name ? p.street : null, p.district, p.city]
          .filter(Boolean)
          .join(", "),
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        kind: p.osm_value ?? p.type ?? "place",
      };
    });
    return Response.json([...local, ...places], {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return Response.json(local);
  }
}
