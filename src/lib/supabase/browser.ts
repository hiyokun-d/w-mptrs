"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { db, type Place } from "@/lib/local/db";

// Accounts are optional: without the env vars the app simply has no sign-in.
let client: SupabaseClient | null | undefined;

export function supabaseBrowser(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? createClient(url, key) : null;
  return client;
}

/**
 * Two-way sync of saved places (home, work, starred) with the signed-in
 * account. Newest `updatedAt` wins. Tables and row-level security are in
 * supabase/sync.sql.
 */
export async function syncPlaces(): Promise<void> {
  const sb = supabaseBrowser();
  if (!sb) return;
  const { data: auth } = await sb.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return;
  const local = (await db.places.toArray()).filter((p) => p.kind !== "recent");
  const { data: remote, error } = await sb
    .from("saved_places")
    .select("name, detail, lat, lng, kind, updated_at");
  if (error) throw error;
  const key = (p: { kind: string; name: string }) => `${p.kind}|${p.name}`;
  const remoteBy = new Map((remote ?? []).map((r) => [key(r), r]));
  const localBy = new Map(local.map((p) => [key(p), p]));
  for (const [k, r] of remoteBy) {
    const l = localBy.get(k);
    const ts = Date.parse(r.updated_at);
    if (!l)
      await db.places.add({
        name: r.name,
        detail: r.detail ?? undefined,
        lat: r.lat,
        lng: r.lng,
        kind: r.kind as Place["kind"],
        updatedAt: ts,
      });
    else if (ts > l.updatedAt && l.id)
      await db.places.update(l.id, {
        lat: r.lat,
        lng: r.lng,
        detail: r.detail ?? undefined,
        updatedAt: ts,
      });
  }
  const up = local
    .filter((l) => {
      const r = remoteBy.get(key(l));
      return !r || Date.parse(r.updated_at) < l.updatedAt;
    })
    .map((l) => ({
      user_id: uid,
      name: l.name,
      detail: l.detail ?? null,
      lat: l.lat,
      lng: l.lng,
      kind: l.kind,
      updated_at: new Date(l.updatedAt).toISOString(),
    }));
  if (up.length) {
    const { error: e2 } = await sb
      .from("saved_places")
      .upsert(up, { onConflict: "user_id,kind,name" });
    if (e2) throw e2;
  }
}
