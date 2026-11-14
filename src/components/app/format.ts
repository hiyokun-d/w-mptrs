import { rainCategory } from "@/lib/core/dp";
import type { Itinerary, Leg } from "@/lib/core/router";
import { type Lang, t } from "@/lib/i18n";

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

/** Whole minutes, at least 1. */
export function mins(m: number): string {
  return `${Math.max(1, Math.round(m))}`;
}

/** "23 min", "1 h 9 min" / "1 j 9 mnt". */
export function dur(m: number, lang: Lang): string {
  const total = Math.max(1, Math.round(m));
  const h = Math.floor(total / 60);
  const unit = t(lang, "min");
  return h
    ? `${h} ${t(lang, "hr")} ${total - h * 60} ${unit}`
    : `${total} ${unit}`;
}

export function rupiah(x: number): string {
  return x === 0 ? "Rp0" : `Rp${x.toLocaleString("id-ID")}`;
}

export function mm(d: number): string {
  return d < 0.05 ? "0 mm" : `${d < 1 ? d.toFixed(2) : d.toFixed(1)} mm`;
}

const CAT: Record<Lang, Record<string, string>> = {
  id: {
    none: "kering",
    light: "ringan",
    moderate: "sedang",
    heavy: "lebat",
    very_heavy: "sangat lebat",
  },
  en: {
    none: "dry",
    light: "light",
    moderate: "moderate",
    heavy: "heavy",
    very_heavy: "very heavy",
  },
};

export function rainWord(r: number, lang: Lang): string {
  return CAT[lang][rainCategory(r)];
}

export function legTitle(g: Leg, lang: Lang): string {
  switch (g.kind) {
    case "walk":
      return g.to.name ? `${t(lang, "walk")} → ${g.to.name}` : t(lang, "walk");
    case "wait":
      return g.service === "ojek pickup"
        ? lang === "id"
          ? "Tunggu ojek (di dalam)"
          : "Wait for the ojek (indoors)"
        : `${t(lang, "wait")} · ${g.from.name ?? ""}`;
    case "moto":
      return t(lang, "moto");
    case "ride":
      return `${g.route?.short ?? ""} → ${g.route?.headsign ?? ""}`;
  }
}

export function summaryModes(
  it: Itinerary,
): { label: string; color: string }[] {
  if (it.type === "moto") return [{ label: "Ojek", color: "#f97316" }];
  // rides in order, including a first-mile ojek to the halte
  const rides = it.legs.filter(
    (g) => (g.kind === "ride" && g.route) || g.kind === "moto",
  );
  if (!rides.length) return [{ label: "🚶", color: "#475569" }];
  return rides.map((g) =>
    g.kind === "moto"
      ? { label: "Ojek", color: "#f97316" }
      : { label: g.route?.short ?? "", color: g.route?.color ?? "#0ea5e9" },
  );
}

export function serviceText(g: Leg, lang: Lang): string | null {
  if (!g.service || g.service === "ojek pickup") return null;
  if (g.service.startsWith("every"))
    return `${t(lang, "every")} ${g.service.replace("every ", "").replace(" min", "")} ${t(lang, "min")} · ${t(lang, "estimated")}`;
  return `${t(lang, "dep")} ${g.service.replace("dep ", "")}`;
}

/** Stable React key for a leg within one itinerary. */
export const legKey = (g: Leg) =>
  `${g.kind}-${g.t0}-${g.from.lat.toFixed(5)},${g.from.lng.toFixed(5)}`;
