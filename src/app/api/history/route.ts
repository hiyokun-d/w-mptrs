import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { origin, destination, chosenMode, weatherIntensity, discomfortScore, routeLabel } = body;

  if (!origin || !destination || !chosenMode || !weatherIntensity || discomfortScore == null) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const entry = await db.routeHistory.create({
    data: {
      originLat: origin.lat,
      originLng: origin.lng,
      destinationLat: destination.lat,
      destinationLng: destination.lng,
      chosenMode,
      weatherIntensity,
      discomfortScore,
      routeLabel: routeLabel ?? "fastest",
    },
  });

  return NextResponse.json(entry, { status: 201 });
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);

  const history = await db.routeHistory.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(history);
}
