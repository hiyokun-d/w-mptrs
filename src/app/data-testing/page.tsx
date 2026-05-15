import type { Metadata } from "next";
import { db } from "@/lib/db";
import DataTestingDashboard from "@/components/data-testing/DataTestingDashboard";

export const metadata: Metadata = {
  title: "W-MPTRS — Data Testing & Validation",
  description:
    "Discomfort Penalty Engine validation, edge-case simulation, and research analytics",
};

export default async function DataTestingPage() {
  let history: HistoryRow[] = [];

  try {
    const rows = await db.routeHistory.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    history = rows.map((r) => ({
      id: r.id,
      chosenMode: r.chosenMode,
      weatherIntensity: r.weatherIntensity,
      discomfortScore: Number(r.discomfortScore),
      routeLabel: r.routeLabel,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch {
    // DB unavailable — analytics will run with synthetic data
  }

  return <DataTestingDashboard history={history} />;
}

export interface HistoryRow {
  id: string;
  chosenMode: string;
  weatherIntensity: string;
  discomfortScore: number;
  routeLabel: string;
  createdAt: string;
}
