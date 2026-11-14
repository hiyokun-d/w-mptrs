import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Real-world evidence from logged trips: how much less rain the weather-aware
// choice received than the fastest one, on the rain that actually fell.
// GET → summary with a bootstrap 95 % CI; GET ?format=csv → all realised rows.

function bootstrapMean(xs: number[], n = 2000): [number, number] {
  if (xs.length < 2) return [Number.NaN, Number.NaN];
  // deterministic LCG so the CI is reproducible for the paper
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const means: number[] = [];
  for (let b = 0; b < n; b++) {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rnd() * xs.length)];
    means.push(s / xs.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(0.025 * n)], means[Math.floor(0.975 * n)]];
}

export async function GET(req: NextRequest) {
  const rows = await db.planLog
    .findMany({
      where: { realisedAt: { not: null }, scenario: "live" },
      orderBy: { depart: "asc" },
      select: {
        id: true,
        depart: true,
        beta: true,
        shift: true,
        rainSource: true,
        fastest: true,
        weatherAware: true,
        realisedFastestDose: true,
        realisedWeatherDose: true,
      },
    })
    .catch(() => null);
  if (!rows)
    return NextResponse.json(
      { error: "database unavailable" },
      { status: 503 },
    );

  const dose = (j: unknown) =>
    j && typeof j === "object" && "dose" in j ? Number(j.dose) : null;
  const mins = (j: unknown) =>
    j && typeof j === "object" && "minutes" in j ? Number(j.minutes) : null;

  if (req.nextUrl.searchParams.get("format") === "csv") {
    const head =
      "id,depart,beta,shift,rain_source,fastest_min,weather_min,forecast_fastest_mm,forecast_weather_mm,realised_fastest_mm,realised_weather_mm";
    const lines = rows.map((r) =>
      [
        r.id,
        r.depart.toISOString(),
        r.beta,
        r.shift,
        JSON.stringify(r.rainSource),
        mins(r.fastest),
        mins(r.weatherAware),
        dose(r.fastest),
        dose(r.weatherAware),
        r.realisedFastestDose,
        r.realisedWeatherDose,
      ].join(","),
    );
    return new NextResponse([head, ...lines].join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="wmptrs-realised.csv"',
      },
    });
  }

  const shifted = rows.filter(
    (r) =>
      r.shift && r.realisedFastestDose != null && r.realisedWeatherDose != null,
  );
  const saved = shifted.map(
    (r) => (r.realisedFastestDose ?? 0) - (r.realisedWeatherDose ?? 0),
  );
  const extra = shifted.map(
    (r) => (mins(r.weatherAware) ?? 0) - (mins(r.fastest) ?? 0),
  );
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN;
  const totF = shifted.reduce((s, r) => s + (r.realisedFastestDose ?? 0), 0);
  const totW = shifted.reduce((s, r) => s + (r.realisedWeatherDose ?? 0), 0);
  const ci = bootstrapMean(saved);

  return NextResponse.json({
    trips: rows.length,
    shifted: shifted.length,
    meanSavedMm: mean(saved),
    ci95: ci,
    reductionPct: totF > 0 ? (100 * (totF - totW)) / totF : null,
    meanExtraMin: mean(extra),
    // the forecast was right about the sign when the realised saving is ≥ 0
    agreedPct: shifted.length
      ? (100 * saved.filter((x) => x >= 0).length) / shifted.length
      : null,
  });
}
