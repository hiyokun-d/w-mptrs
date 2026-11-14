"use client";

import Dexie, { type EntityTable } from "dexie";

// Everything the user owns lives on the device (local-first). Signing in
// only syncs places and prefs; the network and rain caches make offline
// routing possible; logQueue holds research rows until we are online.

export interface Place {
  id?: number;
  name: string;
  detail?: string;
  lat: number;
  lng: number;
  kind: "home" | "work" | "saved" | "recent";
  updatedAt: number;
}

export interface TripRecord {
  id?: number;
  startedAt: number;
  endedAt?: number;
  from: string;
  to: string;
  type: string;
  minutes: number;
  dose: number;
  shift: boolean;
}

export interface Pref {
  key: string;
  value: unknown;
}

export interface Blob {
  key: "network" | "rain";
  version: string;
  data: string;
  savedAt: number;
}

export interface LogRow {
  id?: number;
  createdAt: number;
  payload: Record<string, unknown>;
}

class LocalDB extends Dexie {
  places!: EntityTable<Place, "id">;
  trips!: EntityTable<TripRecord, "id">;
  prefs!: EntityTable<Pref, "key">;
  blobs!: EntityTable<Blob, "key">;
  logQueue!: EntityTable<LogRow, "id">;

  constructor() {
    super("rute-cuaca");
    this.version(1).stores({
      places: "++id, kind, updatedAt",
      trips: "++id, startedAt",
      prefs: "key",
      blobs: "key",
      logQueue: "++id, createdAt",
    });
  }
}

export const db = new LocalDB();

export async function getPref<T>(key: string, fallback: T): Promise<T> {
  try {
    const p = await db.prefs.get(key);
    return p ? (p.value as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function setPref(key: string, value: unknown): Promise<void> {
  try {
    await db.prefs.put({ key, value });
  } catch {
    // private mode or storage blocked: prefs just don't persist
  }
}

/** a stable anonymous id for research logging (no personal data) */
export async function deviceId(): Promise<string> {
  let id = await getPref<string | null>("deviceId", null);
  if (!id) {
    id = crypto.randomUUID();
    await setPref("deviceId", id);
  }
  return id;
}

export async function rememberRecent(
  p: Omit<Place, "kind" | "updatedAt">,
): Promise<void> {
  try {
    const same = await db.places
      .where("kind")
      .equals("recent")
      .filter(
        (x) => Math.abs(x.lat - p.lat) < 1e-4 && Math.abs(x.lng - p.lng) < 1e-4,
      )
      .first();
    if (same?.id) await db.places.update(same.id, { updatedAt: Date.now() });
    else await db.places.add({ ...p, kind: "recent", updatedAt: Date.now() });
    const recents = await db.places
      .where("kind")
      .equals("recent")
      .sortBy("updatedAt");
    const extra = recents.length - 12;
    if (extra > 0)
      await db.places.bulkDelete(
        recents.slice(0, extra).map((r) => r.id as number),
      );
  } catch {
    // ignore storage errors
  }
}
