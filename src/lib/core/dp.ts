// Discomfort Penalty (DP) model, identical to the paper and wmptrs-sim:
//
//   c = τ · w_m · (1 + β · E · φ(r))
//   φ(r) = (σ(r) − σ(0)) / (1 − σ(0)),  σ(r) = 1 / (1 + e^(−k(r − r0)))
//
// τ minutes, w_m value-of-time weight, E rain exposure (0…1), r rain mm/h.

export const DP_DEFAULTS = { beta: 1, r0: 5, k: 0.74 } as const;

export interface DPParams {
  beta: number;
  r0: number;
  k: number;
}

function sigmoid(r: number, r0: number, k: number): number {
  return 1 / (1 + Math.exp(-k * (r - r0)));
}

/** Normalised rain-discomfort response in [0, 1): φ(0) = 0, φ(r0) ≈ 0.5. */
export function phi(
  r: number,
  r0: number = DP_DEFAULTS.r0,
  k: number = DP_DEFAULTS.k,
): number {
  if (r <= 0) return 0;
  const s0 = sigmoid(0, r0, k);
  return (sigmoid(r, r0, k) - s0) / (1 - s0);
}

/** What the traveller is doing on a leg of the trip. */
export type LegKind = "walk" | "wait" | "ride" | "moto";

/** Where a wait happens decides how much rain reaches you. */
export type WaitPlace = "halte" | "roadside" | "station" | "none";

/** Value-of-time weights: out-of-vehicle time feels 1.5× longer. */
export const W = { walk: 1.5, wait: 1.5, ride: 1, moto: 1 } as const;

/**
 * True exposure, used to score rain dose and to raise alerts.
 * BRT haltes are roofed but open-sided (0.4); a roadside stop is often a
 * pole or a small shelter (1.0); rail stations are enclosed (0.1).
 */
export function exposure(kind: LegKind, place: WaitPlace = "none"): number {
  switch (kind) {
    case "walk":
    case "moto":
      return 1;
    case "ride":
      return 0;
    case "wait":
      return place === "halte"
        ? 0.4
        : place === "roadside"
          ? 1
          : place === "station"
            ? 0.1
            : 0;
  }
}

/**
 * Exposure the router prices. Waits are not priced (paper ablation A4:
 * pricing short waits deters the sheltered transit trips that save the
 * most rain); they are still scored with `exposure`.
 */
export function routingExposure(kind: LegKind): number {
  return kind === "walk" || kind === "moto" ? 1 : 0;
}

/** DP cost of a leg in perceived minutes. */
export function legCost(
  minutes: number,
  kind: LegKind,
  rainMmh: number,
  p: DPParams,
): number {
  return (
    minutes *
    W[kind] *
    (1 + p.beta * routingExposure(kind) * phi(rainMmh, p.r0, p.k))
  );
}

/** Rain received on a leg in mm: τ · E · r / 60. */
export function legDose(
  minutes: number,
  kind: LegKind,
  place: WaitPlace,
  rainMmh: number,
): number {
  return (minutes * exposure(kind, place) * rainMmh) / 60;
}

/** BMKG hourly categories (mm/h): light 1–5, moderate 5–10, heavy 10–20, very heavy > 20. */
export type RainCategory =
  | "none"
  | "light"
  | "moderate"
  | "heavy"
  | "very_heavy";

export function rainCategory(r: number): RainCategory {
  if (r < 1) return "none";
  if (r < 5) return "light";
  if (r < 10) return "moderate";
  if (r < 20) return "heavy";
  return "very_heavy";
}
