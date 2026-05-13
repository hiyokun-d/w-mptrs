Phase 1: Foundation & Infrastructure (Target: Hari Ini - 13 Mei)

Fokus: Menyiapkan wadah dan database.

[ ] 1. Initialize Next.js Project

Setup App Router, Tailwind, dan TypeScript.

Pasang folder structure sesuai standar (di src/).

[ ] 2. Setup Supabase

Buat project baru di Supabase.

Eksekusi SQL Schema: Buat tabel profiles, routes_history, dan weather_cache. (Minta ke saya kalau mau SQL-nya sekarang).

Hubungkan .env.local dengan SUPABASE_URL dan ANON_KEY.

[ ] 3. Install Essential Dependencies

UI: lucide-react, shadcn/ui, framer-motion.

Maps: leaflet, react-leaflet.

State: zustand.

Routing: axios.

Phase 2: Data Sourcing & Basic Map (Target: Besok - 14 Mei)

Fokus: Mendapatkan data mentah cuaca dan rute.

[ ] 4. BMKG / OpenWeather Integration

Buat server action atau API route untuk fetch cuaca berdasarkan koordinat Jakarta.

Implementasi logic caching di Supabase agar tidak kena rate limit API.

[ ] 5. Basic Map Implementation

Tampilkan peta Leaflet dengan koordinat pusat di Jakarta.

Tambahkan marker untuk Origin dan Destination.

[ ] 6. Routing Engine Bridge

Koneksi ke GraphHopper API (atau OSRM).

Berhasil menarik garis rute (Polyline) mentah dari Titik A ke Titik B di peta.

Phase 3: The "Intelligence" (Target: 15 Mei - Saat Claude Code Aktif)

Fokus: Algoritma penalti cuaca (Bagian inti riset).

[ ] 7. Discomfort Scoring Engine

Buat fungsi calculateWeatherPenalty().

Implementasi logic: Jika hujan di koordinat X, tambahkan penalti pada moda transportasi terbuka (Motor/Jalan Kaki).

[ ] 8. Multimodal Logic

Logic untuk membandingkan rute Motor vs Public Transport secara simultan.

Fitur "Modal Shift": Suggest pindah ke MRT/TransJakarta jika hujan lebat.

[ ] 9. Supabase Auth (Optional but Good)

Login sederhana agar user bisa menyimpan "Favorite Routes".

Phase 4: UI/UX & Simulation (Target: 16 Mei)

Fokus: Visualisasi yang meyakinkan untuk demo riset.

[ ] 10. Dashboard UI

Panel input pencarian yang modern.

Card perbandingan rute (Fastest vs Safest).

Badge "Recommended" yang muncul berdasarkan skor cuaca.

[ ] 11. Weather Overlay

Tampilkan visualisasi area hujan di atas peta (Heatmap atau Icon).

[ ] 12. Simulation Mode

Tombol "Trigger Heavy Rain" untuk demo. Ini sangat penting untuk presentasi riset agar kamu bisa menunjukkan perubahan rute secara instan tanpa menunggu hujan beneran.

Phase 5: Final Polish & Research Data (Target: 17 Mei - DEADLINE)

Fokus: Stabilitas dan laporan.

[ ] 13. Analytics Log

Pastikan setiap pencarian rute tersimpan di database untuk bahan statistik paper kamu.

[ ] 14. Deployment

Deploy ke Vercel.

[ ] 15. Bug Fixing & Performance

Cek responsivitas di mobile (karena commuter pake HP).
