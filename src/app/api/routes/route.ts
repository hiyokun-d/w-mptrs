import { NextRequest, NextResponse } from "next/server";
import { fetchBothRoutes } from "@/lib/routing/graphhopper";
import { scoreRoute, buildRecommendationText, suggestModalShift } from "@/lib/routing/discomfort";
import type { Coordinates, RainfallIntensity, RouteOption } from "@/types";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { origin, destination, weatherIntensity } = body as {
    origin: Coordinates;
    destination: Coordinates;
    weatherIntensity: RainfallIntensity;
  };

  if (!origin || !destination || !weatherIntensity) {
    return NextResponse.json(
      { error: "origin, destination, weatherIntensity required" },
      { status: 400 },
    );
  }

  const routes = await fetchBothRoutes(origin, destination);
  if (!routes) {
    return NextResponse.json(
      { error: "All OSRM routing endpoints unavailable. Retry in a few seconds." },
      { status: 503 },
    );
  }

  const { fastest: fastestSegs, weatherAware: waSegs } = routes;

  const { totalScore: fs, breakdown: fb } = scoreRoute(fastestSegs, weatherIntensity);
  const { totalScore: ws, breakdown: wb } = scoreRoute(waSegs, weatherIntensity);

  const fastest: RouteOption = {
    id: "fastest",
    label: "fastest",
    segments: fastestSegs,
    totalDistanceMeters: fastestSegs.reduce((s, r) => s + r.distanceMeters, 0),
    totalDurationSeconds: fastestSegs.reduce((s, r) => s + r.durationSeconds, 0),
    discomfortScore: fs,
    discomfortBreakdown: fb,
    recommendation: "",
  };
  fastest.recommendation = buildRecommendationText(fastest, weatherIntensity);

  const weatherAware: RouteOption = {
    id: "weather_aware",
    label: "weather_aware",
    segments: waSegs,
    totalDistanceMeters: waSegs.reduce((s, r) => s + r.distanceMeters, 0),
    totalDurationSeconds: waSegs.reduce((s, r) => s + r.durationSeconds, 0),
    discomfortScore: ws,
    discomfortBreakdown: wb,
    recommendation: "",
  };
  weatherAware.recommendation = buildRecommendationText(weatherAware, weatherIntensity);

  const { shouldShift, reason } = suggestModalShift(fastest, weatherAware, weatherIntensity);

  return NextResponse.json({ fastest, weatherAware, shouldShift, shiftReason: reason });
}
