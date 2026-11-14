import { sampleGrid } from "@/lib/core/rainfield";
import { JAKARTA_STATIONS } from "@/lib/weather/bmkg";
import { getRainGrid } from "@/lib/weather/rain-grid";

// POST {pts: [{lat, lng, t}]} → what each source says about that place and
// time, so the trip video can quote them by name:
//   bmkg       the nearest BMKG kecamatan forecast (3-hourly, with its words)
//   openMeteo  the Open-Meteo 15-minute grid value, when it is the live grid
// At most 6 points; BMKG is skipped beyond 12 km from any kecamatan point.

interface BmkgEntry {
  datetime: string;
  local_datetime?: string;
  weather: number;
  weather_desc: string;
  weather_desc_en: string;
  tp: number;
}

export interface SourceSays {
  lat: number;
  lng: number;
  t: number;
  bmkg: {
    area: string;
    km: number;
    desc: string;
    descEn: string;
    /** mm over the 3-hour step */
    tp: number;
    /** start of the forecast step (ms) */
    at: number;
  } | null;
  openMeteo: { mmh: number; issuedAt: number } | null;
}

const MAX_PTS = 6;
const MAX_KM = 12;

const km = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const x =
    (bLng - aLng) * Math.cos((((aLat + bLat) / 2) * Math.PI) / 180) * 111.32;
  const y = (bLat - aLat) * 110.57;
  return Math.hypot(x, y);
};

async function bmkgFor(adm4: string): Promise<BmkgEntry[]> {
  try {
    const res = await fetch(
      `https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${adm4}`,
      { signal: AbortSignal.timeout(8_000), next: { revalidate: 900 } },
    );
    if (!res.ok) return [];
    const j = await res.json();
    return (j?.data?.[0]?.cuaca?.flat() ?? []) as BmkgEntry[];
  } catch {
    return [];
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    pts?: { lat: number; lng: number; t: number }[];
  } | null;
  const pts = (body?.pts ?? [])
    .filter(
      (p) =>
        Number.isFinite(p?.lat) &&
        Number.isFinite(p?.lng) &&
        Number.isFinite(p?.t),
    )
    .slice(0, MAX_PTS);
  if (!pts.length)
    return Response.json({ error: "pts required" }, { status: 400 });

  const grid = await getRainGrid().catch(() => null);
  const om = grid?.source.startsWith("Open-Meteo") ? grid : null;

  const out: SourceSays[] = await Promise.all(
    pts.map(async (p) => {
      const near = JAKARTA_STATIONS.map((s) => ({
        s,
        d: km(p.lat, p.lng, s.lat, s.lon),
      })).sort((a, b) => a.d - b.d)[0];
      let bmkg: SourceSays["bmkg"] = null;
      if (near && near.d <= MAX_KM) {
        const entries = await bmkgFor(near.s.adm4);
        const e = entries.length
          ? entries.reduce((best, x) =>
              Math.abs(Date.parse(x.datetime) - p.t) <
              Math.abs(Date.parse(best.datetime) - p.t)
                ? x
                : best,
            )
          : null;
        if (e)
          bmkg = {
            area: near.s.name,
            km: +near.d.toFixed(1),
            desc: e.weather_desc,
            descEn: e.weather_desc_en,
            tp: e.tp,
            at: Date.parse(e.datetime),
          };
      }
      return {
        lat: p.lat,
        lng: p.lng,
        t: p.t,
        bmkg,
        openMeteo: om
          ? {
              mmh: +sampleGrid(om, p.lat, p.lng, p.t).toFixed(2),
              issuedAt: om.issuedAt,
            }
          : null,
      };
    }),
  );
  return Response.json(out, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
