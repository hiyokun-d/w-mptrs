"use client";

import { create } from "zustand";
import type { Itinerary, Point } from "@/lib/core/router";
import type { RainReport, Scenario } from "@/lib/core/scenarios";
import type { Lang } from "@/lib/i18n";
import { setPref } from "@/lib/local/db";
import type { PlanResponse } from "@/lib/local/planner";

export type Field = "from" | "to";
export type Choice = "fastest" | "weatherAware" | "transit";

/**
 * The itinerary behind a choice. "transit" is the public-transport option,
 * offered when both headline routes are motorcycle trips.
 */
export function chosen(r: PlanResponse | null, c: Choice): Itinerary | null {
  if (!r) return null;
  if (c === "transit") return r.options.transitB ?? r.options.transit0;
  return r[c];
}

/** Show a separate public-transport card only when no headline route uses it. */
export function transitCard(r: PlanResponse): Itinerary | null {
  const tr = r.options.transitB ?? r.options.transit0;
  if (
    !tr ||
    r.fastest?.type === "transit" ||
    (r.shift && r.weatherAware?.type === "transit")
  )
    return null;
  return tr;
}
export type Sheet = "home" | "search" | "results" | "trip" | "settings" | "how";

export interface Prefs {
  lang: Lang;
  beta: number;
  moto: "ojek" | "own" | "none";
  scenario: Scenario;
  rainLayer: boolean;
  radarLayer: boolean;
  /** Rp one minute of your time is worth; 0 = ignore price */
  vot: number;
  /** max ojek fare to recommend; 0 = no cap */
  maxOjek: number;
}

interface State extends Prefs {
  from: Point | null;
  to: Point | null;
  /** null = leave now */
  depart: number | null;
  editing: Field | null;
  sheet: Sheet;
  result: PlanResponse | null;
  loading: boolean;
  error: string | null;
  choice: Choice;
  /** minutes ahead of now shown on the rain layer */
  rainOffsetMin: number;
  trip: { startedAt: number; speed: number; choice: Choice } | null;
  pickOnMap: Field | null;
  /** bottom sheet minimised to its summary bar */
  collapsed: boolean;
  /** visible sheet height in px, so the map frames the route above it */
  sheetPx: number;
  /** where the tapped from/to field was, so search can open out of it */
  searchOrigin: { x: number; y: number } | null;
  /** "is it raining here?" answers this session: they feed the forecast */
  reports: RainReport[];

  set: (p: Partial<State>) => void;
  setPrefs: (p: Partial<Prefs>) => void;
  setPoint: (f: Field, p: Point | null) => void;
  swap: () => void;
  /** clear the destination and the plan: back to the main menu */
  resetTrip: () => void;
}

export const useApp = create<State>()((set, get) => ({
  lang: "id",
  beta: 1,
  moto: "ojek",
  scenario: "live",
  rainLayer: true,
  radarLayer: false,
  vot: 500,
  maxOjek: 0,
  from: null,
  to: null,
  depart: null,
  editing: null,
  sheet: "home",
  result: null,
  loading: false,
  error: null,
  choice: "weatherAware",
  rainOffsetMin: 0,
  trip: null,
  pickOnMap: null,
  collapsed: false,
  sheetPx: 320,
  searchOrigin: null,
  reports: [],

  set: (p) => set(p),
  setPrefs: (p) => {
    set(p);
    for (const [k, v] of Object.entries(p)) void setPref(k, v);
  },
  setPoint: (f, p) => set({ [f]: p, result: null } as Partial<State>),
  resetTrip: () =>
    set({
      to: null,
      result: null,
      sheet: "home",
      choice: "fastest",
      collapsed: false,
      error: null,
    }),
  swap: () => {
    const { from, to } = get();
    set({ from: to, to: from, result: null });
  },
}));
