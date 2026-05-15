"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import type { HistoryRow } from "@/app/data-testing/page";
import DataTestingDashboard from "@/components/data-testing/DataTestingDashboard";
import { X } from "lucide-react";

interface Props {
  onClose: () => void;
}

export default function ShowcaseResearchView({ onClose }: Props) {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loaded, setLoaded]   = useState(false);

  useEffect(() => {
    axios.get<HistoryRow[]>("/api/history?limit=200")
      .then((r) => setHistory(r.data))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[#1e2530] bg-[#060810]/95 backdrop-blur-sm shrink-0">
        <div className="w-1.5 h-5 bg-blue-500 rounded-full" />
        <span className="text-[10px] font-mono text-blue-400 tracking-widest uppercase">W-MPTRS</span>
        <span className="text-[#1e2530]">/</span>
        <span className="text-xs text-[#64748b]">Research Data &amp; Validation</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[10px] text-[#475569]">
            {loaded ? (history.length > 0 ? `${history.length} DB rows` : "No DB rows") : "Loading…"}
          </span>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-xs text-[#64748b] hover:text-white transition-colors px-2.5 py-1.5 rounded-lg hover:bg-[#1e2530]"
          >
            <X size={13} />
            Back to Route Finder
          </button>
        </div>
      </div>

      {/* Dashboard scrollable */}
      <div className="flex-1 overflow-y-auto bg-[#060810]">
        <DataTestingDashboard history={history} />
      </div>
    </div>
  );
}
