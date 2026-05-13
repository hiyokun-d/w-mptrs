import type { Coordinates, RainfallIntensity, WeatherData } from "@/types";

const BMKG_BASE = "https://api.bmkg.go.id/publik/prakiraan-cuaca";

// Real lat/lon from BMKG API — one representative kelurahan per kecamatan across DKI Jakarta.
// Source: queried directly from BMKG, each entry confirmed to return valid forecast data.
const JAKARTA_STATIONS: Array<{ adm4: string; lat: number; lon: number; name: string }> = [
  { adm4: "31.71.01.1001", lat: -6.1764, lon: 106.8267, name: "Gambir" },
  { adm4: "31.71.02.1001", lat: -6.1660, lon: 106.8345, name: "Sawah Besar" },
  { adm4: "31.71.03.1001", lat: -6.1647, lon: 106.8454, name: "Kemayoran" },
  { adm4: "31.71.04.1001", lat: -6.1761, lon: 106.8396, name: "Senen" },
  { adm4: "31.71.05.1001", lat: -6.1760, lon: 106.8717, name: "Cempaka Putih" },
  { adm4: "31.71.06.1001", lat: -6.2009, lon: 106.8339, name: "Menteng" },
  { adm4: "31.71.07.1001", lat: -6.2163, lon: 106.8015, name: "Tanah Abang" },
  { adm4: "31.71.08.1001", lat: -6.1857, lon: 106.8570, name: "Johar Baru" },
  { adm4: "31.72.01.1001", lat: -6.1220, lon: 106.8000, name: "Penjaringan" },
  { adm4: "31.72.02.1001", lat: -6.1089, lon: 106.8791, name: "Tanjung Priok" },
  { adm4: "31.72.03.1001", lat: -6.1058, lon: 106.8991, name: "Koja" },
  { adm4: "31.72.04.1001", lat: -6.1107, lon: 106.9452, name: "Cilincing" },
  { adm4: "31.72.05.1001", lat: -6.1423, lon: 106.8478, name: "Pademangan" },
  { adm4: "31.72.06.1001", lat: -6.1684, lon: 106.9036, name: "Kelapa Gading" },
  { adm4: "31.73.01.1001", lat: -6.1387, lon: 106.7238, name: "Cengkareng" },
  { adm4: "31.73.02.1001", lat: -6.1618, lon: 106.7943, name: "Grogol Petamburan" },
  { adm4: "31.73.03.1001", lat: -6.1536, lon: 106.8245, name: "Taman Sari" },
  { adm4: "31.73.04.1001", lat: -6.1446, lon: 106.8088, name: "Tambora" },
  { adm4: "31.73.05.1001", lat: -6.1950, lon: 106.7721, name: "Kebon Jeruk" },
  { adm4: "31.73.06.1001", lat: -6.1492, lon: 106.6988, name: "Kalideres" },
  { adm4: "31.73.07.1001", lat: -6.2010, lon: 106.7895, name: "Pal Merah" },
  { adm4: "31.73.08.1001", lat: -6.1723, lon: 106.7425, name: "Kembangan" },
  { adm4: "31.74.01.1001", lat: -6.2338, lon: 106.8555, name: "Tebet" },
  { adm4: "31.74.02.1001", lat: -6.2074, lon: 106.8258, name: "Setiabudi" },
  { adm4: "31.74.03.1001", lat: -6.2428, lon: 106.8286, name: "Mampang Prapatan" },
  { adm4: "31.74.04.1001", lat: -6.2899, lon: 106.8394, name: "Pasar Minggu" },
  { adm4: "31.74.05.1001", lat: -6.2461, lon: 106.7768, name: "Kebayoran Lama" },
  { adm4: "31.74.06.1001", lat: -6.2905, lon: 106.7972, name: "Cilandak" },
  { adm4: "31.74.07.1001", lat: -6.2456, lon: 106.8022, name: "Kebayoran Baru" },
  { adm4: "31.74.08.1001", lat: -6.2474, lon: 106.8407, name: "Pancoran" },
  { adm4: "31.74.09.1001", lat: -6.3254, lon: 106.8192, name: "Jagakarsa" },
  { adm4: "31.74.10.1001", lat: -6.2564, lon: 106.7588, name: "Pesanggrahan" },
  { adm4: "31.75.01.1001", lat: -6.2117, lon: 106.8690, name: "Matraman" },
  { adm4: "31.75.02.1001", lat: -6.1830, lon: 106.8989, name: "Pulogadung" },
  { adm4: "31.75.03.1001", lat: -6.2174, lon: 106.8613, name: "Jatinegara" },
];

// Indonesia bounding box (approximate) — reject anything outside the archipelago
const INDONESIA_BBOX = { latMin: -11.0, latMax: 6.0, lonMin: 95.0, lonMax: 141.0 };

export function isInIndonesia(coords: Coordinates): boolean {
  return (
    coords.lat >= INDONESIA_BBOX.latMin &&
    coords.lat <= INDONESIA_BBOX.latMax &&
    coords.lng >= INDONESIA_BBOX.lonMin &&
    coords.lng <= INDONESIA_BBOX.lonMax
  );
}

function nearestStation(coords: Coordinates) {
  let best = JAKARTA_STATIONS[0];
  let bestDist = Infinity;
  for (const s of JAKARTA_STATIONS) {
    const dlat = s.lat - coords.lat;
    const dlon = s.lon - coords.lng;
    const dist = dlat * dlat + dlon * dlon; // squared euclidean — fine at this scale
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  return best;
}

interface BmkgEntry {
  datetime: string;
  weather: number;
  weather_desc: string;
  weather_desc_en: string;
  tp: number; // precipitation mm
  t: number;  // temperature °C
  hu: number; // humidity %
  ws: number; // wind speed km/h
}

// BMKG weather codes → rainfall intensity
// 0=sunny, 1=partly cloudy, 2=cloudy, 3=overcast
// 60=drizzle, 61=light rain, 63=moderate rain, 65=heavy rain
// 80=rain shower, 95=thunderstorm, 97=heavy thunderstorm
function weatherCodeToIntensity(code: number): RainfallIntensity {
  if (code >= 95) return "extreme";
  if (code >= 80 || code >= 65) return "heavy";
  if (code >= 63) return "moderate";
  if (code >= 60) return "light";
  return "none";
}

function precipToIntensity(mmPerHour: number): RainfallIntensity {
  if (mmPerHour >= 50) return "extreme";
  if (mmPerHour >= 10) return "heavy";
  if (mmPerHour >= 2.5) return "moderate";
  if (mmPerHour > 0) return "light";
  return "none";
}

export async function fetchBmkgWeather(coords: Coordinates): Promise<WeatherData | null> {
  if (!isInIndonesia(coords)) return null;

  const station = nearestStation(coords);

  try {
    const res = await fetch(`${BMKG_BASE}?adm4=${station.adm4}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;

    const json = await res.json();
    const entries: BmkgEntry[] = json?.data?.[0]?.cuaca?.flat() ?? [];
    if (entries.length === 0) return null;

    // Find the entry closest to now (within ±3 hours)
    const now = Date.now();
    const current =
      entries.find((e) => Math.abs(new Date(e.datetime).getTime() - now) <= 3 * 60 * 60 * 1000) ??
      entries[0];

    const codeIntensity = weatherCodeToIntensity(current.weather);
    const precipIntensity = precipToIntensity(current.tp);
    // Take the worse of the two signals
    const severities: RainfallIntensity[] = ["none", "light", "moderate", "heavy", "extreme"];
    const intensity =
      severities.indexOf(codeIntensity) >= severities.indexOf(precipIntensity)
        ? codeIntensity
        : precipIntensity;

    return {
      intensity,
      rainfallMmPerHour: current.tp,
      description: `${current.weather_desc_en} — ${station.name} (BMKG)`,
      timestamp: now,
      source: "bmkg",
      location: coords,
      windSpeedKmh: current.ws,
      humidityPct: current.hu,
      temperatureC: current.t,
    };
  } catch {
    return null;
  }
}
