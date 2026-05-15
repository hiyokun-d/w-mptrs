import { NextRequest, NextResponse } from "next/server";
import { buildPlanSegments } from "@/lib/routing/transit-planner";
import type { Coordinates } from "@/types";

export const dynamic = "force-dynamic";

// POST /api/transit/plan
// Body: { origin, dest, routeId, boardStopId, alightStopId }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { origin, dest, routeId, boardStopId, alightStopId } = body as {
    origin: Coordinates;
    dest: Coordinates;
    routeId: string;
    boardStopId: string;
    alightStopId: string;
  };

  if (!origin || !dest || !routeId || !boardStopId || !alightStopId) {
    return NextResponse.json({ error: "origin, dest, routeId, boardStopId, alightStopId required" }, { status: 400 });
  }

  const segments = await buildPlanSegments(origin, dest, routeId, boardStopId, alightStopId);
  if (!segments) {
    return NextResponse.json({ error: "Could not build plan for given stops" }, { status: 404 });
  }

  return NextResponse.json({ segments });
}
