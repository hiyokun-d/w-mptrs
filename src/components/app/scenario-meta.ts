import {
  CloudDrizzle,
  CloudLightning,
  CloudRain,
  CloudRainWind,
  MapPin,
  MoveRight,
  Sun,
  Tornado,
  Waves,
  Zap,
} from "lucide-react";
import type { Scenario } from "@/lib/core/scenarios";
import type { Key } from "@/lib/i18n";

/** Label and icon for every demo scenario, in menu order. */
export const SCENARIO_META: Record<Scenario, { key: Key; icon: typeof Sun }> = {
  live: { key: "live", icon: Sun },
  drizzle: { key: "drizzle", icon: CloudDrizzle },
  "storm-coming": { key: "stormComing", icon: CloudRainWind },
  "storm-over-start": { key: "stormStart", icon: CloudLightning },
  "storm-at-destination": { key: "stormDest", icon: MapPin },
  "passing-shower": { key: "passingShower", icon: MoveRight },
  "sudden-downpour": { key: "suddenDownpour", icon: Zap },
  "storm-leaving": { key: "stormLeaving", icon: Waves },
  "heavy-everywhere": { key: "heavyEverywhere", icon: CloudRain },
  extreme: { key: "extreme", icon: Tornado },
};
