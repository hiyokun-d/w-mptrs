import { db } from "@/lib/db";
import type {
  Coordinates, RainfallIntensity,
  RouteSegment, TransitPlan, TransitPlanLine, TransportMode,
} from "@/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const TRANSIT_SPEED_MS: Record<string, number> = {
  transjakarta: 25 / 3.6,
  krl:          50 / 3.6,
  mrt:          55 / 3.6,
  lrt:          45 / 3.6,
};
const DWELL_PER_STOP_S = 45;
const WALK_SPEED_MS    = 1.2;
const MAX_NEARBY_STOPS = 15;
const MAX_STOP_SAMPLES = 50;
const MAX_DIRECT_PLANS = 4;
const MAX_TRANSFER_PLANS = 3;
const MAX_PLANS        = 6;

// Adaptive radius tiers per weather intensity (origin + dest)
const RADIUS_TIERS: Record<RainfallIntensity, number[]> = {
  none:     [1000, 1500],
  light:    [1000, 1500],
  moderate: [800,  1200, 1500],
  heavy:    [600,  900,  1200],
  extreme:  [500,  800,  1000],
};

// Max acceptable walk distance per intensity (meters). Beyond this, candidate skipped.
const MAX_WALK_M: Record<RainfallIntensity, number> = {
  none: 1500, light: 1200, moderate: 900, heavy: 600, extreme: 400,
};

// Lower = more preferred (rail > BRT)
const MODE_PREFERENCE: Record<string, number> = { mrt: 1, lrt: 2, krl: 3, transjakarta: 4 };

// Fraction of transit time that is sheltered from rain
const SHELTER_FACTOR: Record<string, number> = { mrt: 1.0, lrt: 1.0, krl: 0.92, transjakarta: 0.78 };

// How much rain penalises each minute of walking (additive to travel time)
const RAIN_WALK_PENALTY: Record<RainfallIntensity, number> = {
  none: 0, light: 0.4, moderate: 1.0, heavy: 2.0, extreme: 3.0,
};

const OSRM_FOOT = [
  "https://router.project-osrm.org",
  "https://routing.openstreetmap.de/routed-foot",
];

// ── Utilities ─────────────────────────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function osrmWalk(from: Coordinates, to: Coordinates) {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  for (const base of OSRM_FOOT) {
    try {
      const res = await fetch(
        `${base}/route/v1/foot/${coords}?overview=full&geometries=geojson`,
        { signal: AbortSignal.timeout(6_000), cache: "no-store" },
      );
      if (!res.ok) continue;
      const json = await res.json();
      if (json.code !== "Ok" || !json.routes?.[0]) continue;
      const r = json.routes[0];
      return { distanceMeters: r.distance as number, durationSeconds: r.duration as number, geometry: r.geometry.coordinates as [number, number][] };
    } catch { /* try next */ }
  }
  return haversineFallback(from, to);
}

function haversineFallback(from: Coordinates, to: Coordinates) {
  const d = haversine(from.lat, from.lng, to.lat, to.lng);
  return {
    distanceMeters: d,
    durationSeconds: d / WALK_SPEED_MS,
    geometry: [[from.lng, from.lat], [to.lng, to.lat]] as [number, number][],
  };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

type NearbyStop = { id: string; name: string; lat: number; lng: number; type: string; distM: number };

async function nearbyStops(lat: number, lng: number, radiusM: number): Promise<NearbyStop[]> {
  const latD = radiusM / 111_000;
  const lngD = radiusM / (111_000 * Math.cos((lat * Math.PI) / 180));

  const rows = await db.transitStop.findMany({
    where: { lat: { gte: lat - latD, lte: lat + latD }, lng: { gte: lng - lngD, lte: lng + lngD } },
    select: { id: true, name: true, lat: true, lng: true, type: true },
  });

  return rows
    .map((s) => ({ ...s, distM: haversine(lat, lng, s.lat, s.lng) }))
    .filter((s) => s.distM <= radiusM)
    .sort((a, b) => a.distM - b.distM)
    .slice(0, MAX_NEARBY_STOPS);
}

// Expands radius until enough stops are found (or max tier reached)
async function nearbyStopsAdaptive(
  lat: number, lng: number, intensity: RainfallIntensity
): Promise<NearbyStop[]> {
  const tiers = RADIUS_TIERS[intensity] ?? RADIUS_TIERS.none;
  for (const radius of tiers) {
    const stops = await nearbyStops(lat, lng, radius);
    if (stops.length >= 2) return stops;
  }
  // Final fallback at largest tier
  return nearbyStops(lat, lng, tiers[tiers.length - 1]);
}

// Filter candidates whose board walk exceeds rain tolerance — but keep at least 2
function applyWalkCap(
  candidates: DirectCandidate[],
  intensity: RainfallIntensity,
): DirectCandidate[] {
  const cap = MAX_WALK_M[intensity];
  const within = candidates.filter((c) => c.board.distM <= cap);
  return within.length >= 2 ? within : candidates.slice(0, 4);
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function weatherScore(
  walkBoardSecs: number,
  walkAlightSecs: number,
  transitSecs: number,
  intensity: RainfallIntensity,
  type: string,
  transfers: number,
): number {
  const walkMins = (walkBoardSecs + walkAlightSecs) / 60;
  const totalMins = (walkBoardSecs + walkAlightSecs + transitSecs) / 60;
  const rainPenalty = walkMins * RAIN_WALK_PENALTY[intensity];
  const transferPenalty = transfers * 4; // 4-minute penalty per transfer
  const modePref = (MODE_PREFERENCE[type] ?? 4) * 2;
  return totalMins + rainPenalty + transferPenalty + modePref;
}

// ── Safety note ───────────────────────────────────────────────────────────────

function buildSafetyNote(type: string, totalWalkM: number, transfers: number): string {
  const transferNote = transfers > 0 ? " One transfer required." : "";
  if (type === "mrt") return `Fully air-conditioned. Sheltered at every station.${transferNote}`;
  if (type === "lrt") return `Elevated rail — sheltered stations.${transferNote}`;
  if (type === "krl") return `Mostly sheltered — some open-air platforms.${transferNote}`;
  if (totalWalkM < 250) return `Very short walk to covered halte.${transferNote}`;
  if (totalWalkM < 500) return `Short walk to TransJakarta halte. Use cover if raining.${transferNote}`;
  return `${Math.round(totalWalkM)}m total walking — bring an umbrella.${transferNote}`;
}

// ── Direct candidate type ─────────────────────────────────────────────────────

interface RouteBase {
  id: string; shortName: string; longName: string; type: string; stopIds: string[];
  fareMin: number; fareMax: number; fareNote: string;
  operatingHours: string; frequency: number; color: string;
}

interface DirectCandidate {
  kind: "direct";
  routeId: string; shortName: string; longName: string; type: string; stopIds: string[];
  meta: RouteMeta;
  board:  NearbyStop & { idx: number };
  alight: NearbyStop & { idx: number };
  stopCount: number;
  transitDistM: number;
  transitSecs: number;
}

// ── Transfer candidate type ───────────────────────────────────────────────────

interface TransferCandidate {
  kind: "transfer";
  route1: RouteBase;
  route2: RouteBase;
  board:    NearbyStop & { idx: number };
  transfer: { id: string; name: string; lat: number; lng: number; idx1: number; idx2: number };
  alight:   NearbyStop & { idx: number };
  stopCount1: number; stopCount2: number;
  transit1DistM: number; transit2DistM: number;
  transit1Secs: number;  transit2Secs: number;
}

type AnyCandidate = DirectCandidate | TransferCandidate;

// ── Direct route search ───────────────────────────────────────────────────────

const ROUTE_META_SELECT = {
  id: true, shortName: true, longName: true, type: true, stopIds: true,
  fareMin: true, fareMax: true, fareNote: true, operatingHours: true, frequency: true, color: true,
} as const;

async function findDirectCandidates(
  oStops: NearbyStop[],
  dStops: NearbyStop[],
): Promise<DirectCandidate[]> {
  const oIds = oStops.map((s) => s.id);
  const dIds = dStops.map((s) => s.id);

  const routes = await db.transitRoute.findMany({
    where: { AND: [{ stopIds: { hasSome: oIds } }, { stopIds: { hasSome: dIds } }] },
    select: ROUTE_META_SELECT,
  });

  const oMap = new Map(oStops.map((s) => [s.id, s]));
  const dMap = new Map(dStops.map((s) => [s.id, s]));
  const candidates: DirectCandidate[] = [];

  for (const route of routes) {
    const boardCands = route.stopIds
      .map((id, idx) => oMap.has(id) ? { ...oMap.get(id)!, idx } : null)
      .filter((x): x is NonNullable<typeof x> => x !== null);

    for (const board of boardCands.slice(0, 3)) {
      const alightCands = route.stopIds
        .map((id, idx) => dMap.has(id) ? { ...dMap.get(id)!, idx } : null)
        .filter((x): x is NonNullable<typeof x> => x !== null && x.idx > board.idx);
      if (!alightCands.length) continue;

      const alight = alightCands[0];
      const stopCount = alight.idx - board.idx;
      if (stopCount < 1) continue;

      const transitDistM = haversine(board.lat, board.lng, alight.lat, alight.lng);
      const speed = TRANSIT_SPEED_MS[route.type] ?? TRANSIT_SPEED_MS.transjakarta;
      const transitSecs = transitDistM / speed + stopCount * DWELL_PER_STOP_S;

      candidates.push({
        kind: "direct",
        routeId: route.id, shortName: route.shortName, longName: route.longName,
        type: route.type, stopIds: route.stopIds,
        meta: { fareMin: route.fareMin, fareMax: route.fareMax, fareNote: route.fareNote, operatingHours: route.operatingHours, frequency: route.frequency, color: route.color },
        board, alight, stopCount, transitDistM, transitSecs,
      });
    }
  }
  return candidates;
}

// ── Transfer route search ─────────────────────────────────────────────────────

async function findTransferCandidates(
  oStops: NearbyStop[],
  dStops: NearbyStop[],
  directRouteIds: Set<string>,
): Promise<TransferCandidate[]> {
  const oIds = oStops.map((s) => s.id);
  const dIds = dStops.map((s) => s.id);

  // Routes serving origin area and routes serving dest area
  const [origRoutes, destRoutes] = await Promise.all([
    db.transitRoute.findMany({
      where: { stopIds: { hasSome: oIds } },
      select: ROUTE_META_SELECT,
      take: 8,
    }),
    db.transitRoute.findMany({
      where: { stopIds: { hasSome: dIds } },
      select: ROUTE_META_SELECT,
      take: 8,
    }),
  ]);

  // Collect candidate transfer stop IDs: intersection of each route pair
  const transferStopIds = new Set<string>();
  const routePairs: [typeof origRoutes[0], typeof destRoutes[0]][] = [];

  for (const r1 of origRoutes) {
    for (const r2 of destRoutes) {
      if (r1.id === r2.id) continue;
      const r1Set = new Set(r1.stopIds);
      const shared = r2.stopIds.filter((id) => r1Set.has(id));
      if (shared.length) {
        shared.forEach((id) => transferStopIds.add(id));
        routePairs.push([r1, r2]);
      }
    }
  }

  if (!transferStopIds.size) return [];

  // Fetch transfer stop details
  const transferStopRows = await db.transitStop.findMany({
    where: { id: { in: [...transferStopIds] } },
    select: { id: true, name: true, lat: true, lng: true },
  });
  const transferStopMap = new Map(transferStopRows.map((s) => [s.id, s]));

  const oMap = new Map(oStops.map((s) => [s.id, s]));
  const dMap = new Map(dStops.map((s) => [s.id, s]));
  const candidates: TransferCandidate[] = [];

  for (const [r1, r2] of routePairs) {
    const r1Set = new Set(r1.stopIds);
    const sharedIds = r2.stopIds.filter((id) => r1Set.has(id));

    for (const tId of sharedIds.slice(0, 3)) {
      const tStop = transferStopMap.get(tId);
      if (!tStop) continue;

      const idx1 = r1.stopIds.indexOf(tId);
      const idx2 = r2.stopIds.indexOf(tId);

      // Board candidates on r1 that are before the transfer
      const boardCands = r1.stopIds
        .map((id, idx) => oMap.has(id) ? { ...oMap.get(id)!, idx } : null)
        .filter((x): x is NonNullable<typeof x> => x !== null && x.idx < idx1);
      if (!boardCands.length) continue;
      const board = boardCands.sort((a, b) => a.distM - b.distM)[0];

      // Alight candidates on r2 that are after the transfer
      const alightCands = r2.stopIds
        .map((id, idx) => dMap.has(id) ? { ...dMap.get(id)!, idx } : null)
        .filter((x): x is NonNullable<typeof x> => x !== null && x.idx > idx2);
      if (!alightCands.length) continue;
      const alight = alightCands[0];

      const stopCount1 = idx1 - board.idx;
      const stopCount2 = alight.idx - idx2;
      if (stopCount1 < 1 || stopCount2 < 1) continue;

      const speed1 = TRANSIT_SPEED_MS[r1.type] ?? TRANSIT_SPEED_MS.transjakarta;
      const speed2 = TRANSIT_SPEED_MS[r2.type] ?? TRANSIT_SPEED_MS.transjakarta;

      const transit1DistM = haversine(board.lat, board.lng, tStop.lat, tStop.lng);
      const transit2DistM = haversine(tStop.lat, tStop.lng, alight.lat, alight.lng);
      const transit1Secs  = transit1DistM / speed1 + stopCount1 * DWELL_PER_STOP_S;
      const transit2Secs  = transit2DistM / speed2 + stopCount2 * DWELL_PER_STOP_S;

      candidates.push({
        kind: "transfer",
        route1: r1, route2: r2,
        board, alight,
        transfer: { ...tStop, idx1, idx2 },
        stopCount1, stopCount2,
        transit1DistM, transit2DistM,
        transit1Secs, transit2Secs,
      });
    }
  }

  return candidates;
}

// ── Scoring + dedup ───────────────────────────────────────────────────────────

function getWalkSecs(c: AnyCandidate, origin: Coordinates, dest: Coordinates) {
  if (c.kind === "direct") {
    return {
      walkBoardSecs:  c.board.distM / WALK_SPEED_MS,
      walkAlightSecs: c.alight.distM / WALK_SPEED_MS,
    };
  }
  return {
    walkBoardSecs:  c.board.distM / WALK_SPEED_MS,
    walkAlightSecs: c.alight.distM / WALK_SPEED_MS,
  };
}

function transitSecs(c: AnyCandidate): number {
  if (c.kind === "direct") return c.transitSecs;
  return c.transit1Secs + c.transit2Secs;
}

function primaryType(c: AnyCandidate): string {
  if (c.kind === "direct") return c.type;
  return c.route1.type; // prefer the first leg's type
}

function candidateKey(c: AnyCandidate): string {
  if (c.kind === "direct") return `D:${c.routeId}|${c.board.id}|${c.alight.id}`;
  return `T:${c.route1.id}|${c.route2.id}|${c.board.id}|${c.transfer.id}|${c.alight.id}`;
}

function rankCandidates(
  candidates: AnyCandidate[],
  intensity: RainfallIntensity,
  origin: Coordinates,
  dest: Coordinates,
): AnyCandidate[] {
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    const k = candidateKey(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return unique.sort((a, b) => {
    const wa = getWalkSecs(a, origin, dest);
    const wb = getWalkSecs(b, origin, dest);
    const sa = weatherScore(wa.walkBoardSecs, wa.walkAlightSecs, transitSecs(a), intensity, primaryType(a), a.kind === "transfer" ? 1 : 0);
    const sb = weatherScore(wb.walkBoardSecs, wb.walkAlightSecs, transitSecs(b), intensity, primaryType(b), b.kind === "transfer" ? 1 : 0);
    return sa - sb;
  });
}

// ── Fare estimation ───────────────────────────────────────────────────────────

interface RouteMeta {
  fareMin: number; fareMax: number; fareNote: string;
  operatingHours: string; frequency: number; color: string;
}

function estimateFare(meta: RouteMeta, stopCount: number, distM: number): number {
  if (meta.fareMin === meta.fareMax) return meta.fareMin; // flat fare
  // KRL: Rp3.000 base + Rp1.000 per 10km
  const distKm = distM / 1000;
  if (distKm > 0) {
    const krlFare = 3000 + Math.max(0, Math.ceil((distKm - 25) / 10)) * 1000;
    if (krlFare >= meta.fareMin && krlFare <= meta.fareMax) return krlFare;
  }
  // MRT progressive by stop count
  if (stopCount <= 2)  return Math.max(meta.fareMin, 3000);
  if (stopCount <= 4)  return Math.max(meta.fareMin, 5000);
  if (stopCount <= 6)  return Math.max(meta.fareMin, 8500);
  if (stopCount <= 8)  return Math.max(meta.fareMin, 11000);
  return meta.fareMax;
}

// ── Build TransitPlan metadata ────────────────────────────────────────────────

function buildPlanMeta(
  c: AnyCandidate,
  rank: number,
  walkToBoard: { distanceMeters: number; durationSeconds: number },
  walkFromAlight: { distanceMeters: number; durationSeconds: number },
  routeMeta: Map<string, RouteMeta>,
): TransitPlan {
  const totalWalkM    = walkToBoard.distanceMeters + walkFromAlight.distanceMeters;
  const transitTotal  = transitSecs(c);
  const totalDuration = walkToBoard.durationSeconds + transitTotal + walkFromAlight.durationSeconds;
  const totalDist     = walkToBoard.distanceMeters + (c.kind === "direct" ? c.transitDistM : c.transit1DistM + c.transit2DistM) + walkFromAlight.distanceMeters;
  const type          = primaryType(c);
  const sf            = SHELTER_FACTOR[type] ?? 0.75;
  const shelteredPct  = Math.round((transitTotal * sf) / totalDuration * 100);
  const rainExpMin    = Math.round((walkToBoard.durationSeconds + walkFromAlight.durationSeconds) / 60 * 10) / 10;

  const lines: TransitPlanLine[] = c.kind === "direct"
    ? [{ routeId: c.routeId, shortName: c.shortName, longName: c.longName, type: c.type }]
    : [
        { routeId: c.route1.id, shortName: c.route1.shortName, longName: c.route1.longName, type: c.route1.type },
        { routeId: c.route2.id, shortName: c.route2.shortName, longName: c.route2.longName, type: c.route2.type },
      ];

  const transfers   = c.kind === "transfer" ? 1 : 0;
  const shortName   = c.kind === "direct" ? c.shortName : `${c.route1.shortName} → ${c.route2.shortName}`;
  const longName    = c.kind === "direct" ? c.longName  : `${c.route1.longName} → ${c.route2.longName}`;
  const stopCount   = c.kind === "direct" ? c.stopCount : c.stopCount1 + c.stopCount2;
  const transitDistM = c.kind === "direct" ? c.transitDistM : c.transit1DistM + c.transit2DistM;

  // Fare: sum all legs
  let fareEstimateIdr = 0;
  let fareNote = "";
  let operatingHours = "";
  let frequency = 15;
  let color = "#888888";

  if (c.kind === "direct") {
    const m = routeMeta.get(c.routeId);
    if (m) {
      fareEstimateIdr = estimateFare(m, c.stopCount, c.transitDistM);
      fareNote = m.fareNote || `Rp ${fareEstimateIdr.toLocaleString("id-ID")}`;
      operatingHours = m.operatingHours;
      frequency = m.frequency;
      color = m.color;
    }
  } else {
    const m1 = routeMeta.get(c.route1.id);
    const m2 = routeMeta.get(c.route2.id);
    if (m1) fareEstimateIdr += estimateFare(m1, c.stopCount1, c.transit1DistM);
    if (m2) fareEstimateIdr += estimateFare(m2, c.stopCount2, c.transit2DistM);
    const notes = [m1?.fareNote, m2?.fareNote].filter(Boolean).join(" + ");
    fareNote = notes || `Rp ${fareEstimateIdr.toLocaleString("id-ID")}`;
    operatingHours = m1?.operatingHours ?? m2?.operatingHours ?? "";
    frequency = Math.max(m1?.frequency ?? 15, m2?.frequency ?? 15);
    color = m1?.color ?? m2?.color ?? "#888888";
  }

  return {
    id:   candidateKey(c),
    rank,
    type,
    shortName,
    longName,
    lines,
    transfers,
    transferStop: c.kind === "transfer"
      ? { id: c.transfer.id, name: c.transfer.name, lat: c.transfer.lat, lng: c.transfer.lng }
      : undefined,
    boardStop:  { id: c.board.id,  name: c.board.name,  lat: c.board.lat,  lng: c.board.lng },
    alightStop: { id: c.alight.id, name: c.alight.name, lat: c.alight.lat, lng: c.alight.lng },
    stopCount,
    transitDurationSeconds: Math.round(transitTotal),
    transitDistanceMeters:  Math.round(transitDistM),
    walkToBoard:   { distanceMeters: Math.round(walkToBoard.distanceMeters),   durationSeconds: Math.round(walkToBoard.durationSeconds) },
    walkFromAlight:{ distanceMeters: Math.round(walkFromAlight.distanceMeters),durationSeconds: Math.round(walkFromAlight.durationSeconds) },
    totalDurationSeconds: Math.round(totalDuration),
    totalDistanceMeters:  Math.round(totalDist),
    shelteredPct: Math.min(100, Math.max(0, shelteredPct)),
    rainExposureMinutes: rainExpMin,
    modePreference: MODE_PREFERENCE[type] ?? 9,
    safetyNote: buildSafetyNote(type, totalWalkM, transfers),
    fareEstimateIdr,
    fareNote,
    operatingHours,
    frequency,
    color,
  };
}

// ── Build RouteSegment[] for a candidate ──────────────────────────────────────

async function fetchTransitGeometry(stopIds: string[], bIdx: number, aIdx: number): Promise<[number, number][]> {
  const segIds = stopIds.slice(bIdx, aIdx + 1);
  const sampled = segIds.length > MAX_STOP_SAMPLES
    ? [segIds[0], ...segIds.slice(1, -1).filter((_, i) => i % Math.ceil(segIds.length / (MAX_STOP_SAMPLES - 2)) === 0), segIds[segIds.length - 1]]
    : segIds;

  const rows = await db.transitStop.findMany({
    where: { id: { in: sampled } },
    select: { id: true, lat: true, lng: true },
  });
  const coords = new Map(rows.map((r) => [r.id, r]));
  const geo = sampled.map((id) => coords.get(id)).filter(Boolean).map((s) => [s!.lng, s!.lat] as [number, number]);
  return geo.length >= 2 ? geo : [[stopIds[bIdx] as unknown as number, 0]];
}

async function buildDirectSegments(
  c: DirectCandidate,
  origin: Coordinates, dest: Coordinates,
  w1: { distanceMeters: number; durationSeconds: number; geometry: [number, number][] },
  w2: { distanceMeters: number; durationSeconds: number; geometry: [number, number][] },
): Promise<RouteSegment[]> {
  const geo = await fetchTransitGeometry(c.stopIds, c.board.idx, c.alight.idx);
  const segs: RouteSegment[] = [];

  const walkMin1 = Math.round(w1.durationSeconds / 60);
  const walkMin2 = Math.round(w2.durationSeconds / 60);
  if (w1.distanceMeters > 30) segs.push({ mode: "walking", distanceMeters: w1.distanceMeters, durationSeconds: w1.durationSeconds, geometry: w1.geometry, instruction: `Walk ${Math.round(w1.distanceMeters)}m (~${walkMin1} min) to ${c.board.name}` });

  segs.push({
    mode: c.type as TransportMode,
    distanceMeters: c.transitDistM,
    durationSeconds: c.transitSecs,
    geometry: geo.length >= 2 ? geo : [[c.board.lng, c.board.lat], [c.alight.lng, c.alight.lat]],
    transitLine: { routeId: c.routeId, shortName: c.shortName, longName: c.longName },
    boardStop:  { id: c.board.id,  name: c.board.name,  lat: c.board.lat,  lng: c.board.lng },
    alightStop: { id: c.alight.id, name: c.alight.name, lat: c.alight.lat, lng: c.alight.lng },
    stopCount: c.stopCount,
    instruction: `${c.shortName} · ${c.stopCount} stop${c.stopCount > 1 ? "s" : ""} · alight at ${c.alight.name}`,
  });

  if (w2.distanceMeters > 30) segs.push({ mode: "walking", distanceMeters: w2.distanceMeters, durationSeconds: w2.durationSeconds, geometry: w2.geometry, instruction: `Walk ${Math.round(w2.distanceMeters)}m (~${walkMin2} min) to destination` });

  return segs;
}

async function buildTransferSegments(
  c: TransferCandidate,
  origin: Coordinates, dest: Coordinates,
  w1: { distanceMeters: number; durationSeconds: number; geometry: [number, number][] },
  w2: { distanceMeters: number; durationSeconds: number; geometry: [number, number][] },
): Promise<RouteSegment[]> {
  const [geo1, geo2] = await Promise.all([
    fetchTransitGeometry(c.route1.stopIds, c.board.idx, c.transfer.idx1),
    fetchTransitGeometry(c.route2.stopIds, c.transfer.idx2, c.alight.idx),
  ]);

  const segs: RouteSegment[] = [];

  const walkMin1 = Math.round(w1.durationSeconds / 60);
  const walkMin2 = Math.round(w2.durationSeconds / 60);
  if (w1.distanceMeters > 30) segs.push({ mode: "walking", distanceMeters: w1.distanceMeters, durationSeconds: w1.durationSeconds, geometry: w1.geometry, instruction: `Walk ${Math.round(w1.distanceMeters)}m (~${walkMin1} min) to ${c.board.name}` });

  segs.push({
    mode: c.route1.type as TransportMode,
    distanceMeters: c.transit1DistM,
    durationSeconds: c.transit1Secs,
    geometry: geo1,
    transitLine: { routeId: c.route1.id, shortName: c.route1.shortName, longName: c.route1.longName },
    boardStop:  { id: c.board.id,    name: c.board.name,    lat: c.board.lat,    lng: c.board.lng },
    alightStop: { id: c.transfer.id, name: c.transfer.name, lat: c.transfer.lat, lng: c.transfer.lng },
    stopCount: c.stopCount1,
    instruction: `${c.route1.shortName} · ${c.stopCount1} stop${c.stopCount1 > 1 ? "s" : ""} · alight at ${c.transfer.name}`,
  });

  segs.push({
    mode: "walking",
    distanceMeters: 0,
    durationSeconds: 120,
    geometry: [[c.transfer.lng, c.transfer.lat], [c.transfer.lng, c.transfer.lat]],
    instruction: `Transfer at ${c.transfer.name} (~2 min platform change)`,
  });

  segs.push({
    mode: c.route2.type as TransportMode,
    distanceMeters: c.transit2DistM,
    durationSeconds: c.transit2Secs,
    geometry: geo2,
    transitLine: { routeId: c.route2.id, shortName: c.route2.shortName, longName: c.route2.longName },
    boardStop:  { id: c.transfer.id, name: c.transfer.name, lat: c.transfer.lat, lng: c.transfer.lng },
    alightStop: { id: c.alight.id,   name: c.alight.name,   lat: c.alight.lat,   lng: c.alight.lng },
    stopCount: c.stopCount2,
    instruction: `${c.route2.shortName} · ${c.stopCount2} stop${c.stopCount2 > 1 ? "s" : ""} · alight at ${c.alight.name}`,
  });

  if (w2.distanceMeters > 30) segs.push({ mode: "walking", distanceMeters: w2.distanceMeters, durationSeconds: w2.durationSeconds, geometry: w2.geometry, instruction: `Walk ${Math.round(w2.distanceMeters)}m (~${walkMin2} min) to destination` });

  return segs;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function planAllTransitRoutes(
  origin: Coordinates,
  dest: Coordinates,
  intensity: RainfallIntensity = "none",
): Promise<{ plans: TransitPlan[]; primarySegments: RouteSegment[] | null }> {
  if (haversine(origin.lat, origin.lng, dest.lat, dest.lng) < 400) return { plans: [], primarySegments: null };

  // Adaptive radius: tighter search under rain, wider when clear
  const [oStops, dStops] = await Promise.all([
    nearbyStopsAdaptive(origin.lat, origin.lng, intensity),
    nearbyStopsAdaptive(dest.lat, dest.lng, intensity),
  ]);
  if (!oStops.length || !dStops.length) return { plans: [], primarySegments: null };

  // Direct routes first — apply rain walk cap so we don't route users on long wet walks
  let directCands = await findDirectCandidates(oStops, dStops);
  directCands = applyWalkCap(directCands, intensity);
  const directRouteIds = new Set(directCands.map((c) => c.routeId));

  let allCandidates: AnyCandidate[] = [...directCands];

  // Only search for transfers if we have fewer than MAX_DIRECT_PLANS direct options
  if (directCands.length < MAX_DIRECT_PLANS) {
    const transferCands = await findTransferCandidates(oStops, dStops, directRouteIds);
    allCandidates = [...directCands, ...transferCands.slice(0, MAX_TRANSFER_PLANS)];
  }

  if (!allCandidates.length) return { plans: [], primarySegments: null };

  const ranked = rankCandidates(allCandidates, intensity, origin, dest).slice(0, MAX_PLANS);

  // Build route meta map for fare/timing lookup
  const routeMeta = new Map<string, RouteMeta>();
  for (const c of ranked) {
    if (c.kind === "direct") {
      routeMeta.set(c.routeId, c.meta);
    } else {
      routeMeta.set(c.route1.id, { fareMin: c.route1.fareMin, fareMax: c.route1.fareMax, fareNote: c.route1.fareNote, operatingHours: c.route1.operatingHours, frequency: c.route1.frequency, color: c.route1.color });
      routeMeta.set(c.route2.id, { fareMin: c.route2.fareMin, fareMax: c.route2.fareMax, fareNote: c.route2.fareNote, operatingHours: c.route2.operatingHours, frequency: c.route2.frequency, color: c.route2.color });
    }
  }

  // Walk geometry: OSRM for top-3 plans, haversine for rest (all parallel)
  const walkPromises = ranked.map((c, i) => {
    const boardCoord  = { lat: c.board.lat,  lng: c.board.lng };
    const alightCoord = { lat: c.alight.lat, lng: c.alight.lng };
    if (i < 3) return Promise.all([osrmWalk(origin, boardCoord), osrmWalk(alightCoord, dest)]);
    return Promise.resolve([haversineFallback(origin, boardCoord), haversineFallback(alightCoord, dest)] as const);
  });
  const walks = await Promise.all(walkPromises);

  const plans = ranked.map((c, i) => buildPlanMeta(c, i + 1, walks[i][0], walks[i][1], routeMeta));

  // Full segments with transit geometry for rank-1
  const [w1, w2] = walks[0];
  const top = ranked[0];
  let primarySegments: RouteSegment[] | null = null;
  if (top.kind === "direct") {
    primarySegments = await buildDirectSegments(top, origin, dest, w1, w2);
  } else {
    primarySegments = await buildTransferSegments(top, origin, dest, w1, w2);
  }

  return { plans, primarySegments };
}

// ── Build segments for any plan on demand (used by /api/transit/plan) ─────────

export async function buildPlanSegments(
  origin: Coordinates,
  dest: Coordinates,
  routeId: string,
  boardStopId: string,
  alightStopId: string,
): Promise<RouteSegment[] | null> {
  const route = await db.transitRoute.findUnique({
    where: { id: routeId },
    select: ROUTE_META_SELECT,
  });
  if (!route) return null;

  const bIdx = route.stopIds.indexOf(boardStopId);
  const aIdx = route.stopIds.indexOf(alightStopId);
  if (bIdx < 0 || aIdx <= bIdx) return null;

  const [boardStop, alightStop] = await Promise.all([
    db.transitStop.findUnique({ where: { id: boardStopId },  select: { id: true, name: true, lat: true, lng: true } }),
    db.transitStop.findUnique({ where: { id: alightStopId }, select: { id: true, name: true, lat: true, lng: true } }),
  ]);
  if (!boardStop || !alightStop) return null;

  const stopCount = aIdx - bIdx;
  const speed = TRANSIT_SPEED_MS[route.type] ?? TRANSIT_SPEED_MS.transjakarta;
  const transitDistM = haversine(boardStop.lat, boardStop.lng, alightStop.lat, alightStop.lng);
  const transitSecs  = transitDistM / speed + stopCount * DWELL_PER_STOP_S;

  const distM = haversine(origin.lat, origin.lng, boardStop.lat, boardStop.lng);
  const c: DirectCandidate = {
    kind: "direct",
    routeId: route.id, shortName: route.shortName, longName: route.longName,
    type: route.type, stopIds: route.stopIds,
    meta: { fareMin: route.fareMin, fareMax: route.fareMax, fareNote: route.fareNote, operatingHours: route.operatingHours, frequency: route.frequency, color: route.color },
    board:  { ...boardStop,  distM, idx: bIdx, type: route.type },
    alight: { ...alightStop, distM: haversine(dest.lat, dest.lng, alightStop.lat, alightStop.lng), idx: aIdx, type: route.type },
    stopCount, transitDistM, transitSecs,
  };

  const [w1, w2] = await Promise.all([
    osrmWalk(origin, { lat: boardStop.lat, lng: boardStop.lng }),
    osrmWalk({ lat: alightStop.lat, lng: alightStop.lng }, dest),
  ]);

  return buildDirectSegments(c, origin, dest, w1, w2);
}

// backward compat
export async function planTransitRoute(
  origin: Coordinates,
  dest: Coordinates,
): Promise<RouteSegment[] | null> {
  const { primarySegments } = await planAllTransitRoutes(origin, dest, "none");
  return primarySegments;
}
