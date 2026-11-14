import type { NextRequest } from "next/server";
import { plan } from "@/lib/core/plan";
import { RainField } from "@/lib/core/rainfield";
import type { Leg } from "@/lib/core/router";
import {
  type RainReport,
  reportCells,
  SCENARIOS,
  type Scenario,
  scenarioCells,
  validCells,
} from "@/lib/core/scenarios";
import { getNetwork } from "@/lib/server/network";
import { road } from "@/lib/server/osrm";
import { BBOX, getRainGrid } from "@/lib/weather/rain-grid";

// POST { from, to, depart?, beta?, moto?, scenario? }
//   → fastest and weather-aware itineraries, raincoat alerts, rain source

interface Body {
  from: { lat: number; lng: number; name?: string };
  to: { lat: number; lng: number; name?: string };
  depart?: number;
  beta?: number;
  moto?: "ojek" | "own" | "none";
  scenario?: Scenario;
  vot?: number;
  maxOjek?: number;
  reports?: RainReport[];
  cells?: unknown;
}

const inBox = (p: { lat: number; lng: number } | undefined) =>
  !!p &&
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lng) &&
  p.lat >= BBOX.lat0 - 0.3 &&
  p.lat <= BBOX.lat1 + 0.3 &&
  p.lng >= BBOX.lng0 - 0.3 &&
  p.lng <= BBOX.lng1 + 0.3;

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!inBox(body.from) || !inBox(body.to)) {
    return Response.json(
      { error: "from and to must be inside Jabodetabek" },
      { status: 422 },
    );
  }
  const beta = Math.min(8, Math.max(0, Number(body.beta ?? 1)));
  const depart = Number.isFinite(body.depart)
    ? Number(body.depart)
    : Date.now();
  const scenario: Scenario = SCENARIOS.includes(body.scenario as Scenario)
    ? (body.scenario as Scenario)
    : "live";

  const [net, grid, motoRoad] = await Promise.all([
    getNetwork(),
    getRainGrid().catch(() => null),
    body.moto === "none"
      ? Promise.resolve(null)
      : road("car", body.from, body.to),
  ]);
  // travellers' "it's raining here" reports join the forecast
  const reports = (Array.isArray(body.reports) ? body.reports : [])
    .filter(
      (r) =>
        inBox(r) &&
        Number.isFinite(r.t) &&
        Number.isFinite(r.mmh) &&
        Math.abs(r.t - depart) < 3 * 3_600_000,
    )
    .slice(0, 20)
    .map((r) => ({ ...r, mmh: Math.min(60, Math.max(0, r.mmh)) }));
  // a re-plan mid-trip sends the storms it already had, moved on in time
  const cells = [
    ...(validCells(body.cells) ?? scenarioCells(scenario, body.from, body.to)),
    ...reportCells(reports, depart),
  ];
  const rain = new RainField(grid, cells, depart);
  const result = plan(net, rain, body.from, body.to, depart, {
    beta,
    moto: body.moto ?? "ojek",
    motoRoad: motoRoad ?? undefined,
    vot: Math.min(10_000, Math.max(0, Number(body.vot ?? 0) || 0)),
    maxOjek: Math.min(1_000_000, Math.max(0, Number(body.maxOjek ?? 0) || 0)),
  });

  await snapWalks(result);

  return Response.json({
    ...result,
    network: { version: net.file.version, builtAt: net.file.builtAt },
    rain: grid
      ? { source: grid.source, issuedAt: grid.issuedAt }
      : { source: "unavailable", issuedAt: null },
    scenario,
    cells,
  });
}

/**
 * Draw walk legs along real footpaths (OSRM foot profile), and first-mile
 * ojek rides along roads, instead of a straight line through buildings and
 * rivers. Geometry only: times, rain and
 * cost stay what the router computed (its walk times already include the
 * 1.3 detour factor). Gives up after 3.5 s and keeps the straight lines.
 */
async function snapWalks(r: ReturnType<typeof plan>) {
  const legs = new Set<Leg>();
  // walks, and first-mile ojek rides still drawn as a straight line
  for (const it of [
    r.fastest,
    r.weatherAware,
    r.options.transit0,
    r.options.transitB,
    r.options.moto,
    r.options.ojekTransit,
  ])
    for (const g of it?.legs ?? [])
      if (g.kind === "walk" || (g.kind === "moto" && g.path.length <= 2))
        legs.add(g);
  const job = Promise.all(
    [...legs].map(async (g) => {
      const m = Math.hypot(
        (g.to.lat - g.from.lat) * 110.6,
        (g.to.lng - g.from.lng) * 111.3,
      );
      if (m < 0.04) return; // under ~40 m: a straight line is the truth
      const w = await road(g.kind === "moto" ? "car" : "foot", g.from, g.to);
      // footpaths in Jakarta's OSM often detour 2–3× the straight line
      // (gated terminals, rivers); beyond 3.5× the snap is to the wrong side
      if (w && w.path.length >= 2 && w.meters < m * 1000 * 3.5)
        g.path = [[g.from.lat, g.from.lng], ...w.path, [g.to.lat, g.to.lng]];
    }),
  );
  await Promise.race([job, new Promise((ok) => setTimeout(ok, 3500))]);
}
