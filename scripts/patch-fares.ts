/**
 * Patches fare/timing metadata onto existing transit routes that were imported
 * without this data (e.g. TransJakarta from GTFS, or older KRL/MRT imports).
 * Safe to run multiple times — uses updateMany.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const CONNECTION = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!CONNECTION) {
  console.error("DIRECT_URL or DATABASE_URL required in .env");
  process.exit(1);
}

async function main() {
  const adapter = new PrismaPg({ connectionString: CONNECTION! });
  const prisma = new PrismaClient({ adapter });

  try {
    // ── TransJakarta ────────────────────────────────────────────────────────────
    // Flat Rp 3.500 per trip. Free integrated transfer within 3 h via multi-modal tap.
    const tjResult = await prisma.transitRoute.updateMany({
      where: { type: "transjakarta" },
      data: {
        fareMin: 3500,
        fareMax: 3500,
        fareNote: "Flat Rp 3.500 — tap KMT/e-money. Gratis transfer antar-koridor dalam 3 jam",
        operatingHours: "05:00–22:00",
        frequency: 8,
        color: "#E32526",
      },
    });
    console.log(`TransJakarta: patched ${tjResult.count} routes`);

    // ── MRT (in case re-run without re-import) ──────────────────────────────────
    const mrtResult = await prisma.transitRoute.updateMany({
      where: { type: "mrt", fareMin: 0 },
      data: {
        fareMin: 3000,
        fareMax: 14000,
        fareNote: "Rp 3.000–Rp 14.000 berbasis jarak — tap KMT/e-money/JakCard",
        operatingHours: "05:00–24:00",
        frequency: 5,
        color: "#0066CC",
      },
    });
    console.log(`MRT: patched ${mrtResult.count} routes`);

    // ── LRT (in case re-run without re-import) ──────────────────────────────────
    const lrtResult = await prisma.transitRoute.updateMany({
      where: { type: "lrt", fareMin: 0 },
      data: {
        fareMin: 5000,
        fareMax: 5000,
        fareNote: "Flat Rp 5.000 — tap e-money/KMT/JakCard",
        operatingHours: "05:00–23:30",
        frequency: 10,
        color: "#FF6600",
      },
    });
    console.log(`LRT: patched ${lrtResult.count} routes`);

    // ── KRL (in case re-run without re-import) ──────────────────────────────────
    const krlResult = await prisma.transitRoute.updateMany({
      where: { type: "krl", fareMin: 0 },
      data: {
        fareMin: 3000,
        fareMax: 12000,
        fareNote: "Rp 3.000 (0–25 km) + Rp 1.000 / 10 km — tap KMT/e-money",
        operatingHours: "04:30–23:30",
        frequency: 15,
        color: "#E91E8C",
      },
    });
    console.log(`KRL: patched ${krlResult.count} routes`);

    const total = tjResult.count + mrtResult.count + lrtResult.count + krlResult.count;
    console.log(`\nDone. Total routes patched: ${total}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
