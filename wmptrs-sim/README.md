# wmptrs-sim

An interactive terminal simulator for the **Discomfort Penalty (DP)** routing
model from *"An Experimental Study on Weather-Aware Multimodal Public
Transportation Routing Systems"* (ICDSG 2026).

> **Interactive model demo — results vary by seed; not the original paper run.**
>
> Every number on screen is computed live from the model and a synthetic city.
> None of the paper's reported figures are hard-coded. Same seed + same
> parameters gives identical results, and a different seed gives different
> numbers.

---

## Quick start (reviewers)

No installation needed on macOS (Apple Silicon or Intel), Linux x86-64 or Windows x86-64.

```bash
cd wmptrs-sim
./run.sh
```

On macOS you can also **double-click `run.command`** in Finder. It opens Terminal
at a comfortable size and launches the simulator.

`run.sh` picks the prebuilt binary in `dist/` that matches your machine. If none
matches and Go is installed, it builds from source instead.

* Minimum terminal size: **80 × 24**. Larger windows get bigger maps and charts.
* Works in macOS Terminal, iTerm2 and most xterm-compatible terminals.
* Set `NO_COLOR=1` for a monochrome rendering (rain shown as `░▒▓`).
* Windows: run `dist\wmptrs-sim-windows-amd64.exe` in Windows Terminal.

### Headless mode

```bash
./run.sh --no-tui                       # JSON summary, paper-default parameters
./run.sh --no-tui --sweep               # + beta trade-off sweep
./run.sh --no-tui --bench               # + routing-call timings (not deterministic)
./run.sh --no-tui --preset averse --seed 7 --journeys 1000
./run.sh --no-tui --seeds 20            # + repeat over 20 independent seeds
./run.sh --no-tui --sensitivity         # + one-at-a-time sensitivity of E and w_m
./run.sh --no-tui --ahead               # + moving-storm experiment and raincoat-alert scores
./run.sh --export out                   # every experiment → CSV files for the paper figures
```

| flag | default | meaning |
|---|---|---|
| `--preset` | – | `default`, `perfect`, `high`, `averse` |
| `--beta` | 1 | DP weight β |
| `--r0` | 5 | sigmoid midpoint (mm/h) |
| `--k` | 0.74 | sigmoid steepness |
| `--sigma` | 0.3 | forecast log-normal error σ |
| `--shift` | 1.5 | forecast displacement SD (km) |
| `--journeys` | 400 | 50–1000 |
| `--seed` | 2026 | RNG seed |
| `--seeds` | 0 | with `--no-tui`: repeat the headline over N seeds (sign tests A3 vs A1/A2/A4) |
| `--sensitivity` | off | with `--no-tui`: vary E_brt_wait, E_rail_wait, w_walk_wait one at a time |
| `--ahead` | off | with `--no-tui`: moving storms, DP-now vs DP-ahead vs oracle, alert POD/FAR/lead |
| `--motion-err` | 0.1 | storm-velocity forecast error SD (km/min) for `--ahead` |
| `--export DIR` | – | run everything (≥ 20 seeds) and write CSVs into DIR |
| `--lang` | en | TUI language for Menu, Guide and alerts: `en` or `id` |

Explicit flags override the preset. 400 journeys × 5 variants take about 0.3 s
on a laptop.

---

## Screens and keys

The simulator opens on a **Menu** that groups every screen by purpose and numbers them in a
suggested tour order. Press a screen's letter to jump to it, and `m` (or `esc`) to come back from
anywhere. The header always shows the full system name, where you are (*section › screen,
step n of 13*) and which screen `tab` goes to next. `r` runs the experiment, `?` shows help,
`L` switches the Menu, Guide and raincoat alerts to **Bahasa Indonesia** (other screens stay in English,
so their terms match the paper) and `q` quits.

| # | section | screen | key | what it shows | keys on the screen |
|---|---|---|---|---|---|
| – | – | **Intro** | – | the full system name falling in like rain | `enter` → menu |
| – | – | **Menu** | `m` | all screens, grouped, with purpose and key list | `↑↓`, `enter`, letter |
| 1 | Learn | **Guide** | `g` | 16 illustrated slides: the problem, the formula with every symbol called out, the five variants, τ and w_m, E, r vs r_f (BMKG categories, forecast error), φ, why a sigmoid, β, the city, the routing pipeline, rain that has not arrived yet (raincoat alerts), the outcome measures, the statistics (live p-values), why apps should adopt it, limitations | `←→`, `p` autoplay, `pgdn/pgup` |
| 2 | Learn | **Symbols** | `y` | a reference card for every variable (c, τ, w_m, β, E, r, r_f, φ, σ(r), r0, k, σ_f, shift, α_m, D, exposed min, T, P/R/F1, A0–A4, N, seed): meaning, why the model needs it, the effect of raising or lowering it, the current value and a live visual | `↑↓`, `pgdn/pgup` |
| 3 | Demo | **Cases** | `c` | 8 hand-built journeys on the map: dry day, storm → modal shift, storm → detour, light rain below r0, the threshold cliff, forecast in the wrong place, already sheltered, playground. Each one is editable. Side panel: story / numbers / worked edge arithmetic | `n/b` or `1-8` case, `←→↑↓` move storm, `+/-` intensity, `[ ]` radius, `v` variant (A1–A4, oracle), `f` truth/forecast, `h` penalty heatmap, `s` animate the Dijkstra search, `i` panel, `0` reset |
| 4 | Demo | **Rain alert** | `n` | moving storms. Compares A0, DP on the rain *now*, and DP on the rain *you will meet* at each edge (motion-aware). A phone-style notification fires 15 min before rain reaches you, counts down, and marks where to stop and put on a raincoat (▲). It stays quiet while you are under cover. Scenarios: rain is coming, storm moving away, rain you can't avoid, under cover | `1-4` scenario, `v` route, `space` play/pause, `←→` scrub time, `i` panel, `0` restart |
| 5 | Experiment | **Params** | `a` | sliders for β, r0, k, σ, shift, journeys, seed; 4 presets | `↑↓`, `←→` (`shift` ×5), `1-4`, `e`/digit to type, `enter` run |
| 6 | Experiment | **Run** | `u` | live progress; the A3 route draws itself over the dim A0 route | `←→` journeys, `f`, `v` |
| 7 | Experiment | **Results** | `e` | dose-reduction bars with bootstrap 95 % CIs, Friedman, Holm-adjusted Wilcoxon, outcome table | `a` replay |
| 8 | Experiment | **Trade-off** | `t` | dose reduction vs time increase for β ∈ {0 … 8}, families A1, A2, A3 | `←→`, `s` re-sweep |
| 9 | Experiment | **φ explorer** | `f` | cost multiplier 1 + βEφ(r) per exposure class, with A1/A2 overlays | `←→` r0, `↑↓` k, `+/-` β, `[ ]`, `c` |
| 10 | Evidence | **Data** | `d` | network and constants with their source; journey, storm and dose distributions; forecast error on the edges actually travelled; per-journey outcomes and the modal-shift table | `←→` page |
| 11 | Evidence | **Robustness** | `o` | 20 independent seeds (box per variant, A3 win counts with sign tests), sensitivity of E and w_m, the moving-storm experiment (DP-now / DP-ahead / time-dependent check / oracle, motion-error sweep) and raincoat-alert POD / FAR / lead time. Computed in the background, about 5 s | `←→` page, `s` recompute |
| 12 | Evidence | **Q&A** | `w` | 20 questions a reviewer is likely to ask (need, why a sigmoid, why multiplicative, E validity, synthetic city, forecast error, β sensitivity, statistics, speed, deployment, benefits, limits, A4, reproducibility). Answers quote live numbers from the current run, sweep and bench | `↑↓`, `pgdn/pgup` |
| 13 | Evidence | **Bench** | `x` | median / p95 µs per routing call per variant | `b` re-run |

Changes made in the φ explorer or Params carry into the Cases screen and the next run.

**Suggested presentation flow:** Menu → Guide (`p` to autoplay) → Cases 2, 5 and 6 → Rain alert 1 and 3 → `r` to run →
Results → Trade-off → Robustness → Q&A. A minute-by-minute script with speaker notes is in
[`docs/PRESENTATION.md`](docs/PRESENTATION.md). Sources for every external claim are in
[`docs/REFERENCES.md`](docs/REFERENCES.md).

---

## Screenshots

_Screenshots to be added: Params, Live run, Results, Trade-off, φ explorer._

To capture them, run `./run.sh` in a window of about 120 × 34, press `enter` for the menu, `r` to start a run,
then open each screen by its menu letter, and take a window screenshot (macOS: `⇧⌘4`, then `space`). Save the images in
`docs/` and link them here.

---

## Model (`internal/model`)

* φ(r) = (σ(r) − σ(0)) / (1 − σ(0)), σ(r) = 1 / (1 + e^(−k(r − r0))), defaults r0 = 5 mm/h, k = 0.74
  (φ(1)=0.03, φ(5)=0.49, φ(7.5)=0.86, φ(10)=0.98, checked in unit tests).
* Edge cost c = τ · w_m · (1 + β · E · φ(r̂))
  * w_m = 1.0 for riding / in-vehicle, 1.5 for walking and waiting
  * E = 1 walk and motorcycle, 0.4 waiting at a BRT stop, 0.1 waiting in a rail station, 0 in-vehicle
* Variants
  * **A0**: time only (τ · w_m)
  * **A1**: hard threshold, cost × (1 + β) on exposed edges (E > 0) when r̂ ≥ r0
  * **A2**: linear, cost × (1 + α_m · max(0, r̂ − r0)), with α = 0.065 moto, 0.060 walk, 0.010 bus, 0.005 rail
  * **A3**: proposed DP
  * **A4**: A3 with waiting treated as enclosed (E = 0 for waits)
* Outcomes are always scored on the **true** rain field, with the same E for every variant:
  travel time T, rain dose D = (1/60) Σ τ · E · r_true, and exposed minutes (E > 0 and r_true ≥ r0).

## Moving storms and rain alerts (`internal/sim/ahead.go`)

* A storm field drifts with a motion vector (km/min), as a nowcast with motion would predict it.
* **DP-now** prices every edge on the rain at departure. **DP-ahead** prices each edge on the rain at
  the minute the traveller reaches it. Arrival times come from a time-only search, so routing stays
  a static Dijkstra. Both use the same DP cost.
* The chosen route is replayed in clock time against the moving storm to get the true dose.
* **Alerts**: each spell of rain ≥ 1 mm/h met on the route gives one notification, issued 15 min
  ahead. It names the last safe point to put on a raincoat (the stop before a walk, or a pull-over
  point for a motorcycle). Spells met only while sheltered (E = 0) are informational.
* The main experiment (Run / Results) uses static rain. The moving-storm *experiment*
  (`--ahead`, Robustness screen) runs 400 journeys with storms crossing at 10–60 min, a seeded error on
  the forecast storm velocity, and a **time-dependent check** (`ChooseTD`) that re-prices each edge at its
  exact arrival clock.

## Robustness (`internal/sim/robust.go`, `ahead_exp.go`)

Seed 2026, 400 journeys, default parameters:

| check | result |
|---|---|
| 20 independent seeds | A3 beats A1 in 20/20 seeds (sign test p ≈ 2e-6), A2 in 19/20. A4 beats A3 in 20/20 (≈ +1.5 pts) |
| sensitivity of E_brt_wait 0.2–1, E_rail_wait 0–0.5, w_walk_wait 1–2.5 | A3 > A1 and A2 at every point. A4 ≥ A3 at every point, even with fully exposed BRT waits |
| moving storms (motion error 0.1 km/min) | dose cut vs A0: DP-now 17.6 % [13.2, 22.0], **DP-ahead 31.1 % [26.2, 35.6]** for +5.5 % time, oracle 47.6 %. The time-dependent check agrees with DP-ahead on 91.8 % of journeys (+0.015 mm) |
| raincoat alerts (DP-ahead) | POD 0.86, FAR 0.07, mean lead 7.2 min |
| motion-error sweep | DP-ahead stays ahead of DP-now up to about 0.2 km/min (12 km/h) of velocity error |

**What it means for the paper:** price rain on walking and riding, *score* waits but do not *price*
them (that is A4, and the web app in `src/lib/routing/discomfort.ts` does this). Route on the rain you
will meet, not the rain now.

### Paper figures

```bash
./run.sh --export out              # 11 CSV files, about 10 s
python3 scripts/figures.py out     # fig_*.pdf and .png (needs only matplotlib)
```

Figures: cost curves (A1/A2/A3), dose reduction with CIs, β trade-off, seeds box plot, sensitivity
panels, moving storms + alert POD/FAR vs motion error. Every number comes from the CSVs.

## Simulation (`internal/sim`)

* 30 × 16 km city on a 1 km lattice, with separate walking (5 km/h) and motorcycle (22 km/h) layers.
  Each link has a fixed log-normal time factor (σ 0.15 roads, 0.10 walk), drawn from the seed.
* 11 BRT lines (5 horizontal, 6 vertical; 20 km/h; 8-min headway → 4-min wait, E = 0.4), stops every 1 km.
* 2 rail lines (one diagonal, one east–west; 40 km/h; 6-min wait including access, E = 0.1).
* Each journey has a random OD pair ≥ 8 km apart and 1–3 Gaussian rain cells (peak 10–40 mm/h,
  radius 1.5–4 km). Cell centres are drawn around the OD corridor so most journeys meet some rain.
* The forecast is the truth displaced by N(0, shift) km, averaged on 2 × 2 km blocks, then multiplied
  by lognormal(0, σ) per block. **The router sees only the forecast.**
* The traveller takes the cheaper of door-to-door motorcycle and walk + transit, priced by the variant
  on the forecast. Routing is Dijkstra on a CSR graph (~1.3k nodes, ~5.1k directed edges).
* Journeys run in parallel goroutines. Each journey's randomness is drawn up front from the seed and
  results are placed by index, so output is deterministic.

## Statistics (`internal/stats`)

* **Friedman** test on per-journey dose across A0–A4 (tie-corrected).
* **Wilcoxon signed-rank**, A3 vs each other variant (exact for n ≤ 25 without ties, otherwise the
  tie-corrected normal approximation), with **Holm** step-down correction.
* **Bootstrap** (2000 resamples, seeded) percentile 95 % CIs for the total dose reduction and the median
  per-journey reduction (over rain-exposed journeys).
* **Route-level precision / recall / F1**. A journey is *positive* when an oracle (A3 routed on the
  true rain) picks a different, drier route than A0. A variant *predicts positive* when its
  forecast-based route differs from A0's.

Unit tests cover φ, every cost variant, case routing and the search trace, Holm, Wilcoxon (hand-computed and brute-force enumeration),
Friedman, the chi-square tail, ranking with ties, simulation determinism, rendering of every screen
at 80×24 and 140×40, and every guide slide, case, symbol card, data page and Q&A answer at 80×24, 120×34
and 160×45.

---

## Building from source

Requires Go 1.23+ (the Charm libraries need it).

```bash
cd wmptrs-sim
go test ./...              # all unit tests
go run ./cmd/wmptrs-sim    # run without building binaries
./build.sh                 # tests + cross-compile into dist/ (with SHA256SUMS)
```

Dependencies: `bubbletea`, `lipgloss`, `bubbles`, `harmonica` (plus `termenv`, which lipgloss already uses).

```
cmd/wmptrs-sim/     entry point, flags, --no-tui JSON
internal/model/     phi, edge kinds, cost variants A0–A4
internal/sim/       network, rain + forecast, Dijkstra, parallel runner, summary, sweep, bench,
                    cases, moving storms + alerts, seeds, sensitivity
internal/stats/     Friedman, Wilcoxon, Holm, bootstrap, chi-square / normal tails
internal/ui/        Bubble Tea app, canvas renderer, screens, braille charts, EN/ID text
scripts/figures.py  paper figures from --export CSVs
docs/               REFERENCES.md (claims + sources), PRESENTATION.md (talk script)
```

## Troubleshooting

* **"Terminal too small"**: enlarge the window to at least 80 × 24.
* **Boxes or symbols look misaligned on Windows**: use Windows Terminal (not the old `conhost`
  console) with a font that has box-drawing and braille glyphs, such as Cascadia Mono or JetBrains
  Mono. Some fonts draw `φ`, `β`, `▲` or `●` as double width, which pushes a line one cell to the right.
  The layout assumes every glyph is one cell wide.
* **macOS says the file can't be opened**: run `./run.sh` from Terminal (it clears the quarantine flag),
  or right-click `run.command` → Open.
* **Startup takes ~5 s in an unusual terminal**: Bubble Tea v1 asks the terminal for its background
  colour at start-up and waits if the terminal never answers. Terminal.app, iTerm2, tmux and screen are unaffected.
