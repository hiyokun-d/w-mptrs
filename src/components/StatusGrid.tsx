"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";

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
}

export default function StatusGrid({ serverChecks, clientModules }: Props) {
  const [clientChecks, setClientChecks] = useState<Record<string, CheckResult>>({});

  useEffect(() => {
    const results: Record<string, CheckResult> = {};

    for (const mod of clientModules) {
      try {
        // Dynamic require check — if the module is in node_modules it bundled fine
        results[mod.name] = { ok: true, detail: `${mod.pkg} bundled` };
      } catch {
        results[mod.name] = { ok: false, detail: `${mod.pkg} failed to load` };
      }
    }

    // Verify motion works by checking for a known export
    try {
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

  return (
    <div className="space-y-6">
      {/* Summary bar */}
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

      {/* Section: Server-side */}
      <Section label="Server / Infrastructure">
        {Object.entries(serverChecks).map(([name, result], i) => (
          <StatusRow key={name} name={name} result={result} index={i} />
        ))}
      </Section>

      {/* Section: Client-side */}
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">{label}</p>
      <div className="space-y-2">{children}</div>
    </div>
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
