package ui

import (
	"fmt"
	"math"
	"slices"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"

	"wmptrs-sim/internal/model"
	"wmptrs-sim/internal/sim"
)

// caseStudy is a hand-built journey that isolates one behaviour of the model.
// Every case is fully editable: the storm can be moved, scaled and resized.
type caseStudy struct {
	name  string
	setup func() sim.Setup
	story string // rich text
}

func mkSetup(ox, oy, dx, dy int, sx, sy float64, cells ...sim.Cell) sim.Setup {
	s := sim.Setup{OX: ox, OY: oy, DX: dx, DY: dy, Cells: cells, ShiftX: sx, ShiftY: sy}
	for i := range s.Noise {
		s.Noise[i] = 1 // cases use exact block intensities unless shifted
	}
	return s
}

// The case network is fixed so cases look the same whatever seed is set.
const caseSeed = 2026

var caseLib = []caseStudy{
	{"Dry day", func() sim.Setup { return mkSetup(2, 3, 27, 13, 0, 0) },
		"«What to look for:» every variant draws the same route.\n\n" +
			"With no rain φ(0) = 0, so the multiplier 1 + β·E·φ is exactly ‹1› on every edge. " +
			"The DP router «is» the time-only router on a dry day.\n\n" +
			"«Why it matters:» an app can switch DP on permanently. Nothing changes until it actually rains, " +
			"so there is no cost to adopting it.\n\n" +
			"Try: press ‹+› a few times to grow a storm from nothing and watch the moment the route changes."},
	{"Storm → modal shift", func() sim.Setup { return mkSetup(3, 3, 27, 13, 0, 0, sim.Cell{X: 15, Y: 8, Peak: 28, Radius: 3}) },
		"«What to look for:» A0 rides a motorcycle straight through a 28 mm/h cell. " +
			"A3 «shifts mode» to walk + BRT + rail and arrives almost dry.\n\n" +
			"Moto edges have ‹E = 1›, so inside the cell each km costs about ‹2×›. Rail in-vehicle edges have ‹E = 0›. " +
			"They stay at their plain time cost, so the sheltered option wins.\n\n" +
			"Note: A0 minimises «generalised» time, where walking and waiting count 1.5×. Its clock time can be longer than A3's.\n\n" +
			"Try: ‹s› to watch Dijkstra explore, ‹h› to see the penalty heatmap."},
	{"Storm → detour", func() sim.Setup { return mkSetup(2, 4, 27, 11, 0, 0, sim.Cell{X: 14, Y: 8, Peak: 30, Radius: 3.5}) },
		"«What to look for:» the traveller stays on the motorcycle because transit is too slow here. " +
			"A3 bends the route «around» the storm.\n\n" +
			"DP does not only switch modes. Because it prices «each edge», it finds a drier path within the same mode. " +
			"A few extra minutes buy a large cut in rain dose.\n\n" +
			"Try: move the storm with the arrow keys and watch the detour follow it."},
	{"Light rain below r0", func() sim.Setup { return mkSetup(3, 3, 27, 13, 0, 0, sim.Cell{X: 15, Y: 8, Peak: 3, Radius: 60}) },
		"«What to look for:» 3 mm/h everywhere. ‹A1› (threshold) and ‹A2› (linear above r0) «do not react at all». " +
			"They see no rain below r0.\n\n" +
			"‹A3› still adds a small, proportional penalty, φ(3) ≈ 0.2. That is enough to tip a near-tie toward the sheltered option.\n\n" +
			"«Why it matters:» a long ride in drizzle still leaves you wet. A graded response captures that. A threshold cannot."},
	{"The threshold cliff", func() sim.Setup { return mkSetup(3, 3, 27, 13, 0, 0, sim.Cell{X: 15, Y: 8, Peak: 4.9, Radius: 60}) },
		"«What to look for:» uniform 4.9 mm/h, just below r0 = 5. ‹A1› does nothing. A3 already shifts.\n\n" +
			"Press ‹+› once (to 5.1 mm/h). «A1 flips its route.» A 0.2 mm/h change in the forecast flips the whole decision.\n\n" +
			"Forecast intensities carry roughly ±30 % error (σ = 0.3), so a threshold router makes «random-looking» decisions near r0. " +
			"The sigmoid changes smoothly, so small forecast errors cause small cost changes."},
	{"Forecast in the wrong place", func() sim.Setup {
		return mkSetup(3, 3, 27, 13, 0, 5, sim.Cell{X: 15, Y: 8, Peak: 28, Radius: 3})
	},
		"«What to look for:» the same storm as case 2, but the forecast puts it «5 km north» of where it really is (press ‹f› to compare).\n\n" +
			"The router avoids the rain it «believes» in. A3 still roughly halves the dose versus A0, " +
			"but the ‹oracle› (A3 on the true rain, pick it with ‹v›) shows what a perfect forecast would allow.\n\n" +
			"⟦DP is only as good as its forecast.⟧ That is why the experiment always scores routes on the «true» rain, never on the forecast."},
	{"Already sheltered", func() sim.Setup { return mkSetup(5, 2, 26, 12, 0, 0, sim.Cell{X: 15, Y: 7, Peak: 35, Radius: 3}) },
		"«What to look for:» a violent 35 mm/h storm, yet «no variant reroutes».\n\n" +
			"The fastest route is already the diagonal rail line. Riding has ‹E = 0›, and the rail waits are in enclosed stations (‹E = 0.1›). " +
			"DP only penalises «exposure», not rain itself.\n\n" +
			"«Why it matters:» the model does not invent detours. It changes a route only when the traveller would actually get wet."},
	{"Playground", func() sim.Setup { return mkSetup(3, 3, 27, 13, 0, 0, sim.Cell{X: 15, Y: 8, Peak: 20, Radius: 2.5}) },
		"«Your turn.» Drive the storm:\n" +
			"• ‹← → ↑ ↓›  move the storm (1 km)\n" +
			"• ‹+ / -›  intensity\n" +
			"• ‹[ / ]›  radius\n" +
			"• ‹v›  compare A1 / A2 / A3 / A4 / oracle\n" +
			"• ‹h›  penalty heatmap (walk / moto)\n" +
			"• ‹s›  animate the Dijkstra search\n" +
			"• ‹0›  reset\n\n" +
			"β, r0 and k come from the Params / φ screens. Change them there and come back."},
}

const (
	infoStory = iota
	infoNumbers
	infoMaths
	numInfo
)

var infoNames = [numInfo]string{"story", "numbers", "edge maths"}

type casesScreen struct {
	m        cityMap
	sel      int
	setup    sim.Setup
	net      *sim.Network
	j        *sim.Journey // display journey: Out has A0..A4 then the oracle
	truth    []float64
	fc       []float64
	dirty    bool
	forParam model.Params

	cmp       int
	forecast  bool
	heat      int // 0 off, 1 walk, 2 moto
	info      int
	drawStart float64
	story     scrollText

	trace      *sim.Trace
	traceStart float64

	k struct{ pick, move, peak, rad, cmp, fc, heat, search, info, reset, scroll key.Binding }
}

const oracleIdx = int(model.NumVariants)

func newCases() *casesScreen {
	s := &casesScreen{cmp: int(model.A3), dirty: true, sel: 1}
	s.k.pick = key.NewBinding(key.WithKeys("n", "b", "1", "2", "3", "4", "5", "6", "7", "8"), key.WithHelp("n/b 1-8", "case"))
	s.k.move = key.NewBinding(key.WithKeys("left", "right", "up", "down"), key.WithHelp("←→↑↓", "move storm"))
	s.k.peak = key.NewBinding(key.WithKeys("+", "=", "-"), key.WithHelp("+/-", "intensity"))
	s.k.rad = key.NewBinding(key.WithKeys("[", "]"), key.WithHelp("[ ]", "radius"))
	s.k.cmp = key.NewBinding(key.WithKeys("v"), key.WithHelp("v", "variant"))
	s.k.fc = key.NewBinding(key.WithKeys("f"), key.WithHelp("f", "truth/forecast"))
	s.k.heat = key.NewBinding(key.WithKeys("h"), key.WithHelp("h", "heatmap"))
	s.k.search = key.NewBinding(key.WithKeys("s"), key.WithHelp("s", "search anim"))
	s.k.info = key.NewBinding(key.WithKeys("i"), key.WithHelp("i", "panel"))
	s.k.reset = key.NewBinding(key.WithKeys("0"), key.WithHelp("0", "reset"))
	s.k.scroll = key.NewBinding(key.WithKeys("pgdown", "pgup"), key.WithHelp("pgdn/up", "scroll"))
	return s
}

func (s *casesScreen) title() string  { return "Cases" }
func (s *casesScreen) captures() bool { return false }
func (s *casesScreen) keys() []key.Binding {
	return []key.Binding{s.k.pick, s.k.move, s.k.peak, s.k.cmp, s.k.fc, s.k.heat, s.k.search, s.k.info, s.k.rad, s.k.reset, s.k.scroll}
}

func (s *casesScreen) enter(a *App) tea.Cmd {
	if s.net == nil {
		s.net = sim.NewNetwork(caseSeed)
		s.load(a, s.sel)
	}
	return nil
}

func (s *casesScreen) load(a *App, i int) {
	s.sel = (i + len(caseLib)) % len(caseLib)
	s.setup = caseLib[s.sel].setup()
	s.story.off = 0
	s.trace = nil
	s.dirty = true
	s.drawStart = a.t
}

func (s *casesScreen) recompute(a *App) {
	mp := a.params.Model()
	if !s.dirty && mp == s.forParam {
		return
	}
	p := a.params
	j := sim.RouteSetup(s.net, s.setup, p)
	j.Out = append(slices.Clone(j.Out), j.Oracle)
	s.j = &j
	s.truth, s.fc = sim.EdgeRain(s.net, s.setup)
	s.dirty, s.forParam = false, mp
	if s.trace != nil {
		s.startTrace(a)
	}
}

func (s *casesScreen) startTrace(a *App) {
	o := s.j.Out[s.cmp]
	v, field := model.Variant(min(s.cmp, int(model.A4))), s.fc
	if s.cmp == oracleIdx {
		v, field = model.A3, s.truth
	}
	st := s.setup
	src, dst := sim.WalkNode(st.OX, st.OY), sim.WalkNode(st.DX, st.DY)
	if o.Moto {
		src, dst = sim.MotoNode(st.OX, st.OY), sim.MotoNode(st.DX, st.DY)
	}
	tr := sim.TraceShortest(s.net, v, a.params.Model(), field, src, dst)
	s.trace, s.traceStart = &tr, a.t
}

func (s *casesScreen) update(a *App, msg tea.KeyMsg) tea.Cmd {
	ks := msg.String()
	if s.info == infoStory && s.story.key(ks) {
		return nil
	}
	cell := func() *sim.Cell {
		if len(s.setup.Cells) == 0 {
			s.setup.Cells = append(s.setup.Cells, sim.Cell{X: 15, Y: 8, Peak: 0, Radius: 2.5})
		}
		return &s.setup.Cells[0]
	}
	changed := true
	switch ks {
	case "n":
		s.load(a, s.sel+1)
	case "b":
		s.load(a, s.sel-1)
	case "1", "2", "3", "4", "5", "6", "7", "8":
		s.load(a, int(ks[0]-'1'))
	case "0":
		s.load(a, s.sel)
	case "left":
		cell().X = clamp(cell().X-1, 0, sim.GridW)
	case "right":
		cell().X = clamp(cell().X+1, 0, sim.GridW)
	case "up":
		cell().Y = clamp(cell().Y+1, 0, sim.GridH)
	case "down":
		cell().Y = clamp(cell().Y-1, 0, sim.GridH)
	case "+", "=":
		c := cell()
		c.Peak = math.Round(clamp(c.Peak+peakStep(c.Peak, 1), 0, 60)*10) / 10
	case "-":
		c := cell()
		c.Peak = math.Round(clamp(c.Peak-peakStep(c.Peak, -1), 0, 60)*10) / 10
	case "[":
		cell().Radius = clamp(cell().Radius-0.5, 0.5, 60)
	case "]":
		cell().Radius = clamp(cell().Radius+0.5, 0.5, 60)
	case "v":
		s.cmp = s.cmp%oracleIdx + 1
		s.drawStart = a.t
		if s.trace != nil {
			s.startTrace(a)
		}
		changed = false
	case "f":
		s.forecast = !s.forecast
		changed = false
	case "h":
		s.heat = (s.heat + 1) % 3
		changed = false
	case "s":
		if s.trace != nil {
			s.trace = nil
		} else {
			s.recompute(a)
			s.startTrace(a)
		}
		changed = false
	case "i":
		s.info = (s.info + 1) % numInfo
		changed = false
	default:
		changed = false
	}
	if changed {
		s.dirty = true
		s.drawStart = a.t
	}
	return nil
}

// peakStep is fine near the r0 threshold and coarse in heavy rain.
func peakStep(p float64, dir float64) float64 {
	if p < 8 || (dir < 0 && p <= 8) {
		return 0.2
	}
	return 2
}

const traceSecs = 3.5

func (s *casesScreen) tick(a *App, steps int) bool {
	if s.net == nil {
		s.enter(a)
	}
	s.recompute(a)
	anim := a.t-s.drawStart < routeDrawSecs
	if s.trace != nil && a.t-s.traceStart < traceSecs+routeDrawSecs {
		anim = true
	}
	return anim || s.heat != 0
}

func (s *casesScreen) draw(a *App, c *Canvas, w, h int) {
	if s.net == nil || s.j == nil {
		s.enter(a)
		s.recompute(a)
	}
	rw := min(44, max(34, w*2/5))
	mw := w - rw
	cs := caseLib[s.sel]
	field := "true rain"
	if s.forecast {
		field = "forecast"
	}
	done := c.Box(0, 0, mw, h, cBorder, fmt.Sprintf("Case %d/%d · %s · %s", s.sel+1, len(caseLib), cs.name, field))

	mv := mapView{j: s.j, net: s.net, base: 0, cmp: s.cmp, showForecast: s.forecast, t: a.t}
	frac := 1 - math.Pow(1-math.Min(1, (a.t-s.drawStart)/routeDrawSecs), 3)
	if s.trace != nil {
		el := a.t - s.traceStart
		mv.trace, mv.noBase = s.trace.Settled, true
		mv.traceN = int(float64(len(s.trace.Settled)) * math.Min(1, el/traceSecs))
		frac = 0
		if el > traceSecs {
			frac = 1 - math.Pow(1-math.Min(1, (el-traceSecs)/routeDrawSecs), 3)
		}
	}
	mv.frac = frac
	if s.heat > 0 {
		mp := a.params.Model()
		mv.heat, mv.heatField = &mp, s.fc
		mv.heatKind = model.Walk
		if s.heat == 2 {
			mv.heatKind = model.Moto
		}
	}
	r := c.Sub(-1, 0, mw-2, h-3)
	s.m.draw(a, c, mw-2, h-3, mv)
	r()
	x, y := 0, h-3
	if s.heat > 0 {
		x += c.Text(x, y, fmt.Sprintf("%s cost ×", map[int]string{1: "walk", 2: "moto"}[s.heat]), cDim) + 1
		for _, l := range []struct {
			s   string
			col uint8
		}{{"━1.1", cGoldDim}, {"━1.3", cGold}, {"━1.6", cAmber}, {"━1.9+", cRed}} {
			x += c.Text(x, y, l.s, l.col) + 1
		}
	} else if s.trace != nil {
		x += c.Text(x, y, "⠿ settled nodes", cBorderHi) + 2
		c.Text(x, y, fmt.Sprintf("%d / %d", min(len(s.trace.Settled), int(float64(len(s.trace.Settled))*(a.t-s.traceStart)/traceSecs)), len(s.trace.Settled)), cDim)
	} else {
		for _, l := range []struct {
			s   string
			col uint8
		}{{"━moto", cMagenta}, {"━walk", cGreen}, {"━BRT", cRain}, {"━rail", cGold}, {"━A0", cDim}} {
			x += c.Text(x, y, l.s, l.col) + 1
		}
	}
	if x+14 < mw-4 {
		c.TextR(mw-4, y, "vs "+s.cmpName(), cText)
	}
	done()

	title := "Case " + infoNames[s.info] + " · i: next"
	done = c.Box(mw, 0, rw, h, cBorderHi, title)
	iw, ih := rw-4, h-2
	// case strip
	y = 0
	for i := range caseLib {
		col, ch := cFaint, '○'
		if i == s.sel {
			col, ch = cRain, '●'
		}
		c.Put(i*2, y, ch, col)
	}
	c.TextR(iw, y, s.stormLabel(), cDim)
	y += 2
	r = c.Sub(0, y, iw, ih-y)
	switch s.info {
	case infoStory:
		s.story.draw(c, iw, ih-y, cs.story)
	case infoNumbers:
		s.drawNumbers(a, c, iw, ih-y)
	case infoMaths:
		s.drawMaths(a, c, iw, ih-y)
	}
	r()
	done()
}

func (s *casesScreen) cmpName() string {
	if s.cmp == oracleIdx {
		return "oracle"
	}
	return model.Variant(s.cmp).String() + " " + model.Variant(s.cmp).Describe()
}

func (s *casesScreen) stormLabel() string {
	if len(s.setup.Cells) == 0 || s.setup.Cells[0].Peak == 0 {
		return "no rain"
	}
	c := s.setup.Cells[0]
	return fmt.Sprintf("storm %.1f mm/h r%.1f", c.Peak, c.Radius)
}

func (s *casesScreen) drawNumbers(a *App, c *Canvas, w, h int) {
	j := s.j
	c.Text(0, 0, "     mode    time   rain dose", cDim)
	y := 1
	for v := 0; v <= oracleIdx; v++ {
		o := j.Out[v]
		name, col := model.Variant(min(v, int(model.A4))).String(), cText
		if v < oracleIdx {
			col = variantColor[v]
		} else {
			name, col = "orc", cWhite
		}
		mode := "transit"
		if o.Moto {
			mode = "moto"
		}
		mark := " "
		if v == s.cmp {
			mark = "›"
		}
		c.Text(0, y, fmt.Sprintf("%s%-3s %-7s %4.0fm %7.2f mm", mark, name, mode, o.T, o.Dose), col)
		y++
	}
	y++
	o0, oc := j.Out[0], j.Out[s.cmp]
	if o0.Dose > 1e-9 {
		red := 100 * (1 - oc.Dose/o0.Dose)
		col := cGreen
		if red < 0 {
			col = cRed
		}
		dt := oc.T - o0.T
		tm := fmt.Sprintf("for ‹%.0f min› more", dt)
		if dt < -0.5 {
			tm = fmt.Sprintf("and ‹%.0f min› faster", -dt)
		} else if dt < 0.5 {
			tm = "at the same time"
		}
		verb := "less"
		if red < 0 {
			verb, red = "MORE", -red
		}
		y += rich(c, 0, y, w, 3, fmt.Sprintf("%s vs A0: ‹%.0f%%› %s rain %s", s.cmpName(), red, verb, tm), col)
	} else {
		y += rich(c, 0, y, w, 2, "A0 stays dry on this journey, so there is nothing to reduce.", cDim)
	}
	y++
	y += rich(c, 0, y, w, h-y, "«dose» = Σ τ·E·r_true / 60, in mm of rain received. «orc» = oracle: A3 routed on the «true» rain, the best a perfect forecast could do.", cDim)
	_ = y
}

// drawMaths walks through the DP arithmetic for the most rain-hit edge of
// the A0 route, then the route totals.
func (s *casesScreen) drawMaths(a *App, c *Canvas, w, h int) {
	net, j := s.net, s.j
	mp := a.params.Model()
	best, bestV := int32(-1), 0.0
	for _, e := range j.Out[0].Path {
		if v := net.Kind[e].Exposure() * s.fc[e]; v > bestV {
			best, bestV = e, v
		}
	}
	y := 0
	if best < 0 {
		y += rich(c, 0, y, w, 4, "No exposed edge of the A0 route has forecast rain, so every multiplier is ‹1› and DP equals time-only routing.", cText)
	} else {
		k := net.Kind[best]
		tau, wm, e, r := net.Tau[best], k.Weight(), k.Exposure(), s.fc[best]
		phi := model.Phi(r, mp)
		c0 := model.A0.Cost(tau, k, r, mp)
		c3 := model.A3.Cost(tau, k, r, mp)
		lines := []string{
			fmt.Sprintf("Wettest edge on A0's route (%s):", k),
			fmt.Sprintf(" ‹τ›   = %5.2f min   link time", tau),
			fmt.Sprintf(" ‹w_m› = %5.2f       %s", wm, map[bool]string{true: "walk/wait weight", false: "riding"}[wm > 1]),
			fmt.Sprintf(" ‹E›   = %5.2f       exposure", e),
			fmt.Sprintf(" ‹r_f› = %5.1f mm/h  forecast", r),
			fmt.Sprintf(" ‹φ›   = %5.2f       φ(r_f)", phi),
			fmt.Sprintf(" A0: τ·w = «%.2f»", c0),
			fmt.Sprintf(" A3: %.2f×(1+%.2f·%.1f·%.2f) = «%.2f»", c0, mp.Beta, e, phi, c3),
			fmt.Sprintf(" → this edge now costs ‹%.2f×›", c3/c0),
		}
		for _, l := range lines {
			if y >= h {
				return
			}
			richAt(c, 0, y, l, cText)
			y++
		}
	}
	y++
	if y+3 >= h {
		return
	}
	priced := func(path []int32, v model.Variant, field []float64) float64 {
		var t float64
		for _, e := range path {
			t += v.Cost(net.Tau[e], net.Kind[e], field[e], mp)
		}
		return t
	}
	cmpV := model.Variant(min(s.cmp, int(model.A4)))
	field := s.fc
	if s.cmp == oracleIdx {
		cmpV, field = model.A3, s.truth
	}
	pa := priced(j.Out[0].Path, cmpV, field)
	pc := priced(j.Out[s.cmp].Path, cmpV, field)
	richAt(c, 0, y, fmt.Sprintf("Whole route, priced by %s:", cmpV), cDim)
	richAt(c, 0, y+1, fmt.Sprintf(" %-11s = ‹%6.1f›", "A0's route", pa), cText)
	richAt(c, 0, y+2, fmt.Sprintf(" %-11s = ‹%6.1f›", s.cmpShort()+"'s route", pc), cText)
	y += 3
	if pc < pa-1e-9 {
		rich(c, 0, y, w, h-y, "Dijkstra picks the lower total, so the route changes.", cGreen)
	} else {
		rich(c, 0, y, w, h-y, "Same route: the penalty never outweighs the alternative.", cDim)
	}
}

func (s *casesScreen) cmpShort() string {
	if s.cmp == oracleIdx {
		return "orc"
	}
	return model.Variant(s.cmp).String()
}
