// The trip video as a list of shots: where the camera goes, what the boxes
// say and how hard it rains. Pure data; StoryStudio renders and records it.

import type { SourceSays } from "@/app/api/rain/sources/route";
import { BRAND } from "@/lib/brand";
import type { Itinerary, Leg } from "@/lib/core/router";
import type { Lang } from "@/lib/i18n";
import type { PlanResponse } from "@/lib/local/planner";
import { clock, mm, rainWord } from "../format";

export type LngLat = [number, number];

export interface Box {
  at: LngLat;
  label: string;
  text: string;
  sub?: string;
  tone: "light" | "dark" | "gold";
  /** which side of the anchor the box goes: -1 left, 1 right */
  side: -1 | 1;
  /** vertical offset of the box from the anchor (px, − = above) */
  dy: number;
}

export interface Cam {
  /** frame these points, or look at `center` from `zoom` */
  fit?: LngLat[];
  center?: LngLat;
  zoom?: number;
  pitch: number;
  bearing: number;
}

export interface Shot {
  id: string;
  dur: number;
  cam: Cam;
  /** seconds the camera takes to get there; then it drifts */
  move: number;
  /** degrees per second of turn once there */
  orbit: number;
  /** zoom change per second once there (+ in, − out) */
  push: number;
  title: string;
  caption: string;
  boxes: Box[];
  /** mm/h for the falling rain */
  rain: number;
  /** leg of the trip to highlight */
  focus?: number;
  /** draw the routes in over this shot */
  drawIn?: boolean;
  /** time the rain layer shows (ms) */
  rainAt: number;
  card?: "intro" | "compare" | "outro";
}

export interface StoryInput {
  r: PlanResponse;
  it: Itinerary;
  /** the other headline option (null when both are the same trip) */
  alt: Itinerary | null;
  lang: Lang;
  says: SourceSays[];
}

const ll = (p: [number, number]): LngLat => [p[1], p[0]];
const mid = (g: Leg): LngLat => {
  const p = g.path.length ? g.path[Math.floor(g.path.length / 2)] : null;
  return p ? ll(p) : [(g.from.lng + g.to.lng) / 2, (g.from.lat + g.to.lat) / 2];
};
const pts = (it: Itinerary | null): LngLat[] =>
  (it?.legs ?? []).flatMap((g) =>
    g.path.length ? g.path.map(ll) : [[g.from.lng, g.from.lat] as LngLat],
  );
const midOf = (it: Itinerary): LngLat => {
  const p = pts(it);
  return p[Math.floor(p.length / 2)] ?? [106.83, -6.2];
};

/** compass direction of travel along a leg, degrees */
export function legBearing(g: Leg): number {
  const a = g.path[0] ?? [g.from.lat, g.from.lng];
  const b = g.path.at(-1) ?? [g.to.lat, g.to.lng];
  const x = (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180);
  const y = b[0] - a[0];
  if (Math.hypot(x, y) < 1e-6) return 0;
  return (Math.atan2(x, y) * 180) / Math.PI;
}

/** the minutes and the rain in words, for the boxes */
const outdoors = (g: Leg) => g.kind === "walk" || g.kind === "moto";

export function buildShots(s: StoryInput): Shot[] {
  const { r, it, alt, lang } = s;
  const L = (en: string, id: string) => (lang === "en" ? en : id);
  const from = it.legs[0]?.from.name ?? L("Start", "Awal");
  const to = it.legs.at(-1)?.to.name ?? L("Destination", "Tujuan");
  const all = [...pts(it), ...pts(alt)];
  const ex = r.explain;
  /** the recommendation is really drier (not only cheaper or calmer) */
  const drier = !!ex && ex.doseSavedPct >= 1;
  const shots: Shot[] = [];

  // 1 — the question
  shots.push({
    id: "intro",
    dur: 3.4,
    cam: { fit: all, pitch: 20, bearing: -28 },
    move: 0.01,
    orbit: 6,
    push: -0.12,
    title: L("Your trip", "Perjalananmu"),
    caption: L(
      `${from} → ${to}, leaving ${clock(it.depart)}. Fastest, or driest?`,
      `${from} → ${to}, berangkat ${clock(it.depart)}. Tercepat, atau terkering?`,
    ),
    boxes: [],
    rain: Math.max(0, ...it.legs.map((g) => g.rain)) * 0.6,
    rainAt: it.depart,
    card: "intro",
  });

  // 2 — two ways to go
  const two: Box[] = [];
  if (alt) {
    two.push({
      at: midOf(alt),
      label: L("Fastest", "Tercepat"),
      text: `${Math.round(alt.minutes)} min · ${mm(alt.dose)} ${L("rain", "hujan")}`,
      sub: summary(alt, lang),
      tone: "dark",
      side: -1,
      dy: -120,
    });
  }
  two.push({
    at: midOf(it),
    label: alt
      ? drier
        ? L("Driest · recommended", "Terkering · disarankan")
        : L("Recommended", "Disarankan")
      : L("Fastest and driest", "Tercepat sekaligus terkering"),
    text: `${Math.round(it.minutes)} min · ${mm(it.dose)} ${L("rain", "hujan")}`,
    sub: summary(it, lang),
    tone: "light",
    side: 1,
    dy: 70,
  });
  shots.push({
    id: "routes",
    dur: 4.2,
    cam: { fit: all, pitch: 45, bearing: 0 },
    move: 1.3,
    orbit: 4,
    push: 0.04,
    title: L("Two ways to go", "Dua cara pergi"),
    caption: alt
      ? L(
          "The fastest route vs the route that keeps you driest.",
          "Rute tercepat vs rute yang membuatmu paling kering.",
        )
      : L(
          "Today the fastest route is also the driest.",
          "Hari ini rute tercepat juga yang paling kering.",
        ),
    boxes: two,
    rain: 0,
    drawIn: true,
    rainAt: it.depart,
  });

  // 3 — what the forecasts say, where and when you will be there
  const wet = [...it.legs, ...(alt?.legs ?? [])]
    .filter(outdoors)
    .sort((a, b) => b.rain - a.rain)[0];
  const spot: LngLat = wet ? mid(wet) : midOf(it);
  const spotT = wet ? (wet.t0 + wet.t1) / 2 : it.depart;
  const src: Box[] = [];
  const say = s.says[0];
  if (r.scenario !== "live")
    src.push({
      at: spot,
      label: L("Demo storm", "Badai contoh"),
      text: L(
        "This video uses a simulated storm, not today's forecast.",
        "Video ini memakai badai simulasi, bukan prakiraan hari ini.",
      ),
      tone: "gold",
      side: 1,
      dy: 150,
    });
  if (say?.bmkg) {
    const b = say.bmkg;
    src.push({
      at: spot,
      label: `BMKG · ${b.area}`,
      text: L(
        `BMKG says "${b.descEn}" around ${b.area} at ${clock(b.at)}.`,
        `BMKG: "${b.desc}" di sekitar ${b.area}, pukul ${clock(b.at)}.`,
      ),
      sub: L(
        `${b.tp} mm per 3 h · kecamatan forecast`,
        `${b.tp} mm per 3 jam · prakiraan kecamatan`,
      ),
      tone: "light",
      side: -1,
      dy: -170,
    });
  }
  if (say?.openMeteo) {
    const o = say.openMeteo;
    src.push({
      at: spot,
      label: "Open-Meteo",
      text: L(
        `${o.mmh.toFixed(1)} mm/h right here at ${clock(say.t)} (${rainWord(o.mmh, lang)}).`,
        `${o.mmh.toFixed(1)} mm/jam tepat di sini pukul ${clock(say.t)} (${rainWord(o.mmh, lang)}).`,
      ),
      sub: L("15-minute forecast grid", "grid prakiraan 15 menit"),
      tone: "dark",
      side: 1,
      dy: -40,
    });
  }
  if (!say?.bmkg && !say?.openMeteo)
    src.push({
      at: spot,
      label: L("Forecast", "Prakiraan"),
      text: L(
        `${(wet?.rain ?? 0).toFixed(1)} mm/h here at ${clock(spotT)}.`,
        `${(wet?.rain ?? 0).toFixed(1)} mm/jam di sini pukul ${clock(spotT)}.`,
      ),
      sub: r.rain.source,
      tone: "light",
      side: -1,
      dy: -150,
    });
  shots.push({
    id: "sources",
    dur: 5.2,
    cam: { center: spot, zoom: 13.4, pitch: 55, bearing: 25 },
    move: 1.6,
    orbit: 7,
    push: 0.08,
    title: L("The rain you'll meet", "Hujan yang akan kamu temui"),
    caption: L(
      "We read the rain forecast for each place at the minute you get there.",
      "Kami baca prakiraan hujan tiap tempat, tepat di menit kamu tiba.",
    ),
    boxes: src,
    rain: wet?.rain ?? 0,
    rainAt: spotT,
  });

  // 4 — the trip, leg by leg
  const legs = it.legs
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g.kind !== "wait" || g.minutes >= 1)
    .slice(0, 6);
  for (const { g, i } of legs) {
    const at =
      g.kind === "wait" ? ([g.from.lng, g.from.lat] as LngLat) : mid(g);
    const rainTxt =
      g.rain >= 0.3
        ? L(
            `${rainWord(g.rain, lang)} rain, ${g.rain.toFixed(1)} mm/h`,
            `hujan ${rainWord(g.rain, lang)}, ${g.rain.toFixed(1)} mm/jam`,
          )
        : L("dry", "kering");
    let box: Box;
    let caption: string;
    if (g.kind === "walk") {
      box = {
        at,
        label: L("Walk", "Jalan kaki"),
        text: L("This is where you walk.", "Di sini kamu jalan kaki."),
        sub: `${Math.max(1, Math.round(g.minutes))} min · ${rainTxt}`,
        tone: "light",
        side: 1,
        dy: -130,
      };
      caption = L(
        `Walk to ${g.to.name ?? "the stop"}: ${Math.round(g.minutes)} min in the open.`,
        `Jalan ke ${g.to.name ?? "halte"}: ${Math.round(g.minutes)} menit di luar.`,
      );
    } else if (g.kind === "wait") {
      const cover =
        g.place === "station"
          ? L("inside the station", "di dalam stasiun")
          : g.place === "halte"
            ? L("under the halte roof", "di bawah atap halte")
            : L("at a roadside stop", "di halte pinggir jalan");
      box = {
        at,
        label: L(
          `Wait · ${g.from.name ?? ""}`,
          `Tunggu · ${g.from.name ?? ""}`,
        ),
        text: `${Math.max(1, Math.round(g.minutes))} min ${cover}`,
        sub: g.service ?? undefined,
        tone: "dark",
        side: -1,
        dy: -120,
      };
      caption = L(
        `Wait for the next ${it.legs[i + 1]?.route?.short ?? "ride"} ${cover}.`,
        `Tunggu ${it.legs[i + 1]?.route?.short ?? "kendaraan"} berikutnya ${cover}.`,
      );
    } else if (g.kind === "ride") {
      box = {
        at,
        label: `${g.route?.short ?? ""} → ${g.route?.headsign ?? g.to.name ?? ""}`,
        text: L(
          `Ride ${g.stops ?? "?"} stops, ${Math.round(g.minutes)} min.`,
          `Naik ${g.stops ?? "?"} halte, ${Math.round(g.minutes)} menit.`,
        ),
        sub: L(
          `Get off at ${g.to.name ?? "?"} · dry inside`,
          `Turun di ${g.to.name ?? "?"} · kering di dalam`,
        ),
        tone: "light",
        side: 1,
        dy: -140,
      };
      caption = L(
        `Inside the ${g.route?.long ?? g.route?.short ?? "vehicle"} the rain doesn't count.`,
        `Di dalam ${g.route?.long ?? g.route?.short ?? "kendaraan"} hujan tidak dihitung.`,
      );
    } else {
      box = {
        at,
        label: L("Ojek", "Ojek"),
        text: L(
          `${Math.round(g.minutes)} min door to door, fully exposed.`,
          `${Math.round(g.minutes)} menit pintu ke pintu, kena hujan penuh.`,
        ),
        sub: `${mm(g.dose)} ${L("rain received", "hujan diterima")} · ${rainTxt}`,
        tone: "gold",
        side: 1,
        dy: -140,
      };
      caption = L(
        "On a motorbike every minute of rain counts.",
        "Di motor, setiap menit hujan dihitung.",
      );
    }
    const ride = g.kind === "ride" || g.kind === "moto";
    shots.push({
      id: `leg-${i}`,
      dur: 3.3,
      cam: ride
        ? {
            fit: g.path.map(ll),
            pitch: 50,
            bearing: legBearing(g),
          }
        : { center: at, zoom: 16.2, pitch: 62, bearing: legBearing(g) },
      move: 1.3,
      orbit: ride ? 3 : 5,
      push: ride ? 0.05 : 0.1,
      title: L(
        `Step ${legs.findIndex((x) => x.i === i) + 1}`,
        `Langkah ${legs.findIndex((x) => x.i === i) + 1}`,
      ),
      caption,
      boxes: [box],
      rain: g.rain,
      focus: i,
      rainAt: (g.t0 + g.t1) / 2,
    });
  }

  // 5 — the decision
  shots.push({
    id: "compare",
    dur: 4.4,
    cam: { fit: all, pitch: 58, bearing: 40 },
    move: 1.4,
    orbit: 9,
    push: 0.03,
    title: L("The choice", "Pilihannya"),
    caption: !(ex && alt && r.shift)
      ? L(
          "No trade-off today: the fastest route is the driest.",
          "Tidak ada tukar-menukar hari ini: rute tercepat paling kering.",
        )
      : drier
        ? L(
            `+${Math.round(ex.extraMin)} min for ${Math.round(ex.doseSavedPct)}% less rain.`,
            `+${Math.round(ex.extraMin)} menit untuk ${Math.round(ex.doseSavedPct)}% lebih sedikit hujan.`,
          )
        : ex.fareSaved > 0
          ? L(
              `Both stay dry: +${Math.round(ex.extraMin)} min, Rp${ex.fareSaved.toLocaleString("id-ID")} cheaper.`,
              `Sama-sama kering: +${Math.round(ex.extraMin)} menit, Rp${ex.fareSaved.toLocaleString("id-ID")} lebih hemat.`,
            )
          : L(
              "Both stay dry; this one is calmer on your settings.",
              "Sama-sama kering; yang ini lebih cocok dengan pengaturanmu.",
            ),
    boxes: [],
    rain: 0,
    rainAt: it.depart,
    card: "compare",
  });

  // 6 — sign-off
  shots.push({
    id: "outro",
    dur: 3.2,
    cam: { fit: all, pitch: 0, bearing: 0 },
    move: 1.6,
    orbit: 0,
    push: -0.25,
    title: BRAND.app,
    caption: L(
      "Stay dry. Take the smarter line.",
      "Tetap kering. Pilih jalur yang lebih cerdas.",
    ),
    boxes: [],
    rain: 0,
    rainAt: it.depart,
    card: "outro",
  });
  return shots;
}

function summary(it: Itinerary, lang: Lang): string {
  const L = (en: string, id: string) => (lang === "en" ? en : id);
  const modes = it.legs
    .filter((g) => g.kind === "ride" || g.kind === "moto")
    .map((g) => (g.kind === "moto" ? "Ojek" : (g.route?.short ?? "")))
    .filter(Boolean);
  const walk = Math.round(it.walkMin);
  return [
    modes.join(" → ") || L("Walk", "Jalan kaki"),
    walk ? L(`${walk} min walking`, `${walk} mnt jalan`) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
