@AGENTS.md

# W-MPTRS — Project Reference

## What this is
Weather-Aware Multimodal Public Transportation Routing System for Jakarta, Indonesia. Academic research prototype. Deadline: 2026-05-17.

## Package Manager
**Use `bun` for all installs and script runs** — not npm/npx.
- `bun install`, `bun run dev`, `bun run build`
- Prisma CLI still via `bunx prisma` (not npx)
- `bun.lock` is the lockfile — do not commit `package-lock.json` changes

## Stack
- **Next.js 16.2.6** (App Router, `src/` layout) — React 19 RC, React Compiler enabled
- **TypeScript 5**, strict mode
- **Tailwind 4** + `tw-animate-css` + shadcn (CSS-based, no tailwind.config.js)
- **Prisma 7.8** ORM — v7 has breaking changes (see below)
- **@prisma/adapter-pg** — required; v7 needs explicit adapter in PrismaClient constructor
- **Supabase** PostgreSQL database (ap-southeast-1)
- **@supabase/supabase-js** — for auth/realtime only (not for DB queries — use Prisma)
- **Leaflet + react-leaflet** — maps (NO Google Maps)
- **motion** (Framer Motion v12) — animations
- **Zustand 5** — global state
- **Biome 2** — linter/formatter (not ESLint/Prettier)
- **axios** — HTTP client

## Prisma v7 Breaking Changes (critical)
- `url`/`directUrl` are NOT in `prisma/schema.prisma` — they live in `prisma.config.ts`
- `PrismaClient` requires an `adapter` — bare `new PrismaClient()` won't connect
- Client output path: `src/generated/prisma` (not `node_modules/@prisma/client`)
- Import from `@/generated/prisma/client`, not `@prisma/client`
- No `index.ts` in generated dir — import the `client` file directly
- `directUrl` is NOT a valid property in `prisma.config.ts` datasource type
- `db push` hangs on pgbouncer (port 6543) — always use DIRECT_URL (port 5432): `DATABASE_URL="$DIRECT_URL_VALUE" bunx prisma db push`

## Database
- **Supabase project**: `qrvbesxjxaykycooqpvu` (ap-southeast-1)
- **DATABASE_URL**: pgbouncer pooler, port 6543 — runtime queries
- **DIRECT_URL**: session pooler, port 5432 — migrations/push
- Run push: `DATABASE_URL="$DIRECT_URL_VALUE" bunx prisma db push`

## Prisma Models (in Supabase)
- `profiles` — user prefs (preferredModes, avoidMotorcycleRain)
- `weather_cache` — BMKG/OWM cache, TTL 60s, indexed on lat/lng + expiresAt
- `routes_history` — research log: origin, destination, mode, weather, discomfort score

## Folder Structure
```
src/
├── app/
│   ├── api/
│   │   ├── weather/route.ts   — GET ?lat&lng&simulate=<intensity>
│   │   ├── routes/route.ts    — POST {origin, destination, weatherIntensity}
│   │   └── history/route.ts   — GET/POST route history
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── ui/                    — shadcn components
│   ├── map/                   — MapView, WeatherOverlay, RouteLayer
│   ├── routing/               — RouteDashboard, RouteCard, SearchForm
│   ├── simulation/            — SimulationPanel
│   └── weather/               — WeatherBadge
├── generated/prisma/          — DO NOT EDIT (Prisma generated)
├── lib/
│   ├── db.ts                  — Prisma singleton with PrismaPg adapter
│   ├── supabase/client.ts     — browser Supabase client (auth/realtime)
│   ├── supabase/server.ts     — server Supabase client (service role)
│   ├── weather/
│   │   ├── bmkg.ts            — BMKG API (primary, Indonesia)
│   │   └── openweathermap.ts  — OWM (fallback)
│   ├── routing/
│   │   ├── graphhopper.ts     — GraphHopper multimodal routing
│   │   └── discomfort.ts      — Discomfort Penalty Engine (core research logic)
│   ├── store/index.ts         — Zustand store
│   └── utils.ts               — cn() helper
└── types/index.ts             — shared TS types
```

## Discomfort Penalty Engine (`src/lib/routing/discomfort.ts`)
Core research algorithm. Base penalties:
- `motorcycle` → +40 (×rainfall multiplier)
- `walking` → +25 (×multiplier; ×0.5 if walk < 500m)
- `transjakarta/mrt/lrt` → +2–3 flat (sheltered, no multiplier)
- `car` → +8, `bicycle` → +20

Rainfall multipliers: none=0, light=0.3, moderate=0.65, heavy=1.0, extreme=1.4

Modal shift triggered when score diff ≥ 10 between fastest and weather-aware route.

## Simulation Mode
`GET /api/weather?lat=X&lng=Y&simulate=heavy` — returns synthetic weather data.
Used for research demo: toggle `simulation.active` in Zustand store → all route scoring reacts instantly.

## Required Env Vars
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=          # pgbouncer (port 6543) — runtime
DIRECT_URL=            # session pooler (port 5432) — migrations
GRAPHHOPPER_API_KEY=
OPENWEATHERMAP_API_KEY=
```
