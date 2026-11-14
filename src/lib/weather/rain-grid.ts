import "server-only";
import type { RainGrid } from "@/lib/core/rainfield";
import { JAKARTA_STATIONS } from "@/lib/weather/bmkg";

// Forecast rain grid over Jabodetabek for the router.
//   primary   Open-Meteo 15-minute precipitation (no key)
//   fallback  BMKG kecamatan forecasts, inverse-distance weighted
// Cached in memory for 10 minutes per server instance.

export const BBOX = { lat0: -6.7, lat1: -5.95, lng0: 106.4, lng1: 107.2 };
const STEP = 0.06; // ≈ 6.7 km
const HORIZON_STEPS = 16; // 4 h of 15-minute steps
const TTL_MS = 10 * 60_000;

let cache: { grid: RainGrid; at: number } | null = null;
let inflight: Promise<RainGrid> | null = null;

export async function getRainGrid(): Promise<RainGrid> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.grid;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const grid = await openMeteo().catch(async (e) => {
        console.warn("[rain] Open-Meteo failed, using BMKG:", e);
        return bmkg();
      });
      cache = { grid, at: Date.now() };
      return grid;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function axes() {
  const nLat = Math.round((BBOX.lat1 - BBOX.lat0) / STEP) + 1;
  const nLng = Math.round((BBOX.lng1 - BBOX.lng0) / STEP) + 1;
  const pts: [number, number][] = [];
  for (let i = 0; i < nLat; i++)
    for (let j = 0; j < nLng; j++)
      pts.push([
        +(BBOX.lat0 + i * STEP).toFixed(4),
        +(BBOX.lng0 + j * STEP).toFixed(4),
      ]);
  return { nLat, nLng, pts };
}

interface OMResponse {
  minutely_15: { time: string[]; precipitation: (number | null)[] };
}

async function openMeteo(): Promise<RainGrid> {
  const { nLat, nLng, pts } = axes();
  const chunks: [number, number][][] = [];
  for (let i = 0; i < pts.length; i += 60) chunks.push(pts.slice(i, i + 60));
  const results = await Promise.all(
    chunks.map(async (c) => {
      const url =
        "https://api.open-meteo.com/v1/forecast?" +
        new URLSearchParams({
          latitude: c.map((p) => p[0]).join(","),
          longitude: c.map((p) => p[1]).join(","),
          minutely_15: "precipitation",
          forecast_minutely_15: String(HORIZON_STEPS),
          past_minutely_15: "1",
          timezone: "GMT",
        });
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        next: { revalidate: 600 },
      });
      if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
      const j = (await res.json()) as OMResponse | OMResponse[];
      return Array.isArray(j) ? j : [j];
    }),
  );
  const series = results.flat();
  if (series.length !== pts.length)
    throw new Error(
      `Open-Meteo returned ${series.length}/${pts.length} points`,
    );
  const times = series[0].minutely_15.time.map((t) => Date.parse(`${t}:00Z`));
  const nt = times.length;
  const values = new Array<number>(nt * nLat * nLng).fill(0);
  series.forEach((s, idx) => {
    s.minutely_15.precipitation.forEach((mm, k) => {
      // mm per 15 minutes → mm/h
      values[k * nLat * nLng + idx] = Math.max(0, (mm ?? 0) * 4);
    });
  });
  return {
    issuedAt: Date.now(),
    source: "Open-Meteo 15-minute forecast",
    lat0: BBOX.lat0,
    lng0: BBOX.lng0,
    dLat: STEP,
    dLng: STEP,
    nLat,
    nLng,
    t0: times[0],
    dt: 15 * 60_000,
    nt,
    values,
  };
}

interface BmkgEntry {
  datetime: string;
  tp: number;
  weather: number;
}

/** BMKG weather code → representative mm/h (BMKG hourly categories) */
function codeRate(code: number): number {
  if (code >= 97) return 25;
  if (code >= 95) return 15;
  if (code >= 80) return 10;
  if (code >= 65) return 15;
  if (code >= 63) return 7.5;
  if (code >= 61) return 3;
  if (code >= 60) return 1;
  return 0;
}

async function bmkg(): Promise<RainGrid> {
  const stations = await Promise.all(
    JAKARTA_STATIONS.map(async (s) => {
      try {
        const res = await fetch(
          `https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${s.adm4}`,
          {
            signal: AbortSignal.timeout(10_000),
            next: { revalidate: 600 },
          },
        );
        if (!res.ok) return null;
        const j = await res.json();
        const entries: BmkgEntry[] = j?.data?.[0]?.cuaca?.flat() ?? [];
        return { lat: s.lat, lng: s.lon, entries };
      } catch {
        return null;
      }
    }),
  );
  const ok = stations.filter(
    (s): s is NonNullable<typeof s> => !!s && s.entries.length > 0,
  );
  if (!ok.length) throw new Error("no weather source available");
  const { nLat, nLng, pts } = axes();
  const t0 = Math.floor(Date.now() / 900_000) * 900_000;
  const nt = HORIZON_STEPS + 1;
  const values = new Array<number>(nt * nLat * nLng).fill(0);
  for (let k = 0; k < nt; k++) {
    const t = t0 + k * 900_000;
    // BMKG steps are 3-hourly; tp is taken as mm per 3 h
    const rate = ok.map((s) => {
      const e = s.entries.reduce((best, x) =>
        Math.abs(Date.parse(x.datetime) - t) <
        Math.abs(Date.parse(best.datetime) - t)
          ? x
          : best,
      );
      return Math.max(e.tp / 3, codeRate(e.weather));
    });
    pts.forEach(([lat, lng], idx) => {
      let wsum = 0;
      let vsum = 0;
      ok.forEach((s, m) => {
        const d2 = (s.lat - lat) ** 2 + (s.lng - lng) ** 2 + 1e-6;
        const w = 1 / d2;
        wsum += w;
        vsum += w * rate[m];
      });
      values[k * nLat * nLng + idx] = vsum / wsum;
    });
  }
  return {
    issuedAt: Date.now(),
    source: `BMKG kecamatan forecasts (${ok.length} points, interpolated)`,
    lat0: BBOX.lat0,
    lng0: BBOX.lng0,
    dLat: STEP,
    dLng: STEP,
    nLat,
    nLng,
    t0,
    dt: 900_000,
    nt,
    values,
  };
}
