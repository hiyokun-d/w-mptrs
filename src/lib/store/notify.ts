"use client";

import { create } from "zustand";

// In-app notifications: what to do next and what we predict. Each has a key
// so the same event is announced once, however often the clock ticks.

export type NoteKind =
  | "action"
  | "rain"
  | "vehicle"
  | "predict"
  | "arrive"
  | "info";

export interface Note {
  key: string;
  kind: NoteKind;
  title: string;
  body?: string;
  /** app time it refers to (trip clock or real time) */
  at: number;
  /** wall-clock time it was posted */
  posted: number;
  read: boolean;
  /**
   * minor (default): a small pill at the bottom · major: needs action now
   * (board, get off), a card under the top bar · emergency: dangerous rain
   * where you are going, a red banner at the very top
   */
  level?: "minor" | "major" | "emergency";
}

interface NoteState {
  notes: Note[];
  /** keys currently shown as toasts */
  toasts: string[];
  /** `toast: false` files it in the inbox without a pop-up */
  push: (n: Omit<Note, "posted" | "read">, opt?: { toast?: boolean }) => void;
  dismiss: (key: string) => void;
  markRead: () => void;
  clear: () => void;
}

const MAX = 40;

export const useNotes = create<NoteState>()((set, get) => ({
  notes: [],
  toasts: [],
  push: (n, opt) => {
    if (get().notes.some((x) => x.key === n.key)) return;
    const note: Note = { ...n, posted: Date.now(), read: false };
    const toast = opt?.toast !== false;
    const lvl = n.level ?? "minor";
    const minor = (k: string) =>
      (get().notes.find((x) => x.key === k)?.level ?? "minor") === "minor";
    set((s) => ({
      notes: [note, ...s.notes].slice(0, MAX),
      // one pill at a time: a new minor note replaces the last one
      toasts: toast
        ? [
            n.key,
            ...s.toasts.filter((k) => lvl !== "minor" || !minor(k)),
          ].slice(0, 4)
        : s.toasts,
    }));
    if (!toast) return;
    setTimeout(
      () => get().dismiss(n.key),
      lvl === "emergency" ? 15000 : lvl === "major" ? 7000 : 3200,
    );
  },
  dismiss: (key) => set((s) => ({ toasts: s.toasts.filter((k) => k !== key) })),
  markRead: () =>
    set((s) => ({ notes: s.notes.map((x) => ({ ...x, read: true })) })),
  clear: () => set({ notes: [], toasts: [] }),
}));
