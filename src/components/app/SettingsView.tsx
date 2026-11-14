"use client";

import type { User } from "@supabase/supabase-js";
import { Bell, Briefcase, House, LogOut, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { SCENARIOS } from "@/lib/core/scenarios";
import { t } from "@/lib/i18n";
import { db } from "@/lib/local/db";
import { useApp } from "@/lib/store/app";
import { supabaseBrowser, syncPlaces } from "@/lib/supabase/browser";
import { SCENARIO_META } from "./scenario-meta";

function Row({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-full border px-3 py-1.5 text-sm ${value === v ? "border-sky-600 bg-sky-600 text-white" : "border-slate-200 dark:border-slate-700"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function SettingsView() {
  const { lang, moto, scenario, setPrefs, from, to, vot, maxOjek } = useApp();
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(
    "default",
  );
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [sources, setSources] = useState<{ name: string; note: string }[]>([]);
  const sb = supabaseBrowser();

  useEffect(() => {
    setPerm(
      typeof Notification === "undefined"
        ? "unsupported"
        : Notification.permission,
    );
    fetch("/network/manifest.json")
      .then((r) => r.json())
      .then((m) => setSources(m.sources ?? []))
      .catch(() => {});
    if (!sb) return;
    sb.auth.getUser().then(({ data }) => setUser(data.user));
    const { data } = sb.auth.onAuthStateChange((_e, s) => {
      setUser(s?.user ?? null);
      if (s?.user) void syncPlaces().catch(() => {});
    });
    return () => data.subscription.unsubscribe();
  }, [sb]);

  const ios =
    typeof navigator !== "undefined" &&
    /iphone|ipad/i.test(navigator.userAgent);
  const standalone =
    typeof window !== "undefined" &&
    window.matchMedia("(display-mode: standalone)").matches;

  const savePlace = async (kind: "home" | "work", p: typeof from) => {
    if (!p) return;
    const old = await db.places.where("kind").equals(kind).toArray();
    await db.places.bulkDelete(old.map((o) => o.id as number));
    await db.places.add({
      name: p.name ?? kind,
      lat: p.lat,
      lng: p.lng,
      kind,
      updatedAt: Date.now(),
    });
    setMsg(`✓ ${t(lang, kind)}`);
    if (user) void syncPlaces().catch(() => {});
  };

  return (
    <div className="space-y-5">
      <Row title={t(lang, "language")}>
        <Seg
          value={lang}
          options={[
            ["id", "Bahasa Indonesia"],
            ["en", "English"],
          ]}
          onChange={(v) => setPrefs({ lang: v })}
        />
      </Row>
      <Row title={t(lang, "motoOption")}>
        <Seg
          value={moto}
          options={[
            ["ojek", t(lang, "ojek")],
            ["own", t(lang, "ownMoto")],
            ["none", t(lang, "noMoto")],
          ]}
          onChange={(v) => setPrefs({ moto: v })}
        />
      </Row>
      <Row title={t(lang, "price")}>
        <p className="text-xs text-slate-500">{t(lang, "timeValue")}</p>
        <Seg
          value={String(vot)}
          options={[
            ["0", t(lang, "ignorePrice")],
            ["250", "Rp250/mnt"],
            ["500", "Rp500/mnt"],
            ["1000", "Rp1.000/mnt"],
          ]}
          onChange={(v) => setPrefs({ vot: Number(v) })}
        />
        <p className="pt-1 text-xs text-slate-500">{t(lang, "ojekCap")}</p>
        <Seg
          value={String(maxOjek)}
          options={[
            ["0", t(lang, "noCap")],
            ["15000", "Rp15rb"],
            ["25000", "Rp25rb"],
            ["40000", "Rp40rb"],
          ]}
          onChange={(v) => setPrefs({ maxOjek: Number(v) })}
        />
        <p className="text-xs text-slate-500">{t(lang, "priceNote")}</p>
      </Row>
      <Row title={t(lang, "demo")}>
        <Seg
          value={scenario}
          options={SCENARIOS.map((s) => [s, t(lang, SCENARIO_META[s].key)])}
          onChange={(v) => setPrefs({ scenario: v })}
        />
        <p className="text-xs text-slate-500">
          {lang === "id"
            ? "Badai buatan ditambahkan di atas prakiraan sebenarnya, untuk demo."
            : "A synthetic storm is added on top of the real forecast, for demos."}
        </p>
      </Row>
      <Row title={t(lang, "notifications")}>
        {perm === "granted" ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <Bell className="size-4" /> {t(lang, "notifOn")}
          </p>
        ) : perm === "unsupported" ? (
          <p className="text-sm text-slate-500">{t(lang, "iosHint")}</p>
        ) : (
          <button
            type="button"
            onClick={async () =>
              setPerm(await Notification.requestPermission())
            }
            className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
          >
            <Bell className="size-4" /> {t(lang, "enableNotif")}
          </button>
        )}
        {ios && !standalone && (
          <p className="text-xs text-slate-500">{t(lang, "iosHint")}</p>
        )}
      </Row>
      <Row title={t(lang, "saved")}>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["home", House, to ?? from],
              ["work", Briefcase, to ?? from],
            ] as const
          ).map(([kind, Icon, p]) => (
            <button
              key={kind}
              type="button"
              disabled={!p}
              onClick={() => savePlace(kind, p)}
              className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:opacity-40 dark:border-slate-700"
            >
              <Icon className="size-4" /> {t(lang, "save")} {t(lang, kind)}:{" "}
              {p?.name ?? "—"}
            </button>
          ))}
        </div>
        {msg && <p className="text-xs text-emerald-700">{msg}</p>}
      </Row>
      {sb && (
        <Row title={t(lang, "account")}>
          {user ? (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{user.email}</span>
              <button
                type="button"
                onClick={() => sb.auth.signOut()}
                className="flex items-center gap-1 rounded-lg border px-2 py-1 text-xs"
              >
                <LogOut className="size-3.5" /> {t(lang, "signOut")}
              </button>
            </div>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const { error } = await sb.auth.signInWithOtp({
                  email,
                  options: { emailRedirectTo: window.location.origin },
                });
                setMsg(error ? error.message : t(lang, "emailSent"));
              }}
            >
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@contoh.com"
                className="h-10 flex-1 rounded-xl bg-slate-100 px-3 text-sm outline-none dark:bg-slate-900"
              />
              <button
                type="submit"
                className="flex items-center gap-1 rounded-xl bg-slate-900 px-3 text-sm font-medium text-white dark:bg-white dark:text-slate-900"
              >
                <Mail className="size-4" /> {t(lang, "signIn")}
              </button>
            </form>
          )}
          <p className="text-xs text-slate-500">{t(lang, "syncNote")}</p>
        </Row>
      )}
      <Row title={t(lang, "sources")}>
        <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
          {sources.map((s) => (
            <li key={s.name}>
              <span className="font-medium">{s.name}</span> — {s.note}
            </li>
          ))}
          <li>
            <span className="font-medium">
              {lang === "id" ? "Hujan" : "Rain"}
            </span>{" "}
            — Open-Meteo 15-minute forecast, BMKG fallback; radar RainViewer
          </li>
          <li>
            <span className="font-medium">
              {lang === "id" ? "Peta" : "Map"}
            </span>{" "}
            — © OpenStreetMap, OSRM, Photon
          </li>
        </ul>
        <p className="text-xs text-slate-500">{t(lang, "research")}</p>
        <p className="text-xs text-slate-400">{t(lang, "fullName")}</p>
      </Row>
    </div>
  );
}
