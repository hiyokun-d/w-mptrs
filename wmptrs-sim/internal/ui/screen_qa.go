package ui

import (
	"fmt"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"

	"wmptrs-sim/internal/model"
)

type qaItem struct {
	topic string
	q     string
	a     func(a *App) string
}

// live returns s(a) when a run exists, else a placeholder.
func live(a *App, s func() string) string {
	if a.result == nil {
		return "⟦Run the experiment (r) and this answer will quote your live numbers.⟧"
	}
	return s()
}

func v3(a *App) (model.Variant, float64, float64) {
	v := a.result.Summary.Variants[model.A3]
	return model.A3, v.DoseRedPct, v.TimeIncPct
}

var qaItems = []qaItem{
	{"need", "Why is weather-aware routing needed at all?", func(a *App) string {
		return "Because the best route «depends on the weather», and today's routers ignore it.\n\n" +
			"In a city with intense, very local tropical storms and many trips on «open» modes (motorcycle, ojek, walking to a halte), the fastest route on a dry day can be the wettest route in a storm. " +
			"Often a sheltered alternative (rail, BRT) costs only a few minutes more.\n\n" +
			"A time-only router cannot see that trade-off. The traveller has to guess, usually without knowing where the rain is. " +
			"DP makes the trade-off «explicit» and «automatic»."
	}},
	{"need", "Why not just tell users \"it's raining, take the train\"?", func(a *App) string {
		return "Because rain is «local» and trips are «long». A city-wide rule is wrong for most trips:\n\n" +
			"• The storm may cover only part of the route (Case 3: a detour on the same motorcycle is enough).\n" +
			"• The sheltered option may be much slower for this OD pair (Case 7: no change needed).\n" +
			"• Light rain over a long ride still adds up (Case 4).\n\n" +
			"Only a router that prices «each edge» can weigh these per trip. DP does it inside the router, at no extra algorithmic cost."
	}},
	{"why", "Why a sigmoid instead of a simple threshold (A1)?", func(a *App) string {
		base := "A threshold makes the decision «discontinuous» at r0. Forecasts carry roughly ±30 % error, so near r0 the route flips back and forth with forecast noise (Case 5 shows a 0.2 mm/h change flipping A1).\n\n" +
			"The sigmoid is «smooth». Small forecast errors give small cost changes. It is also «graded»: drizzle counts a little, not zero.\n\n"
		return base + "The advantage should «grow» as forecasts get worse. Compare the Paper-default and High-error presets.\n\n" + live(a, func() string {
			s := a.result.Summary
			return fmt.Sprintf("In your run: A3 cuts dose ‹%.1f%%› vs A1 ‹%.1f%%›. Route precision/recall A3 ‹%.2f/%.2f› vs A1 ‹%.2f/%.2f›. Holm-adjusted Wilcoxon A3 vs A1: p = ‹%s›.",
				s.Variants[3].DoseRedPct, s.Variants[1].DoseRedPct, s.Variants[3].Precision, s.Variants[3].Recall,
				s.Variants[1].Precision, s.Variants[1].Recall, fmtP(s.Wilcoxon[1].PHolm))
		})
	}},
	{"why", "Why not a linear penalty (A2)?", func(a *App) string {
		return "A linear penalty is «unbounded» and still has a «kink» at r0.\n\n" +
			"• Unbounded: one 40 mm/h forecast tile multiplies a moto edge by more than 3×, so a single bad forecast cell can dominate a whole trip.\n" +
			"• Kink: everything below r0 counts as zero, so it shares A1's blindness to light rain.\n\n" +
			"Physically, discomfort «saturates». Once you are soaked, more rain adds little, and the sigmoid's plateau encodes that.\n\n" +
			live(a, func() string {
				s := a.result.Summary
				v2, v3 := s.Variants[2], s.Variants[3]
				eff := func(v float64, t float64) float64 { return v / max(t, 0.1) }
				return fmt.Sprintf("Your run: A2 dose cut ‹%.1f%%› for ‹+%.1f%%› time (%.1f%% rain saved per 1%% time); A3 ‹%.1f%%› for ‹+%.1f%%› (%.1f). Precision A2 ‹%.2f›, A3 ‹%.2f›.\n\n",
					v2.DoseRedPct, v2.TimeIncPct, eff(v2.DoseRedPct, v2.TimeIncPct), v3.DoseRedPct, v3.TimeIncPct, eff(v3.DoseRedPct, v3.TimeIncPct), v2.Precision, v3.Precision) +
					"⟦Judge on the trade-off, not dose alone.⟧ With a «perfect» forecast A2 can match or slightly beat A3 on raw dose, but it pays more time and makes more needless reroutes. A3's advantage is efficiency and robustness."
			})
	}},
	{"why", "Why multiply the time instead of adding a fixed rain cost?", func(a *App) string {
		return "Because rain exposure «accumulates with time». Ten minutes walking in a storm is worse than one minute. A multiplier on τ makes the penalty proportional to the time exposed, the same structure as the rain dose D = Σ τ·E·r.\n\n" +
			"A fixed additive cost per edge would depend on how the map is cut into edges, not on physics. Splitting one road into two edges would double the penalty."
	}},
	{"why", "Why normalise φ so that φ(0) = 0?", func(a *App) string {
		return "The raw logistic curve gives σ(0) ≈ 0.024 at r0 = 5, k = 0.74. Without normalisation every dry exposed edge would get a small penalty, so DP would «change routes on a perfectly dry day».\n\n" +
			"With φ(r) = (σ(r) − σ(0)) / (1 − σ(0)), dry edges cost exactly τ·w_m (Case 1), and the maximum stays 1."
	}},
	{"data", "Where do the E values come from? Are they valid?", func(a *App) string {
		return "⟦They are modelling assumptions⟧, chosen to rank shelter plausibly: open sky 1, roofed open halte 0.4, enclosed station 0.1, in-vehicle 0.\n\n" +
			"We guard against this in three ways:\n" +
			"1. Outcomes are scored with the «same» E for every variant, so no variant benefits from its own assumption.\n" +
			"2. ‹A4› removes waiting exposure entirely, an ablation of the E model.\n" +
			"3. ‹β› scales the whole term, and the Trade-off sweep shows results across 32× of penalty strength.\n\n" +
			"Calibrating E with a stated-preference survey of commuters is the natural next step."
	}},
	{"data", "Why a synthetic city instead of real Jakarta data?", func(a *App) string {
		return "To evaluate the «cost model» we need the «true» rain on every edge at the time of travel. Real data does not provide that: radar is coarse, gauges are sparse, and we cannot observe how wet each traveller got.\n\n" +
			"A synthetic city gives exact ground truth, full control (we can switch forecast error on and off), and «reproducibility» from one seed.\n\n" +
			"The modes, speeds and rain intensities are chosen to resemble Jakarta (motorcycles, open BRT haltes, MRT-like rail, convective storms). Running on an OSM extract with radar nowcasts is the deployment step, using the same cost function."
	}},
	{"robust", "Rain moves. What about rain that hasn't arrived yet?", func(a *App) string {
		return "The base experiment treats each storm as fixed during the trip, a stated simplification. The «Rain alert» screen extends it to «moving storms»:\n\n" +
			"• ‹DP-ahead› evaluates φ on the rain forecast «for the minute the traveller reaches each edge». Arrival times come from a time-only search, so routing stays a static Dijkstra.\n" +
			"• A naive ‹DP-now› that prices the current snapshot can be «worse than nothing». In scenario 2 it detours into the storm's path.\n" +
			"• When rain cannot be avoided, a ‹raincoat alert› fires ‹15 min› ahead and names a safe point to prepare. It is suppressed while the traveller is sheltered (E = 0).\n\n" +
			"So the system does not just pick the driest route. It also «prepares the traveller» for the rain that is left. ⟦Motion is assumed exact in these demos.⟧ Motion error would be the next thing to test."
	}},
	{"robust", "What if the forecast is wrong?", func(a *App) string {
		return "Then DP avoids the wrong place. The experiment measures that directly:\n\n" +
			"• Routes are chosen on the «forecast» and scored on the «truth».\n" +
			"• σ (intensity error) and shift (position error) are parameters. Compare the «Perfect forecast» and «High error» presets.\n" +
			"• The «oracle» (A3 on the true rain) gives an upper bound. Precision and recall show how many reroutes were justified.\n\n" +
			"Case 6 shows a storm misplaced by 5 km. A3 still roughly halves the dose but misses the oracle's result. Being smooth, DP degrades «gracefully» rather than flipping." +
			"\n\n" + live(a, func() string {
			v := a.result.Summary.Variants[model.A3]
			return fmt.Sprintf("Your run (σ %.2f, shift %.2f km): A3 precision ‹%.2f›, recall ‹%.2f›, F1 ‹%.2f›.", a.result.Params.Sigma, a.result.Params.Shift, v.Precision, v.Recall, v.F1)
		})
	}},
	{"robust", "Isn't the dose reduction just from making trips longer?", func(a *App) string {
		return "No. Longer trips would mean «more» time outside, not less. The reduction comes from «where» time is spent: sheltered modes and drier streets.\n\n" +
			live(a, func() string {
				_, dr, ti := v3(a)
				return fmt.Sprintf("In your run A3 cuts total dose by ‹%.1f%%› while total travel time rises by only ‹%.1f%%›. ", dr, ti) +
					"In several cases (2, 4) the A3 route is even «faster» in clock time, because A0 minimises generalised time (walking ×1.5), not clock time."
			})
	}},
	{"robust", "How sensitive are the results to β?", func(a *App) string {
		base := "β is swept over {0, 0.25, 0.5, 1, 2, 4, 8} on the same journeys (Trade-off screen). At β = 0 A3 equals A0 exactly, which the test suite checks.\n\n"
		if a.sweep == nil {
			return base + "⟦Open the Trade-off screen once to compute the sweep. This answer will then quote it.⟧"
		}
		s := base + "From your sweep (A3):\n"
		for _, p := range a.sweep {
			if p.Family == "A3" {
				s += fmt.Sprintf("• β ‹%g›: dose −%.1f%%, time +%.1f%%, moto share %.0f%%\n", p.Beta, p.DoseRedPct, p.TimeIncPct, 100*p.MotoShare)
			}
		}
		return s + "\nThe curve shows «diminishing returns». Most of the benefit arrives by β ≈ 1–2."
	}},
	{"stats", "Why Friedman + Wilcoxon + Holm, not t-tests / ANOVA?", func(a *App) string {
		return "Rain dose is «skewed» with many zeros (dry journeys), so normality fails. Every journey is routed under all five variants, so the samples are «paired».\n\n" +
			"• ‹Friedman› is the non-parametric repeated-measures ANOVA: do any variants differ?\n" +
			"• ‹Wilcoxon signed-rank› is the paired non-parametric comparison, A3 vs each other variant.\n" +
			"• ‹Holm› controls the family-wise error over the 4 comparisons and is always at least as powerful as Bonferroni.\n\n" +
			live(a, func() string {
				f := a.result.Summary.Friedman
				return fmt.Sprintf("Your run: Friedman χ² = ‹%.1f›, df %d, p = ‹%s›.", f.Chi2, f.DF, fmtP(f.P))
			})
	}},
	{"stats", "Why bootstrap confidence intervals?", func(a *App) string {
		return "The headline number, total dose reduction %, is a «ratio of sums». It has no simple closed-form standard error. The bootstrap resamples journeys (2000×, seeded) and reads off the 2.5 / 97.5 percentiles.\n\n" +
			"We also report the «median per-journey» reduction on exposed journeys, so a few very wet trips cannot drive the result.\n\n" +
			live(a, func() string {
				v := a.result.Summary.Variants[model.A3]
				return fmt.Sprintf("Your run: A3 total −‹%.1f%%› [%.1f, %.1f]; median per journey −‹%.1f%%› [%.1f, %.1f].",
					v.DoseRedPct, v.DoseRedCI[0], v.DoseRedCI[1], v.MedianRedPct, v.MedianRedCI[0], v.MedianRedCI[1])
			})
	}},
	{"deploy", "Is it fast enough for a production app?", func(a *App) string {
		base := "Yes. DP changes only the «edge weight». It is one multiply per edge, with φ evaluated once per forecast tile value. Dijkstra's complexity is unchanged, and it works with A*, contraction-hierarchy customisation or any engine that accepts per-request weights.\n\n"
		if a.bench == nil {
			return base + "⟦Open the Bench screen to measure it on this machine.⟧"
		}
		var t0, t3 float64
		for _, v := range a.bench.Variants {
			switch v.Name {
			case "A0":
				t0 = v.MedianUs
			case "A3":
				t3 = v.MedianUs
			}
		}
		return base + fmt.Sprintf("Measured here: A0 median ‹%.0f µs›, A3 ‹%.0f µs› per call (pricing all %d edges + two searches).", t0, t3, a.bench.Edges)
	}},
	{"deploy", "How would a real app implement it?", func(a *App) string {
		return "1. Fetch a «nowcast» grid (e.g. BMKG, or OpenWeatherMap as fallback) and cache it for about a minute.\n" +
			"2. For each road or transit segment, look up the tile → ‹r_f›.\n" +
			"3. Apply ‹c = τ·w_m·(1 + β·E·φ(r_f))› in the router's weight function (e.g. a GraphHopper custom model or a custom OSRM/Valhalla cost).\n" +
			"4. Read ‹β› from the user's profile, with \"avoid rain\" as a slider.\n" +
			"5. Explain the choice: «\"+6 min, 80 % less rain\"».\n\n" +
			"With no rain or β = 0, step 3 is the identity, so it can ship «switched on» with zero risk to dry-weather routing."
	}},
	{"deploy", "Why should apps adopt this — what's the benefit?", func(a *App) string {
		return "• «Comfort and health»: less time soaked and cold, a real concern for motorcycle and walking commuters.\n" +
			"• «Safety»: fewer motorcycle-kilometres in heavy rain, when visibility and road grip are worst.\n" +
			"• «Transit ridership»: shifting rain trips toward sheltered rail and BRT, with apps doing the persuading.\n" +
			"• «Trust»: an app that knows about the storm is more useful than one that doesn't.\n\n" +
			live(a, func() string {
				s := a.result.Summary
				return fmt.Sprintf("In your run A3 lowers moto share from ‹%.0f%%› to ‹%.0f%%› and exposed minutes from ‹%.1f› to ‹%.1f› per trip.",
					100*s.Variants[0].MotoShare, 100*s.Variants[3].MotoShare, s.Variants[0].MeanExposed, s.Variants[3].MeanExposed)
			})
	}},
	{"limits", "Doesn't shifting everyone to transit overload it?", func(a *App) string {
		return "⟦Capacity is not modelled⟧, a stated limitation. Two mitigations: β differs per user, so not everyone shifts. Crowding can be added as another multiplicative term on in-vehicle and wait edges, in exactly the same framework. That is future work."
	}},
	{"limits", "A4 does as well as A3 or better. Why not just use A4?", func(a *App) string {
		return "A4 is an «ablation», not a competitor. It removes «waiting exposure» (E = 0 for waits) to ask whether that part of the model earns its place.\n\n" +
			live(a, func() string {
				s := a.result.Summary
				return fmt.Sprintf("Your run: A3 −%.1f%% dose vs A4 −%.1f%%; Wilcoxon A3 vs A4 p(Holm) = ‹%s›.\n\n",
					s.Variants[3].DoseRedPct, s.Variants[4].DoseRedPct, fmtP(s.Wilcoxon[3].PHolm))
			}) +
			"⟦Honest reading:⟧ in this simulator A4 is usually «equal or slightly better» on dose. Penalising waits makes A3 a little more reluctant to board BRT, and waits are short (4–6 min), so they contribute little dose.\n\n" +
			"It is not a one-seed accident. Over ‹20 seeds› A4 beats A3 in ‹20 of 20› (about +1.5 points, sign test p ≈ 2e-6), and in the sensitivity grid A4 ≥ A3 at «every» setting, even when BRT waits are fully exposed (E = 1). Press ‹o› (Robustness) to see both.\n\n" +
			"«How we frame it in the paper:» the proposed model is the exposure-weighted sigmoid on «walking and riding»; waits are «scored» (they are real exposure) but «not priced» in routing. That is A4, and the web app already uses it. Say this before the reviewer does. It shows the ablation is genuine."
	}},
	{"repro", "Can I reproduce these numbers?", func(a *App) string {
		return fmt.Sprintf("Yes. All randomness comes from one seed (now ‹%d›). Journeys are evaluated in parallel but stored by index, so output is deterministic. Headless:\n\n", a.params.Seed) +
			"«./run.sh --no-tui --sweep --seed 2026»\n\n" +
			"prints the full JSON summary. ⟦These are simulator results, not the paper's original run⟧, so they vary with the seed. Try a few seeds to show the conclusion is stable."
	}},
}

type qaScreen struct {
	sel, top int
	text     scrollText
	k        struct{ nav, scroll key.Binding }
}

func newQA() *qaScreen {
	s := &qaScreen{}
	s.k.nav = key.NewBinding(key.WithKeys("up", "down"), key.WithHelp("↑↓", "question"))
	s.k.scroll = key.NewBinding(key.WithKeys("pgdown", "pgup"), key.WithHelp("pgdn/up", "scroll"))
	return s
}

func (s *qaScreen) title() string       { return "Q&A" }
func (s *qaScreen) captures() bool      { return false }
func (s *qaScreen) keys() []key.Binding { return []key.Binding{s.k.nav, s.k.scroll} }
func (s *qaScreen) enter(a *App) tea.Cmd {
	return nil
}

func (s *qaScreen) update(a *App, msg tea.KeyMsg) tea.Cmd {
	ks := msg.String()
	if s.text.key(ks) {
		return nil
	}
	switch ks {
	case "up", "k":
		s.sel = (s.sel + len(qaItems) - 1) % len(qaItems)
		s.text.off = 0
	case "down", "j":
		s.sel = (s.sel + 1) % len(qaItems)
		s.text.off = 0
	}
	return nil
}

func (s *qaScreen) tick(a *App, steps int) bool { return false }

var topicColor = map[string]uint8{"need": cRain, "why": cGold, "data": cGreen, "robust": cAmber, "stats": cMagenta, "deploy": cWhite, "limits": cRed, "repro": cDim}

func (s *qaScreen) draw(a *App, c *Canvas, w, h int) {
	lw := max(30, w*2/5)
	done := c.Box(0, 0, lw, h, cBorderHi, "Questions a reviewer may ask")
	iw, ih := lw-4, h-2
	if s.sel < s.top {
		s.top = s.sel
	}
	if s.sel >= s.top+ih {
		s.top = s.sel - ih + 1
	}
	for i := s.top; i < len(qaItems) && i-s.top < ih; i++ {
		y := i - s.top
		it := qaItems[i]
		col := cDim
		if i == s.sel {
			col = cWhite
			if !a.th.mono {
				for x := -1; x < iw+1; x++ {
					c.SetBG(x, y, cR1)
				}
			}
			c.Put(-1, y, '▌', cRain)
		}
		c.Text(0, y, fmt.Sprintf("%-6s", it.topic), topicColor[it.topic])
		c.Text(7, y, trunc(it.q, iw-7), col)
	}
	done()
	it := qaItems[s.sel]
	done = c.Box(lw, 0, w-lw, h, cBorder, fmt.Sprintf("Q%d · %s", s.sel+1, it.topic))
	aw := w - lw - 4
	n := rich(c, 0, 0, aw, 3, "‹"+it.q+"›", cText)
	r := c.Sub(0, n+1, aw, h-2-n-1)
	s.text.draw(c, aw, h-2-n-1, it.a(a))
	r()
	done()
}
