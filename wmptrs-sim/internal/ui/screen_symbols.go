package ui

import (
	"fmt"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"

	"wmptrs-sim/internal/model"
)

// symbolCard is a reference entry for one variable of the model.
type symbolCard struct {
	sym, name string
	unit      string
	value     func(a *App) string // current / default value
	formula   string              // rich, the symbol highlighted with ‹›
	meaning   string
	why       string
	up, down  string
	vis       func(g *guideScreen, a *App, c *Canvas, w, h int, t float64)
}

const mainFormula = "c = τ · w_m · (1 + β · E · φ(r_f))"

func hl(sym string) string {
	// highlight one symbol inside the main formula
	switch sym {
	case "c":
		return "‹c› = τ · w_m · (1 + β · E · φ(r_f))"
	case "τ":
		return "c = ‹τ› · w_m · (1 + β · E · φ(r_f))"
	case "w_m":
		return "c = τ · ‹w_m› · (1 + β · E · φ(r_f))"
	case "β":
		return "c = τ · w_m · (1 + ‹β› · E · φ(r_f))"
	case "E":
		return "c = τ · w_m · (1 + β · ‹E› · φ(r_f))"
	case "φ":
		return "c = τ · w_m · (1 + β · E · ‹φ›(r_f))"
	case "r_f":
		return "c = τ · w_m · (1 + β · E · φ(‹r_f›))"
	}
	return mainFormula
}

func fv(format string, f func(a *App) float64) func(a *App) string {
	return func(a *App) string { return fmt.Sprintf(format, f(a)) }
}

func constv(s string) func(*App) string { return func(*App) string { return s } }

var symbolCards = []symbolCard{
	{"c", "generalised edge cost", "minutes (perceived)", constv("computed per edge"), hl("c"),
		"The number Dijkstra adds up along a path and minimises. It is «time as the traveller feels it», including rain discomfort.",
		"A shortest-path algorithm can only optimise «one» number. Putting rain «inside» that number lets us reuse a standard, proven, fast router instead of inventing a new one.",
		"Edges in heavy rain become «expensive», so the router looks for drier alternatives.",
		"With no rain, c falls back to plain weighted time.", visFormula},
	{"τ", "tau, edge travel time", "minutes", constv("walk 12 min/km · moto 2.7 · BRT 3 · rail 1.5"), hl("τ"),
		"How long it takes to traverse one edge: walk 1 km, ride 1 km, or wait for a vehicle. Each street link gets a fixed random factor from the seed, so the city is not perfectly regular.",
		"The penalty «multiplies» τ, so a long exposure costs more than a short one. That matches how rain dose accumulates: more minutes outside means more rain.",
		"(physical) slower edges also carry more rain penalty in absolute terms.",
		"short edges are barely affected even in heavy rain.", visWeights},
	{"w_m", "mode weight (value of time)", "×", constv("1.5 walk/wait · 1.0 ride"), hl("w_m"),
		"How unpleasant one minute in mode m is compared with sitting in a vehicle. Walking and waiting count ‹1.5×›.",
		"Transport practice weights out-of-vehicle time higher. Without it the time-only baseline A0 would be unrealistic, and the comparison would be unfair to A0.",
		"routes avoid walking and waiting more, even when dry.",
		"walking becomes as attractive as riding.", visWeights},
	{"β", "beta, discomfort weight", "dimensionless", fv("%.2f", func(a *App) float64 { return a.params.Beta }), hl("β"),
		"How much the traveller minds rain. It scales the whole rain term.",
		"People differ, and so do situations (suit vs raincoat). β turns one model into a «preference slider», and β = 0 recovers today's router exactly, which makes adoption safe.",
		"bigger detours accepted for less rain (rain-averse). The Trade-off screen shows diminishing returns.",
		"routes approach time-only. At β = 0, A3 ≡ A0.", visBeta},
	{"E", "exposure coefficient", "0 … 1", constv("walk/moto 1 · BRT wait 0.4 · rail wait 0.1 · ride 0"), hl("E"),
		"Fraction of the rain that reaches the traveller on this edge type.",
		"Rain only matters where you are «outside». Without E, the router would avoid rain even when you are dry inside a train, and would penalise the safest options.",
		"(for a mode) that mode is avoided sooner in rain.",
		"that mode is treated as sheltered. A4 sets waits to E = 0 to test this, and wins: price walking and riding, not waits.", visExposure},
	{"r", "true rain intensity", "mm/h", constv("Gaussian storm cells, 10–40 mm/h peak"), "D = Σ τ · E · ‹r› / 60",
		"The rain that really falls at each edge. The router never sees it. It is used only to «score» outcomes.",
		"Evaluating on the truth while routing on the forecast is what makes the experiment honest. It measures what the traveller would actually experience.",
		"more rain dose for every variant; bigger absolute savings available.",
		"fewer journeys have anything to avoid.", visRain},
	{"r_f", "forecast rain intensity", "mm/h", constv("truth, shifted, block-averaged, noisy"), hl("r_f"),
		"What the router «believes» the rain is on an edge: a 2×2 km nowcast tile value.",
		"Real apps only have forecasts. Modelling forecast error shows the method still works when the forecast is wrong.",
		"(over-forecast) unnecessary detours: false positives.",
		"(under-forecast) missed chances to stay dry: false negatives.", visRain},
	{"φ", "phi, discomfort response", "0 … 1", fv("φ(7.5) = %.2f", func(a *App) float64 { return phiAt(a, 7.5) }), hl("φ"),
		"Converts mm/h into a discomfort level. 0 when dry, about ½ at r0, approaching 1 in very heavy rain.",
		"Rain does not hurt «linearly». Drizzle is a nuisance, heavy rain soaks you, and beyond that more rain hardly matters. A normalised sigmoid captures all three regions, with «φ(0) = 0» exactly.",
		"(via r0 / k) see those cards.",
		"", visPhi},
	{"σ(r)", "logistic sigmoid", "0 … 1", constv("1 / (1 + e^(−k(r − r0)))"), "φ(r) = (‹σ(r)› − σ(0)) / (1 − σ(0))",
		"The standard S-curve that φ is built from.",
		"It is smooth (small forecast errors give small cost changes), bounded, and has two interpretable parameters. The normalisation removes the small σ(0) > 0 offset so dry edges stay unpenalised.",
		"", "", visCompare},
	{"r0", "sigmoid midpoint", "mm/h", fv("%.1f mm/h", func(a *App) float64 { return a.params.R0 }), "σ(r) = 1 / (1 + e^(−k(r − ‹r0›)))",
		"The intensity where discomfort is half way. Default ‹5 mm/h›, the BMKG boundary between light and moderate rain. Also the A1 threshold, the A2 onset and the cut-off for «exposed minutes».",
		"It anchors the curve to an «official» meteorological category instead of an arbitrary number, so it is easy to defend and to localise for another country.",
		"only stronger rain triggers rerouting.",
		"even light rain is avoided.", visPhi},
	{"k", "sigmoid steepness", "per mm/h", fv("%.2f", func(a *App) float64 { return a.params.K }), "σ(r) = 1 / (1 + e^(−‹k›(r − r0)))",
		"How quickly discomfort rises around r0.",
		"It sets how «threshold-like» the model is. A very large k turns A3 into A1. With the default 0.74, φ rises from 10 % to 90 % between about 2 and 8 mm/h.",
		"behaves like a hard threshold and becomes sensitive to forecast error.",
		"very gradual; even 1–2 mm/h gets a noticeable penalty.", visPhi},
	{"σ_f", "forecast intensity error", "log-SD", fv("%.2f", func(a *App) float64 { return a.params.Sigma }), "r_f = block(r shifted) · e^(‹σ_f›·N(0,1))",
		"Multiplicative log-normal noise per 2×2 km forecast tile. 0.3 is about ±30 %.",
		"Forecasts get the «amount» of rain wrong. This tests how robust each cost function is to that.",
		"noisier forecast, so precision drops and smooth A3 degrades more gracefully than threshold A1.",
		"0 means intensities are exact (Perfect-forecast preset).", visRain},
	{"shift", "forecast displacement", "km (SD)", fv("%.2f km", func(a *App) float64 { return a.params.Shift }), "r_f(x) = r(x − ‹shift›)",
		"The whole forecast field is moved by a random offset with this standard deviation.",
		"Nowcasts often get storm «position» wrong by a few km. This is the harder error, because the router avoids the wrong place (Case 6).",
		"more misplaced storms; reductions shrink toward zero.",
		"storms are where the forecast says.", visRain},
	{"α_m", "A2 linear coefficients", "per mm/h", constv("moto .065 · walk .060 · bus .010 · rail .005"), "A2: c = τ·w·(1 + ‹α_m›·(r_f − r0)⁺)",
		"Slopes of the linear baseline A2, per mode.",
		"A2 is the natural «simpler alternative» a reviewer would propose. Including it shows the sigmoid's advantage is not just from having «any» penalty.",
		"(Trade-off sweep scales α) A2 becomes more rain-averse.",
		"", visCompare},
	{"D", "rain dose", "mm", constv("primary outcome"), "‹D› = Σ τ · E · r_true / 60",
		"Total rain the traveller receives over the trip: minutes × exposure × true intensity.",
		"It is the physical quantity behind «getting wet», comparable across modes and journeys. We report % reduction vs A0 on the same journeys.",
		"", "", visMeasure},
	{"exp.min", "exposed minutes", "min", constv("E > 0 and r_true ≥ r0"), "exposed = Σ τ  over edges with E > 0, r ≥ r0",
		"Time spent outside while the rain is at least moderate.",
		"Easy to communicate («8 fewer minutes in heavy rain») and robust to how intense the rain is.",
		"", "", visMeasure},
	{"T", "travel time", "min", constv("secondary outcome (the cost)"), "time increase = T_variant / T_A0 − 1",
		"Clock minutes of the chosen route.",
		"It is the price paid for staying dry. A good method gives a large dose cut for a small time increase.",
		"", "", visMeasure},
	{"P/R/F1", "route-decision quality", "0 … 1", constv("oracle = A3 on true rain"), "precision = TP/(TP+FP), recall = TP/(TP+FN)",
		"Treats each reroute as a prediction that «a drier route exists», checked against an oracle that knows the true rain.",
		"Separates two failure modes: «useless detours» (low precision) and «missed chances» (low recall). This is how forecast error affects decisions.",
		"", "", visMeasure},
	{"A0–A4", "cost-function variants", "", constv("A3 is proposed"), "A0 time · A1 step · A2 linear · ‹A3 DP› · A4 DP no-wait",
		"The five ways each journey is routed.",
		"A0 is the control, A1 and A2 are simpler baselines, and A4 is an ablation. Together they show A3's gain comes from its «shape» and its «exposure model».",
		"", "", visVariants},
	{"N", "number of journeys", "", fv("%.0f", func(a *App) float64 { return float64(a.params.Journeys) }), "",
		"Random origin–destination pairs (≥ 8 km apart) per run.",
		"More journeys give tighter confidence intervals. 400 already gives stable results, and runs finish in under a second.",
		"narrower CIs, smaller p-values.", "noisier estimates.", visCity},
	{"seed", "random seed", "", fv("%.0f", func(a *App) float64 { return float64(a.params.Seed) }), "",
		"Drives every random draw: link times, journeys, storms, forecast errors.",
		"Reproducibility: the same seed and parameters give identical numbers. Change it to show the result is not a lucky draw.",
		"", "", visCity},
}

func phiAt(a *App, r float64) float64 { return model.Phi(r, a.params.Model()) }

type symbolsScreen struct {
	sel  int
	top  int
	g    *guideScreen
	text scrollText
	t0   float64
	k    struct{ nav, scroll key.Binding }
}

func newSymbols() *symbolsScreen {
	s := &symbolsScreen{g: newGuide()}
	s.k.nav = key.NewBinding(key.WithKeys("up", "down"), key.WithHelp("↑↓", "symbol"))
	s.k.scroll = key.NewBinding(key.WithKeys("pgdown", "pgup"), key.WithHelp("pgdn/up", "scroll"))
	return s
}

func (s *symbolsScreen) title() string       { return "Symbols" }
func (s *symbolsScreen) captures() bool      { return false }
func (s *symbolsScreen) keys() []key.Binding { return []key.Binding{s.k.nav, s.k.scroll} }
func (s *symbolsScreen) enter(a *App) tea.Cmd {
	s.g.enter(a)
	s.t0 = a.t
	return nil
}

func (s *symbolsScreen) update(a *App, msg tea.KeyMsg) tea.Cmd {
	ks := msg.String()
	if s.text.key(ks) {
		return nil
	}
	switch ks {
	case "up", "k":
		s.sel = (s.sel + len(symbolCards) - 1) % len(symbolCards)
	case "down", "j":
		s.sel = (s.sel + 1) % len(symbolCards)
	default:
		return nil
	}
	s.text.off, s.t0 = 0, a.t
	return nil
}

func (s *symbolsScreen) tick(a *App, steps int) bool {
	if s.g.caseNet == nil {
		s.g.enter(a)
	}
	return true
}

func (s *symbolsScreen) draw(a *App, c *Canvas, w, h int) {
	if s.g.caseNet == nil {
		s.g.enter(a)
	}
	lw := 24
	if w >= 110 {
		lw = 34
	}
	done := c.Box(0, 0, lw, h, cBorderHi, "Symbols")
	ih := h - 2
	if s.sel < s.top {
		s.top = s.sel
	}
	if s.sel >= s.top+ih {
		s.top = s.sel - ih + 1
	}
	for i := s.top; i < len(symbolCards) && i-s.top < ih; i++ {
		y := i - s.top
		sc := symbolCards[i]
		if i == s.sel {
			if !a.th.mono {
				for x := -1; x < lw-3; x++ {
					c.SetBG(x, y, cR1)
				}
			}
			c.Put(-1, y, '▌', cRain)
			c.TextA(0, y, sc.sym, cGold, attrBold)
			c.Text(8, y, trunc(sc.name, lw-12), cWhite)
		} else {
			c.Text(0, y, sc.sym, cGold)
			c.Text(8, y, trunc(sc.name, lw-12), cDim)
		}
	}
	done()

	sc := symbolCards[s.sel]
	rx, rwid := lw, w-lw
	done = c.Box(rx, 0, rwid, h, cBorder, sc.sym+" · "+sc.name)
	iw := rwid - 4
	y := 0
	if sc.formula != "" {
		richC(c, 0, y, iw, sc.formula, cDim)
		y += 2
	}
	meta := ""
	if sc.unit != "" {
		meta = "unit " + sc.unit + " · "
	}
	meta += "now: " + sc.value(a)
	c.Text(0, y, trunc(meta, iw), cRain)
	y += 2
	vh := 0
	if sc.vis != nil && h-2-y >= 14 {
		vh = min(12, (h-2-y)/2)
		r := c.Sub(0, y, iw, vh)
		sc.vis(s.g, a, c, iw, vh, a.t-s.t0)
		r()
		y += vh + 1
	}
	body := "‹What it is›\n" + sc.meaning + "\n\n‹Why the model needs it›\n" + sc.why
	if sc.up != "" {
		body += "\n\n‹Raise it →› " + sc.up
	}
	if sc.down != "" {
		body += "\n‹Lower it →› " + sc.down
	}
	r := c.Sub(0, y, iw, h-2-y)
	s.text.draw(c, iw, h-2-y, body)
	r()
	done()
}

func trunc(s string, n int) string {
	r := []rune(s)
	if len(r) <= n || n < 2 {
		return s
	}
	return string(r[:n-1]) + "…"
}
