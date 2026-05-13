import { NextResponse } from "next/server";

// Cached in-memory for the lifetime of the server process
let cached: object | null = null;

export async function GET() {
  if (cached) return NextResponse.json(cached);

  const res = await fetch(
    "https://nominatim.openstreetmap.org/lookup?osm_ids=R304751&polygon_geojson=1&format=json",
    {
      headers: { "User-Agent": "w-mptrs-jakarta-routing/0.1" },
      next: { revalidate: 86400 },
    },
  );

  if (!res.ok) {
    return NextResponse.json({ error: "Nominatim unavailable" }, { status: 502 });
  }

  const data = await res.json();
  const geojson = data[0]?.geojson ?? null;

  if (!geojson) {
    return NextResponse.json({ error: "No geojson in response" }, { status: 404 });
  }

  cached = geojson;
  return NextResponse.json(geojson);
}
