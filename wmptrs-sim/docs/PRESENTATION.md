# Presentation script (≈ 12 min + Q&A)

Window size about 120 × 34. Start with `./run.sh` (add `--lang id` for an Indonesian audience,
or press `L` at any time). Press `m` to return to the Menu from anywhere.

Before you start, **run once** (`r`, wait about 1 s) so the Results, Trade-off, Data and Q&A
screens have live numbers. Open Robustness (`o`) once so it computes in the background.

---

## 0:00 · Title (Intro → `enter`)

> "This is the Weather-Aware Multimodal Public Transportation Routing System. The question is
> simple. When it rains in Jakarta, can a router trade a few minutes for a lot less rain?"

## 0:30 · The problem (Guide `g`, slide 1)

> "Jakarta storms are short, intense and local. Many trips are open-air: motorcycles, walking to a
> halte. Routing apps rank by time only, so they will send you on a motorcycle through a storm when a
> train takes almost the same time."

*Point at:* the dry district next to the storm cell in the picture.

## 1:15 · The idea and the formula (slides 2–3)

> "We don't change the router. We change only how each road segment is priced:
> time × value-of-time weight × (1 + β · exposure · φ of the forecast rain)."

*Key sentence:* "Dry weather or β = 0 gives exactly today's route. It is safe by construction."
"Five variants: A0 is today's routers, A1 and A2 are the simple ideas a reviewer would suggest, A3 is
ours, and A4 is an ablation."

## 2:15 · The symbols (slides 4–9, press `→` quickly)

* τ, w_m: "Walking and waiting feel 1.5× longer. That comes from value-of-time meta-analyses."
* E: "How much rain reaches you. 1 on a motorcycle, 0 inside a train."
* r vs r_f: "We **route on the forecast** and **score on the truth**."
* φ: "A sigmoid, centred on the BMKG light/moderate boundary, 5 mm/h."
* Why a sigmoid (slide 8, let it animate): "A threshold flips with tiny forecast errors. A line
  explodes in a 40 mm/h cell. The sigmoid is smooth and bounded."
* β: "This is a user preference slider."

## 4:00 · Demo on the map (Cases `c`)

1. **Case 2** (storm → modal shift): "Same trip. A0 rides through the storm. A3 takes rail for a few extra minutes (read the exact numbers off the side panel)."
   Press `s`: "This is Dijkstra searching. Watch the front flow around the storm."
2. **Case 5** (threshold cliff): press `+` / `-` to nudge the rain across 5 mm/h. "A1's route flips.
   A3 barely moves."
3. **Case 6** (forecast in the wrong place): "The forecast is wrong, so the router is fooled. We
   always score on the truth, so this cost is in our results."

## 6:00 · Rain that hasn't arrived yet (Rain alert `n`)

1. **Scenario 1** (`1`, `space` to play): "Storms move. DP-now prices the rain at departure.
   DP-ahead prices the rain at the minute you get there."
   Wait for the banner: "Fifteen minutes ahead it says: rain ahead of you, pull over here and put on
   your raincoat. The triangle is the stop."
2. **Scenario 3** (`3`): "Sometimes rain can't be avoided. Then the system still helps by warning
   you in time."
3. **Scenario 4** (`4`): "And it stays quiet when you will be inside the train."

## 7:30 · The experiment (`r` → Results `e`)

> "400 journeys, 5 variants, the same storms and forecasts. A3 cuts the rain dose by about 43 % for a
> few % more time. Friedman and Holm-corrected Wilcoxon tests: p < 0.001 against A1 and A2."

Then **Trade-off** (`t`): "As β grows, A3 gives more rain reduction per minute than A1 or A2."

## 9:00 · Is it robust? (Robustness `o`)

* Page 1, seeds: "Twenty independent cities and storms. A3 beats the threshold in 20 of 20."
* Page 2, sensitivity: "We vary the assumed exposure and weights. The ranking never changes."
* Page 3, moving storms: "With moving storms, routing on the rain you will meet nearly doubles the
  benefit: 31 % vs 18 %."
* Page 4, alerts: "The raincoat alert catches 86 % of rain spells, with 7 % false alarms and about
  7 minutes of warning."

> **Say the A4 point yourself:** "Our ablation A4, which does not price waiting, is slightly better in
> every seed. So the final model prices walking and riding, and scores waiting without pricing it.
> The web app already uses this."

## 10:30 · Why apps should adopt it (Guide slide 15) and limits (slide 16)

> "One multiply per edge, the same Dijkstra, no new data. It is personal and explainable: '+6 min,
> 80 % less rain'." Then read the limits slide aloud: synthetic city, assumed E, simple storm motion.

## 11:30 · Close

> "Weather-aware routing is a small change to existing engines with a large, robust effect,
> and it tells you when to put on your raincoat."

---

## Q&A cheat sheet (open `w` and jump with `↑↓`)

| they ask | answer in one line | show |
|---|---|---|
| Why not a threshold? | It flips on forecast noise near r0 | Case 5, Q&A "sigmoid" |
| Are E values made up? | Assumptions, tested: the ranking holds across the whole grid | Robustness p.2 |
| Synthetic city? | It isolates the cost model and gives exact truth. OSM + radar is future work | Q&A, slide 16 |
| One seed only? | 20 seeds, 20/20 wins | Robustness p.1 |
| Forecast error? | Routed on the forecast, scored on the truth. The lead grows with error | Results with `high` preset |
| Moving rain? | DP-ahead + time-dependent check, 92 % agreement | Robustness p.3 |
| Is it slow? | Same Dijkstra, a few µs | Bench `x` |
| Sources? | `docs/REFERENCES.md` | — |
| Why A4 better? | Pricing short waits deters sheltered transit; waits carry little dose | Q&A "A4" |
