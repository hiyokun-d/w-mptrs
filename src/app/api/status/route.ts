import "server-only";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const checks: Record<string, { ok: boolean; detail: string }> = {};

  // Prisma / DB
  try {
    await db.$queryRaw`SELECT 1`;
    const [profiles, weatherCache, routeHistory] = await Promise.all([
      db.profile.count(),
      db.weatherCache.count(),
      db.routeHistory.count(),
    ]);
    checks.database = {
      ok: true,
      detail: `Connected — profiles: ${profiles}, weather_cache: ${weatherCache}, routes_history: ${routeHistory}`,
    };
  } catch (e) {
    checks.database = { ok: false, detail: String(e) };
  }

  // BMKG — Indonesia primary weather source
  try {
    const res = await fetch(
      "https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=31.71.06.1001",
      { signal: AbortSignal.timeout(6000) },
    );
    const json = res.ok ? await res.json() : null;
    const station = json?.lokasi?.desa ?? "Menteng";
    checks["BMKG (Indonesia weather)"] = {
      ok: res.ok,
      detail: res.ok ? `Reachable — station: ${station}` : `HTTP ${res.status}`,
    };
  } catch (e) {
    checks["BMKG (Indonesia weather)"] = { ok: false, detail: String(e) };
  }

  // OSRM routing (free, no API key)
  try {
    const res = await fetch(
      "https://router.project-osrm.org/route/v1/car/106.8456,-6.2088;106.7973,-6.2442?overview=false",
      { signal: AbortSignal.timeout(8000) },
    );
    const json = res.ok ? await res.json() : null;
    checks["OSRM Routing (free)"] = {
      ok: res.ok && json?.code === "Ok",
      detail: json?.code === "Ok"
        ? `Reachable — dist: ${Math.round(json.routes[0].distance)}m`
        : `HTTP ${res.status}`,
    };
  } catch (e) {
    checks["OSRM Routing (free)"] = { ok: false, detail: String(e) };
  }

  return NextResponse.json(checks);
}
