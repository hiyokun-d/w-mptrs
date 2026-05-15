# W-MPTRS Progress — Deadline: 17 Mei 2026

## Phase 1: Foundation & Infrastructure ✅ DONE
- [x] 1. Initialize Next.js Project — App Router, Tailwind 4, TypeScript, `src/` layout
- [x] 2. Setup Supabase — Prisma models (`profiles`, `routes_history`, `weather_cache`), `.env.local` wired
- [x] 3. Install Essential Dependencies — shadcn/ui, framer-motion, leaflet/react-leaflet, zustand, axios

## Phase 2: Data Sourcing & Basic Map ✅ DONE
- [x] 4. BMKG / OpenWeather Integration — `src/lib/weather/bmkg.ts` + `/api/weather` with Supabase caching
- [x] 5. Basic Map Implementation — `JakartaMap.tsx`, `AppMap.tsx` (Leaflet, Jakarta center)
- [x] 6. Routing Engine Bridge — `graphhopper.ts` + `/api/routes` polyline fetching

## Phase 3: The "Intelligence" ✅ DONE
- [x] 7. Discomfort Scoring Engine — `discomfort.ts`: `calculateWeatherPenalty()`, all penalties + rainfall multipliers
- [x] 8. Multimodal Logic — `suggestModalShift()` in discomfort.ts; modal shift triggers when score diff ≥ 10
- [ ] 9. Supabase Auth *(optional)* — skipped; no login/session UI built

## Phase 4: UI/UX & Simulation 🔶 PARTIAL
- [x] 10. Dashboard UI — `AppDemo.tsx`: search, weather card, route cards, "Recommended" badge logic
- [ ] 11. Weather Overlay — **NOT DONE** — no heatmap/icon overlay on map yet
- [x] 12. Simulation Mode — toggle in `AppDemo.tsx` + Zustand store; `?simulate=<intensity>` on weather API

## Phase 5: Final Polish & Research Data ⏳ IN PROGRESS
- [x] 13. Analytics Log — `/api/history` GET/POST, saves every route search to DB
- [ ] 14. Deployment — **NOT DONE** — not deployed to Vercel yet
- [ ] 15. Bug Fixing & Performance — mobile responsiveness check pending

## Phase 6: Transit Network Data ✅ DONE
- [x] 16. TransJakarta GTFS Import — `scripts/import-gtfs.ts` → 8,216 stops + 253 routes in `transit_stops`/`transit_routes`
- [x] 17. KRL Commuterline Import — `scripts/import-krl.ts` → 94 stations via Comuline API + Nominatim geocoding
- [x] 18. MRT Jakarta Import — `scripts/import-mrt-lrt.ts` → 20 stations hardcoded (Phase 1 + Phase 2)
- [x] 19. LRT Jakarta + Jabodebek Import — same script → 24 stations (6 LRT Jkt + 18 LRT Jabodebek)
- [x] 20. Transit API — `GET /api/transit?types=krl,mrt,lrt` → serves stops for map layer
- [x] 21. Transit Map Layer — "Transit Network" toggle in showcase → colored dots (KRL=blue, MRT=red, LRT=green)
- [x] 22. Dynamic Route Legend — map legend now shows actual mode names from routing result

---

## Summary
**16 / 19 done** (skipping #9 Auth as optional)

**Total transit data in DB:**
- `transit_stops`: ~8,374 rows (8,216 TransJakarta + 94 KRL + 20 MRT + 44 LRT)
- `transit_routes`: 257 rows (253 TransJakarta + 1 MRT + 3 LRT)

Critical remaining before deadline (17 Mei — **3 days left**):
1. **Weather Overlay** (#11) — heatmap/rain icon on map
2. **Deploy to Vercel** (#14) — URGENT
3. **Mobile responsiveness** (#15)
