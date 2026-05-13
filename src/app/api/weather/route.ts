import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchBmkgWeather, isInIndonesia } from "@/lib/weather/bmkg";
import type { Coordinates, RainfallIntensity, WeatherData } from "@/types";

const CACHE_TTL_MS = 60 * 1000;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const lat = parseFloat(searchParams.get("lat") ?? "");
  const lng = parseFloat(searchParams.get("lng") ?? "");
  const simulate = searchParams.get("simulate");

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json({ error: "lat and lng required" }, { status: 400 });
  }

  const coords: Coordinates = { lat, lng };

  if (!isInIndonesia(coords)) {
    return NextResponse.json(
      { error: "Coordinates outside Indonesia. This service covers Indonesia only." },
      { status: 422 },
    );
  }

  if (simulate) {
    const intensity = simulate as RainfallIntensity;
    const SIM_META: Record<RainfallIntensity, { mm: number; ws: number; hu: number; tc: number }> = {
      none:     { mm: 0,  ws: 5,  hu: 70, tc: 32 },
      light:    { mm: 2,  ws: 12, hu: 85, tc: 28 },
      moderate: { mm: 10, ws: 22, hu: 90, tc: 26 },
      heavy:    { mm: 35, ws: 35, hu: 95, tc: 24 },
      extreme:  { mm: 70, ws: 55, hu: 98, tc: 22 },
    };
    const m = SIM_META[intensity];
    const simWeather: WeatherData = {
      intensity,
      rainfallMmPerHour: m.mm,
      description: `[SIMULASI] ${intensity} — BMKG`,
      timestamp: Date.now(),
      source: "bmkg",
      location: coords,
      windSpeedKmh: m.ws,
      humidityPct: m.hu,
      temperatureC: m.tc,
    };
    return NextResponse.json(simWeather);
  }

  const now = new Date();
  const cached = await db.weatherCache.findFirst({
    where: {
      lat: { gte: lat - 0.01, lte: lat + 0.01 },
      lng: { gte: lng - 0.01, lte: lng + 0.01 },
      expiresAt: { gt: now },
    },
    orderBy: { fetchedAt: "desc" },
  });

  if (cached) {
    return NextResponse.json({
      intensity: cached.intensity as RainfallIntensity,
      rainfallMmPerHour: cached.rainfallMmPerHour,
      description: cached.description,
      timestamp: cached.fetchedAt.getTime(),
      source: cached.source as WeatherData["source"],
      location: { lat: cached.lat, lng: cached.lng },
    } satisfies WeatherData);
  }

  const weather = await fetchBmkgWeather(coords);

  if (!weather) {
    return NextResponse.json({ error: "BMKG data unavailable for this location" }, { status: 503 });
  }

  await db.weatherCache.create({
    data: {
      lat,
      lng,
      intensity: weather.intensity,
      rainfallMmPerHour: weather.rainfallMmPerHour,
      description: weather.description,
      source: weather.source,
      expiresAt: new Date(Date.now() + CACHE_TTL_MS),
    },
  });

  return NextResponse.json(weather);
}
