import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/transit?types=krl,mrt,lrt
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const typesParam = searchParams.get("types");
  const types = typesParam ? typesParam.split(",").map((t) => t.trim()) : ["krl", "mrt", "lrt"];

  const stops = await db.transitStop.findMany({
    where: { type: { in: types } },
    select: { id: true, name: true, lat: true, lng: true, type: true },
    orderBy: { type: "asc" },
  });

  return NextResponse.json({ stops });
}
