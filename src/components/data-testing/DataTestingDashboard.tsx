"use client";

import { useState } from "react";
import type { HistoryRow } from "@/app/data-testing/page";
import SimulationPanel from "./SimulationPanel";
import AnalyticsPanel from "./AnalyticsPanel";
import DataIntegrityPanel from "./DataIntegrityPanel";
import ResearchDatasetPanel from "./ResearchDatasetPanel";
import RouteSVGSchematic from "./RouteSVGSchematic";
import WeatherRadiusViz from "./WeatherRadiusViz";

type Tab = "simulation" | "analytics" | "integrity" | "dataset" | "schematic" | "weather";

const TABS: { key: Tab; label: string; icon: string; desc: string }[] = [
  {
    key: "simulation",
    label: "Simulation",
    icon: "⚡",
    desc: "Edge-case scenario runner & BMKG override",
  },
  {
    key: "analytics",
    label: "Analytics",
    icon: "📊",
    desc: "Penalty distribution, modal shift rate, ETA trade-off",
  },
  {
    key: "integrity",
    label: "Data Integrity",
    icon: "🔬",
    desc: "Schema analysis, migration SQL, Supabase view",
  },
  {
    key: "dataset",
    label: "Research Dataset",
    icon: "📥",
    desc: "~295-row Jakarta scenario matrix — download CSV for papers",
  },
  {
    key: "schematic",
    label: "Route Schematic",
    icon: "🗺️",
    desc: "SVG route timeline — walking traces, segment durations, mode comparison",
  },
  {
    key: "weather",
    label: "Weather Radius",
    icon: "🌧️",
    desc: "Rain cell radius visualization — route impact, modal shift zones",
  },
];

interface Props {
  history: HistoryRow[];
}

export default function DataTestingDashboard({ history }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("simulation");

  return (
    <div className="min-h-screen bg-[#060810] text-white">
      {/* Header */}
      <div className="border-b border-[#1e2530] bg-[#060810]/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <a href="/" className="text-xs text-[#475569] hover:text-[#94a3b8] transition-colors">
                  ← W-MPTRS
                </a>
                <span className="text-[#1e2530]">/</span>
                <span className="text-xs text-[#64748b]">Data Testing</span>
              </div>
              <h1 className="text-xl font-bold tracking-tight">
                Data Testing &amp; Logic Validation
              </h1>
              <p className="text-xs text-[#475569] mt-0.5">
                Discomfort Penalty Engine · Edge-Case Simulation · Research Analytics
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`text-[10px] px-2.5 py-1 rounded-full font-medium ${
                  history.length > 0
                    ? "bg-emerald-900/50 text-emerald-400 border border-emerald-700/50"
                    : "bg-[#1a1f2e] text-[#475569] border border-[#1e2530]"
                }`}
              >
                {history.length > 0 ? `${history.length} DB rows` : "No DB rows"}
              </span>
              <span className="text-[10px] px-2.5 py-1 rounded-full font-medium bg-blue-900/50 text-blue-400 border border-blue-700/50">
                Deadline: 2026-05-17
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Tab Selector */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`text-left p-4 rounded-xl border transition-all ${
                activeTab === tab.key
                  ? "bg-[#0f1117] border-blue-500/60 shadow-lg shadow-blue-500/10"
                  : "bg-[#0a0d14] border-[#1e2530] hover:border-[#2a3040]"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{tab.icon}</span>
                <span
                  className={`text-sm font-semibold ${
                    activeTab === tab.key ? "text-white" : "text-[#64748b]"
                  }`}
                >
                  {tab.label}
                </span>
                {activeTab === tab.key && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                )}
              </div>
              <p className="text-xs text-[#475569] leading-snug">{tab.desc}</p>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "simulation" && <SimulationPanel />}
        {activeTab === "analytics" && <AnalyticsPanel history={history} />}
        {activeTab === "integrity" && <DataIntegrityPanel history={history} />}
        {activeTab === "dataset" && <ResearchDatasetPanel />}
        {activeTab === "schematic" && <RouteSVGSchematic />}
        {activeTab === "weather" && <WeatherRadiusViz />}
      </div>
    </div>
  );
}
