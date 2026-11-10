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

Explicit flags override the preset. 400 journeys × 5 variants take about 0.3 s
on a laptop.

---

## Screens and keys

`tab` / `shift+tab` move between screens with a spring slide. `r` runs with the
current parameters, `?` shows help and `q` quits.

| # | screen | what it shows | keys |
|---|---|---|---|
| 1 | **Intro** | animated logo; letters spring in while rain falls through them | `enter` |
| 2 | **Params** | sliders for β, r0, k, σ, shift, journeys, seed; 4 presets | `↑↓` select, `←→` adjust (`shift` ×5), `1-4` preset, `e` or a digit to type a value, `enter` run |
| 3 | **Run** | live progress as journeys stream in; city map with pulsing rain cells; the A3 route draws itself over the dim A0 route (magenta moto, green walk, cyan BRT, gold rail) | `←→` browse journeys, `f` truth/forecast field, `v` compare A1/A2/A3/A4 |
| 4 | **Results** | spring-animated bars of total rain-dose reduction vs A0 with bootstrap 95 % CIs; Friedman test; Holm-adjusted Wilcoxon (A3 vs each); outcome table (Δtime, dose, exposed minutes, moto share, reroute share, P/R/F1) | `a` replay animation |
| 5 | **Trade-off** | braille chart of dose reduction vs time increase for β ∈ {0, .25, .5, 1, 2, 4, 8}: A3 family, A1 family (β varied), A2 family (α scaled by the same factors) | `←→` select β, `s` re-sweep |
| 6 | **φ explorer** | cost multiplier 1 + βEφ(r) per exposure class; curves morph smoothly as you move r0 / k / β; optional A1 step and A2 line overlays | `←→` r0, `↑↓` k, `+/-` β, `[ ]` cursor, `c` overlays |
| 7 | **Bench** | median / p95 µs per routing call per variant, with sparklines over call batches | `b` re-run |

Changes made in the φ explorer update the parameters used for the next run.

---

## Screenshots

_Screenshots to be added: Params, Live run, Results, Trade-off, φ explorer._

To capture them, run `./run.sh` in a window of about 120 × 34, press `enter` twice to start a run,
`tab` to each screen, and take a window screenshot (macOS: `⇧⌘4`, then `space`). Save the images in
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

Unit tests cover φ, every cost variant, Holm, Wilcoxon (hand-computed and brute-force enumeration),
Friedman, the chi-square tail, ranking with ties, simulation determinism, and rendering of every screen
at 80×24 and 140×40.

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
internal/sim/       network, rain + forecast, Dijkstra, parallel runner, summary, sweep, bench
internal/stats/     Friedman, Wilcoxon, Holm, bootstrap, chi-square / normal tails
internal/ui/        Bubble Tea app, canvas renderer, screens, braille charts
```

## Troubleshooting

* **"Terminal too small"**: enlarge the window to at least 80 × 24.
* **macOS says the file can't be opened**: run `./run.sh` from Terminal (it clears the quarantine flag),
  or right-click `run.command` → Open.
* **Startup takes ~5 s in an unusual terminal**: Bubble Tea v1 asks the terminal for its background
  colour at start-up and waits if the terminal never answers. Terminal.app, iTerm2, tmux and screen are unaffected.
