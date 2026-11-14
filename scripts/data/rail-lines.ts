// MRT and LRT lines that have no public timetable feed. Station order and
// coordinates come from rail-stations.json. Run times and headways are the
// operators' published figures (approximate; see docs/DATA.md).

export interface RailLine {
  id: string;
  short: string;
  long: string;
  mode: "mrt" | "lrt";
  color: string;
  fare: number;
  /** station ids in travel order (direction A → B) */
  stations: string[];
  /** end-to-end scheduled minutes */
  minutes: number;
  /** [startHour, endHour, headwayMinutes] by time of day, weekdays */
  weekday: [number, number, number][];
  /** weekends and holidays */
  weekend: [number, number, number][];
}

const MRT_STATIONS = [
  "mrt_lbg",
  "mrt_ftm",
  "mrt_cpr",
  "mrt_hnw",
  "mrt_bla",
  "mrt_blm",
  "mrt_asn",
  "mrt_sny",
  "mrt_ist",
  "mrt_bdh",
  "mrt_stb",
  "mrt_dka",
  "mrt_bhi",
];

const JABODEBEK_TRUNK = [
  "lrtb_dka",
  "lrtb_stb",
  "lrtb_rsd",
  "lrtb_kng",
  "lrtb_pcr",
  "lrtb_ckk",
  "lrtb_clw",
  "lrtb_cwg",
];

export const RAIL_LINES: RailLine[] = [
  {
    id: "mrt-ns",
    short: "MRT",
    long: "MRT Jakarta Lebak Bulus – Bundaran HI",
    mode: "mrt",
    color: "#0066CC",
    fare: 3000,
    stations: MRT_STATIONS,
    minutes: 30,
    weekday: [
      [5, 7, 10],
      [7, 9, 5],
      [9, 17, 10],
      [17, 19, 5],
      [19, 24, 10],
    ],
    weekend: [[5, 24, 10]],
  },
  {
    id: "lrt-jakarta",
    short: "LRT Jakarta",
    long: "LRT Jakarta Pegangsaan Dua – Velodrome",
    mode: "lrt",
    color: "#E2231A",
    fare: 5000,
    stations: ["lrtj_pgd", "lrtj_bnu", "lrtj_bns", "lrtj_plm", "lrtj_eqs", "lrtj_vld"],
    minutes: 13,
    weekday: [[5.5, 23, 10]],
    weekend: [[5.5, 23, 10]],
  },
  {
    id: "lrt-jabodebek-cibubur",
    short: "LRT Cibubur",
    long: "LRT Jabodebek Dukuh Atas – Harjamukti",
    mode: "lrt",
    color: "#00A651",
    fare: 5000,
    stations: [...JABODEBEK_TRUNK, "lrtb_tmn", "lrtb_kpr", "lrtb_crc", "lrtb_hjm"],
    minutes: 39,
    weekday: [
      [5, 6.5, 15],
      [6.5, 9, 10],
      [9, 16, 15],
      [16, 19, 10],
      [19, 23, 20],
    ],
    weekend: [[5.5, 23, 20]],
  },
  {
    id: "lrt-jabodebek-bekasi",
    short: "LRT Bekasi",
    long: "LRT Jabodebek Dukuh Atas – Jatimulya",
    mode: "lrt",
    color: "#00A651",
    fare: 5000,
    stations: [
      ...JABODEBEK_TRUNK,
      "lrtb_hlm",
      "lrtb_jtb",
      "lrtb_ck1",
      "lrtb_ck2",
      "lrtb_bkb",
      "lrtb_jtm",
    ],
    minutes: 41,
    weekday: [
      [5, 6.5, 15],
      [6.5, 9, 10],
      [9, 16, 15],
      [16, 19, 10],
      [19, 23, 20],
    ],
    weekend: [[5.5, 23, 20]],
  },
];

/** KRL line display names and colours (KAI Commuter line map). */
export const KRL_LINES: Record<string, { short: string; color: string }> = {
  "COMMUTER LINE BOGOR": { short: "KRL Bogor", color: "#E30A16" },
  "COMMUTER LINE CIKARANG": { short: "KRL Cikarang", color: "#0084D8" },
  "COMMUTER LINE RANGKASBITUNG": { short: "KRL Rangkasbitung", color: "#16812B" },
  "COMMUTER LINE TANGERANG": { short: "KRL Tangerang", color: "#623814" },
  "COMMUTER LINE TANJUNGPRIUK": { short: "KRL Tanjung Priok", color: "#DD0067" },
  "COMMUTER LINE BST": { short: "KA Bandara", color: "#7B3F98" },
};
