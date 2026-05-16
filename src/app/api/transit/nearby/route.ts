import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// GET /api/transit/nearby?lat=X&lng=Y&radius=864&maxWalkMinutes=12
// radius defaults to 864m (12 min at 1.2 m/s walking pace)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat    = parseFloat(searchParams.get("lat")    ?? "");
  const lng    = parseFloat(searchParams.get("lng")    ?? "");

  // maxWalkMinutes takes priority over radius if provided
  const maxWalkMinutes = parseFloat(searchParams.get("maxWalkMinutes") ?? "");
  const defaultRadius = 864; // 12 min × 60s × 1.2 m/s
  const radius = !isNaN(maxWalkMinutes)
    ? maxWalkMinutes * 60 * 1.2
    : parseFloat(searchParams.get("radius") ?? String(defaultRadius));

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "lat and lng required" }, { status: 400 });
  }

  const latD = radius / 111_000;
  const lngD = radius / (111_000 * Math.cos((lat * Math.PI) / 180));

  const rows = await db.transitStop.findMany({
    where: {
      lat: { gte: lat - latD, lte: lat + latD },
      lng: { gte: lng - lngD, lte: lng + lngD },
    },
    select: { id: true, name: true, lat: true, lng: true, type: true },
  });

  const MAX_WALK_HARD_CAP_M = 864; // never suggest a halte >12 min away

  const stops = rows
    .map((s) => {
      const distM = haversine(lat, lng, s.lat, s.lng);
      const walkSecs = distM / 1.2;
      return {
        id:              s.id,
        name:            s.name,
        lat:             s.lat,
        lng:             s.lng,
        type:            s.type,
        distanceMeters:  Math.round(distM),
        walkMinutes:     Math.round(walkSecs / 60 * 10) / 10,
        withinMaxWalk:   distM <= MAX_WALK_HARD_CAP_M,
      };
    })
    .filter((s) => s.distanceMeters <= radius)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 10);

  return NextResponse.json({ stops, maxWalkMinutes: Math.round(radius / 1.2 / 60 * 10) / 10 });
}
