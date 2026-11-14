import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// POST one "is it raining where you are?" answer from a trip.
// Location is rounded to ~100 m; nothing else about the traveller is kept.

const num = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (
    !b ||
    typeof b.deviceId !== "string" ||
    b.deviceId.length > 64 ||
    !num(b.lat) ||
    !num(b.lng) ||
    !num(b.t) ||
    !num(b.mmh) ||
    Math.abs(b.lat + 6.2) > 1 ||
    Math.abs(b.lng - 106.8) > 1
  )
    return NextResponse.json({ error: "invalid report" }, { status: 400 });
  try {
    const row = await db.rainReport.create({
      data: {
        deviceId: b.deviceId,
        at: new Date(b.t),
        lat: r3(b.lat),
        lng: r3(b.lng),
        mmh: Math.min(60, Math.max(0, b.mmh)),
        forecastMmh: num(b.forecastMmh) ? Math.max(0, b.forecastMmh) : 0,
        moment: b.moment === "end" ? "end" : "mid",
        scenario: String(b.scenario ?? "live").slice(0, 24),
        simulated: !!b.simulated,
      },
      select: { id: true },
    });
    return NextResponse.json(row);
  } catch (e) {
    // table not pushed yet, or the database is down: the app carries on
    console.warn("[reports]", e);
    return NextResponse.json({ error: "not saved" }, { status: 503 });
  }
}
