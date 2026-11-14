"use client";

import type { Map as GLMap } from "maplibre-gl";
import { create } from "zustand";
import type { Fleet } from "@/lib/core/fleet";

/**
 * The live MapLibre map and the fleet, shared with the presentation so it
 * can move the camera and add its own layers on the same map.
 */
export const useGL = create<{
  map: GLMap | null;
  fleet: Fleet | null;
  /** vehicles: "auto" focuses the shown route's lines, "all" shows every
   *  line, "trunk" only rail and the BRT corridors */
  fleetMode: "auto" | "all" | "trunk" | "off";
  /** id of the vehicle the camera follows */
  follow: string | null;
  /** the presentation owns the camera and the route drawing */
  stage: boolean;
  /** the trip-video studio is open */
  story: boolean;
  set: (
    p: Partial<{
      map: GLMap | null;
      fleet: Fleet | null;
      fleetMode: "auto" | "all" | "trunk" | "off";
      follow: string | null;
      stage: boolean;
      story: boolean;
    }>,
  ) => void;
}>((set) => ({
  map: null,
  fleet: null,
  fleetMode: "auto",
  follow: null,
  stage: false,
  story: false,
  set: (p) => set(p),
}));

export function webglOK(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}
