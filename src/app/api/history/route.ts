import { type NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

interface LogRow {
  deviceId: string;
  depart: number;
  beta: number;
  moto: string;
  vot?: number;
  maxOjek?: number;
  scenario: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  rainSource: string;
  rainIssuedAt: number | null;
  networkVersion: string;
  offline: boolean;
  shift: boolean;
  fastest: Prisma.InputJsonValue | null;
  weatherAware: Prisma.InputJsonValue | null;
}

const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);

function valid(r: Partial<LogRow>): r is LogRow {
  return (
    typeof r.deviceId === "string" &&
    r.deviceId.length <= 64 &&
    num(r.depart) &&
    num(r.beta) &&
    num(r.originLat) &&
    num(r.originLng) &&
    num(r.destLat) &&
    num(r.destLng)
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });

  // batch from the app's offline queue (Dexie)
  if (Array.isArray(body.rows)) {
    const rows = (body.rows as Partial<LogRow>[]).slice(0, 100).filter(valid);
    if (!rows.length) return NextResponse.json({ saved: 0 });
    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    const { count } = await db.planLog.createMany({
      data: rows.map((r) => ({
        deviceId: r.deviceId,
        depart: new Date(r.depart),
        beta: r.beta,
        moto: String(r.moto ?? "ojek").slice(0, 8),
        vot: num(r.vot) ? Number(r.vot) : 0,
        maxOjek: num(r.maxOjek) ? Number(r.maxOjek) : 0,
        scenario: String(r.scenario ?? "live").slice(0, 24),
        originLat: r3(r.originLat),
        originLng: r3(r.originLng),
        destLat: r3(r.destLat),
        destLng: r3(r.destLng),
        rainSource: String(r.rainSource ?? "").slice(0, 120),
        rainIssuedAt: r.rainIssuedAt ? new Date(r.rainIssuedAt) : null,
        networkVersion: String(r.networkVersion ?? "").slice(0, 16),
        offline: !!r.offline,
        shift: !!r.shift,
        fastest: r.fastest ?? undefined,
        weatherAware: r.weatherAware ?? undefined,
      })),
    });
    return NextResponse.json({ saved: count }, { status: 201 });
  }

  // legacy single entry (data-testing dashboard)
  const {
    origin,
    destination,
    chosenMode,
    weatherIntensity,
    discomfortScore,
    routeLabel,
  } = body;
  if (
    !origin ||
    !destination ||
    !chosenMode ||
    !weatherIntensity ||
    discomfortScore == null
  ) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
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
  const limit = Math.min(
    Number.parseInt(searchParams.get("limit") ?? "50", 10),
    200,
  );
  const history = await db.routeHistory.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json(history);
}
