import { Suspense } from "react";
import StatusDashboard from "@/components/StatusDashboard";

export const metadata = {
  title: "W-MPTRS — System Status",
  description: "Weather-Aware Multimodal Public Transportation Routing System",
};

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#0a0f1e] text-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <header className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-2 h-8 bg-blue-500 rounded-full" />
            <span className="text-xs font-mono text-blue-400 tracking-widest uppercase">
              W-MPTRS v0.1
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Weather-Aware Routing System
          </h1>
          <p className="mt-2 text-slate-400 text-sm">
            Jakarta Multimodal Transit Intelligence · System Readiness Check
          </p>
        </header>

        <Suspense fallback={<LoadingSkeleton />}>
          <StatusDashboard />
        </Suspense>
      </div>
    </main>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="h-14 bg-slate-800/50 rounded-xl" />
      ))}
    </div>
  );
}
