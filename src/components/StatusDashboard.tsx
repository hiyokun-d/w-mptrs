"use server";

import StatusGrid from "./StatusGrid";
import { db } from "@/lib/db";

interface CheckResult {
  ok: boolean;
  detail: string;
}

export interface QuotaRow {
  service: string;
  tier: string;
  dailyLimit: string;
  monthlyLimit: string;
  note: string;
  tracked: boolean;
  ok: boolean;
}

export interface TransitStat {
  type: string;
  label: string;
  color: string;
  stops: number;
  routes: number;
}

async function runChecks(): Promise<Record<string, CheckResult>> {
  const checks: Record<string, CheckResult> = {};

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

async function getTransitStats(): Promise<TransitStat[]> {
  try {
    const types = ["transjakarta", "mrt", "lrt", "krl"] as const;
    const results = await Promise.all(
      types.map(async (t) => {
        const [stops, routes] = await Promise.all([
          db.transitStop.count({ where: { type: t } }),
          db.transitRoute.count({ where: { type: t } }),
        ]);
        return { type: t, stops, routes };
      }),
    );

    const META: Record<string, { label: string; color: string }> = {
      transjakarta: { label: "TransJakarta", color: "#f59e0b" },
      mrt:          { label: "MRT Jakarta",  color: "#ef4444" },
      lrt:          { label: "LRT Jakarta",  color: "#10b981" },
      krl:          { label: "KRL Commuter", color: "#3b82f6" },
    };

    return results.map((r) => ({
      type: r.type,
      label: META[r.type]?.label ?? r.type,
      color: META[r.type]?.color ?? "#94a3b8",
      stops: r.stops,
      routes: r.routes,
    }));
  } catch {
    return [];
  }
}

const QUOTA_TABLE: QuotaRow[] = [
  {
    service: "BMKG (Indonesia weather)",
    tier: "Free — Government API",
    dailyLimit: "Unlimited",
    monthlyLimit: "Unlimited",
    note: "No key required. Official BMKG open data.",
    tracked: false,
    ok: true,
  },
  {
    service: "OSRM Routing",
    tier: "Free — Community server",
    dailyLimit: "Unlimited*",
    monthlyLimit: "Unlimited*",
    note: "* Fair-use policy. No published rate limit. Self-host option available.",
    tracked: false,
    ok: true,
  },
  {
    service: "OpenWeatherMap",
    tier: "Free tier",
    dailyLimit: "1,000 calls/day",
    monthlyLimit: "~30,000 calls",
    note: "60 calls/min max. Used as fallback only — calls not tracked server-side.",
    tracked: false,
    ok: true,
  },
  {
    service: "Supabase (database + auth)",
    tier: "Free tier",
    dailyLimit: "Unlimited queries",
    monthlyLimit: "500 MB storage · 2 GB bandwidth",
    note: "50K monthly active users · 5 GB file storage. Pauses after 1 week inactivity.",
    tracked: true,
    ok: true,
  },
  {
    service: "OpenStreetMap Tiles",
    tier: "Free — Community tiles",
    dailyLimit: "Unlimited*",
    monthlyLimit: "Unlimited*",
    note: "* Tile usage policy applies (no bulk crawling). No key required.",
    tracked: false,
    ok: true,
  },
];

const CLIENT_MODULES = [
  { name: "React Leaflet (OSM Maps)", pkg: "react-leaflet" },
  { name: "Motion / Framer Motion", pkg: "motion" },
  { name: "Zustand State", pkg: "zustand" },
  { name: "shadcn/ui + Tailwind 4", pkg: "shadcn" },
];

export default async function StatusDashboard() {
  const [serverChecks, transitStats] = await Promise.all([
    runChecks(),
    getTransitStats(),
  ]);

  return (
    <StatusGrid
      serverChecks={serverChecks}
      clientModules={CLIENT_MODULES}
      quotaTable={QUOTA_TABLE}
      transitStats={transitStats}
    />
  );
}
