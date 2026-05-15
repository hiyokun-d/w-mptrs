import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/transit/routes?type=transjakarta&search=blok+m
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const typeParam   = searchParams.get("type")   ?? "all";
  const searchParam = searchParams.get("search") ?? "";

  const where: Record<string, unknown> = {};
  if (typeParam !== "all") where.type = typeParam;
  if (searchParam.trim()) {
    where.OR = [
      { shortName: { contains: searchParam, mode: "insensitive" } },
      { longName:  { contains: searchParam, mode: "insensitive" } },
    ];
  }

  const routes = await db.transitRoute.findMany({
    where,
    select: {
      id: true, shortName: true, longName: true, type: true, stopIds: true,
      fareMin: true, fareMax: true, fareNote: true,
      operatingHours: true, frequency: true, color: true,
    },
    orderBy: [{ type: "asc" }, { shortName: "asc" }],
  });

  // Fetch endpoint stop names (first + last of each route)
  const endpointIds = [
    ...new Set(
      routes.flatMap((r) =>
        [r.stopIds[0], r.stopIds[r.stopIds.length - 1]].filter(Boolean),
      ),
    ),
  ];
  const endpointStops = await db.transitStop.findMany({
    where: { id: { in: endpointIds } },
    select: { id: true, name: true },
  });
  const stopNameMap = Object.fromEntries(endpointStops.map((s) => [s.id, s.name]));

  const result = routes.map((r) => ({
    id: r.id,
    shortName: r.shortName,
    longName: r.longName,
    type: r.type,
    stopCount: r.stopIds.length,
    firstStop: stopNameMap[r.stopIds[0]] ?? null,
    lastStop:  stopNameMap[r.stopIds[r.stopIds.length - 1]] ?? null,
    fareMin: r.fareMin,
    fareMax: r.fareMax,
    fareNote: r.fareNote,
    operatingHours: r.operatingHours,
    frequency: r.frequency,
    color: r.color,
  }));

  return NextResponse.json({ routes: result, total: result.length });
}
