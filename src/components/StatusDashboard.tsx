"use server";

import StatusGrid from "./StatusGrid";
import { db } from "@/lib/db";

interface CheckResult {
  ok: boolean;
  detail: string;
}

async function runChecks(): Promise<Record<string, CheckResult>> {
  const checks: Record<string, CheckResult> = {};

  // Prisma + Supabase DB
  try {
    await db.$queryRaw`SELECT 1`;
    const [profiles, weatherCache, routeHistory] = await Promise.all([
      db.profile.count(),
      db.weatherCache.count(),
      db.routeHistory.count(),
    ]);
    checks["Database (Prisma + Supabase)"] = {
      ok: true,
      detail: `profiles: ${profiles} · weather_cache: ${weatherCache} · routes_history: ${routeHistory}`,
    };
  } catch (e) {
    checks["Database (Prisma + Supabase)"] = { ok: false, detail: String(e) };
  }

  // BMKG — sole weather source (Indonesia only)
  try {
    const res = await fetch(
      "https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=31.71.06.1001",
      { signal: AbortSignal.timeout(6000) },
    );
    const json = res.ok ? await res.json() : null;
    const desa = json?.data?.[0]?.lokasi?.desa ?? "—";
    checks["BMKG (Indonesia weather — primary)"] = {
      ok: res.ok,
      detail: res.ok ? `Reachable · station: ${desa}` : `HTTP ${res.status}`,
    };
  } catch (e) {
    checks["BMKG (Indonesia weather — primary)"] = { ok: false, detail: String(e) };
  }

  // OSRM routing (free, no key)
  try {
    const res = await fetch(
      "https://router.project-osrm.org/route/v1/car/106.8456,-6.2088;106.7973,-6.2442?overview=false",
      { signal: AbortSignal.timeout(8000) },
    );
    const json = res.ok ? await res.json() : null;
    checks["OSRM Routing (free)"] = {
      ok: res.ok && json?.code === "Ok",
      detail: json?.code === "Ok"
        ? `Reachable — ${Math.round(json.routes[0].distance)}m route found`
        : `HTTP ${res.status}`,
    };
  } catch (e) {
    checks["OSRM Routing (free)"] = { ok: false, detail: String(e) };
  }

  return checks;
}

const CLIENT_MODULES = [
  { name: "React Leaflet (OSM Maps)", pkg: "react-leaflet" },
  { name: "Motion / Framer Motion", pkg: "motion" },
  { name: "Zustand State", pkg: "zustand" },
  { name: "shadcn/ui + Tailwind 4", pkg: "shadcn" },
];

export default async function StatusDashboard() {
  const serverChecks = await runChecks();
  return <StatusGrid serverChecks={serverChecks} clientModules={CLIENT_MODULES} />;
}
