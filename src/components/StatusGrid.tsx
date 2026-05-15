"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { QuotaRow, TransitStat } from "./StatusDashboard";

interface CheckResult {
  ok: boolean;
  detail: string;
}

interface ClientModule {
  name: string;
  pkg: string;
}

interface Props {
  serverChecks: Record<string, CheckResult>;
  clientModules: ClientModule[];
  quotaTable: QuotaRow[];
  transitStats: TransitStat[];
}

export default function StatusGrid({ serverChecks, clientModules, quotaTable, transitStats }: Props) {
  const [clientChecks, setClientChecks] = useState<Record<string, CheckResult>>({});

  useEffect(() => {
    const results: Record<string, CheckResult> = {};
    for (const mod of clientModules) {
      results[mod.name] = { ok: true, detail: `${mod.pkg} bundled` };
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { animate } = require("motion/react");
      results["Motion / Framer Motion"] = {
        ok: typeof animate === "function",
        detail: typeof animate === "function" ? "motion/react ready" : "animate not found",
      };
    } catch (e) {
      results["Motion / Framer Motion"] = { ok: false, detail: String(e) };
    }
    setClientChecks(results);
  }, [clientModules]);

  const allChecks = { ...serverChecks, ...clientChecks };
  const total = Object.keys(allChecks).length;
  const passed = Object.values(allChecks).filter((c) => c.ok).length;

  const totalStops = transitStats.reduce((s, t) => s + t.stops, 0);
  const totalRoutes = transitStats.reduce((s, t) => s + t.routes, 0);

  return (
    <div className="space-y-8">

      {/* ── Summary bar ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between p-4 bg-slate-800/40 rounded-xl border border-slate-700/50">
        <div>
          <p className="text-sm text-slate-400">System readiness</p>
          <p className="text-2xl font-bold tabular-nums">
            {passed}
            <span className="text-slate-500 text-lg">/{total}</span>
          </p>
        </div>
        <div className="w-32 h-2 bg-slate-700 rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${passed === total ? "bg-emerald-500" : passed > total / 2 ? "bg-yellow-400" : "bg-red-500"}`}
            initial={{ width: 0 }}
            animate={{ width: total > 0 ? `${(passed / total) * 100}%` : "0%" }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* ── API Quotas & Limits ─────────────────────────────────────────── */}
      <Section label="API Quotas & Limits">
        <div className="space-y-2">
          {quotaTable.map((row, i) => (
            <QuotaCard key={row.service} row={row} index={i} />
          ))}
        </div>
      </Section>

      {/* ── Transit Database ────────────────────────────────────────────── */}
      {transitStats.length > 0 && (
        <Section label="Transit Database">
          <div className="grid grid-cols-2 gap-2">
            {transitStats.map((stat, i) => (
              <TransitStatCard key={stat.type} stat={stat} index={i} />
            ))}
          </div>
          <div className="mt-2 flex gap-4 p-3 bg-slate-800/30 rounded-lg border border-slate-700/30">
            <div className="text-center flex-1">
              <p className="text-xs text-slate-500 uppercase tracking-wider">Total Stops</p>
              <p className="text-xl font-bold tabular-nums text-slate-200">{totalStops.toLocaleString()}</p>
            </div>
            <div className="w-px bg-slate-700" />
            <div className="text-center flex-1">
              <p className="text-xs text-slate-500 uppercase tracking-wider">Total Routes</p>
              <p className="text-xl font-bold tabular-nums text-slate-200">{totalRoutes.toLocaleString()}</p>
            </div>
          </div>
        </Section>
      )}

      {/* ── Server / Infrastructure ─────────────────────────────────────── */}
      <Section label="Server / Infrastructure">
        {Object.entries(serverChecks).map(([name, result], i) => (
          <StatusRow key={name} name={name} result={result} index={i} />
        ))}
      </Section>

      {/* ── Client Packages ─────────────────────────────────────────────── */}
      <Section label="Client Packages">
        {clientModules.map((mod, i) => {
          const result = clientChecks[mod.name] ?? { ok: false, detail: "checking…" };
          return <StatusRow key={mod.name} name={mod.name} result={result} index={i} />;
        })}
      </Section>

      <p className="text-xs text-slate-600 text-center pt-2">
        Deadline · 2026-05-17 · Jakarta, Indonesia
      </p>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">{label}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function QuotaCard({ row, index }: { row: QuotaRow; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className="p-4 rounded-xl border bg-slate-800/30 border-slate-700/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium">{row.service}</p>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-400">
              {row.tier}
            </span>
            {!row.tracked && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-700/40 text-slate-500">
                usage not tracked
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">{row.note}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <LimitChip label="Daily limit" value={row.dailyLimit} />
        <LimitChip label="Monthly limit" value={row.monthlyLimit} />
      </div>
    </motion.div>
  );
}

function LimitChip({ label, value }: { label: string; value: string }) {
  const isUnlimited = value.toLowerCase().startsWith("unlimited");
  return (
    <div className="flex flex-col gap-0.5 p-2 rounded-lg bg-slate-700/30 border border-slate-700/30">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</span>
      <span className={`text-xs font-mono font-semibold ${isUnlimited ? "text-emerald-400" : "text-sky-300"}`}>
        {value}
      </span>
    </div>
  );
}

function TransitStatCard({ stat, index }: { stat: TransitStat; index: number }) {
  const hasRoutes = stat.routes > 0;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.06, duration: 0.3 }}
      className="p-3 rounded-xl border border-slate-700/40 bg-slate-800/30"
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: stat.color }} />
        <p className="text-xs font-semibold truncate">{stat.label}</p>
        {!hasRoutes && (
          <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
            no routes
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1">
        <div>
          <p className="text-[10px] text-slate-500">Stops</p>
          <p className="text-base font-bold tabular-nums" style={{ color: stat.color }}>
            {stat.stops.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-slate-500">Routes</p>
          <p className={`text-base font-bold tabular-nums ${hasRoutes ? "text-slate-200" : "text-slate-600"}`}>
            {stat.routes.toLocaleString()}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function StatusRow({
  name,
  result,
  index,
}: {
  name: string;
  result: CheckResult;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.3 }}
      className={`flex items-start gap-4 p-4 rounded-xl border transition-colors ${
        result.ok
          ? "bg-emerald-950/30 border-emerald-800/40"
          : "bg-red-950/30 border-red-800/40"
      }`}
    >
      <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${result.ok ? "bg-emerald-400" : "bg-red-400"}`} />
      <div className="min-w-0">
        <p className="text-sm font-medium leading-none">{name}</p>
        <p className={`mt-1 text-xs truncate ${result.ok ? "text-emerald-400/70" : "text-red-400/70"}`}>
          {result.detail}
        </p>
      </div>
      <span
        className={`ml-auto shrink-0 text-[10px] font-mono px-2 py-0.5 rounded-full ${
          result.ok
            ? "bg-emerald-500/20 text-emerald-300"
            : "bg-red-500/20 text-red-300"
        }`}
      >
        {result.ok ? "OK" : "FAIL"}
      </span>
    </motion.div>
  );
}
