package ui

import (
	"fmt"
	"math"
	"strings"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"

	"wmptrs-sim/internal/model"
	"wmptrs-sim/internal/sim"
)

// slide is one page of the guided explanation: a visual plus narration.
type slide struct {
	section string
	title   string
	text    func(a *App) string
	vis     func(g *guideScreen, a *App, c *Canvas, w, h int, t float64)
	need    int // preferred visual height; it is centred when there is room (0 = fill)
}

func static(s string) func(*App) string { return func(*App) string { return s } }

const autoplaySecs = 16.0

type guideScreen struct {
	sel     int
	t0      float64
	auto    bool
	text    scrollText
	slides  []slide
	m       cityMap
	p       plot
	caseNet *sim.Network
	caseJ   *sim.Journey
	k       struct{ nav, auto, jump, scroll key.Binding }
}

func newGuide() *guideScreen {
	g := &guideScreen{}
	g.slides = guideSlides()
	g.k.nav = key.NewBinding(key.WithKeys("left", "right", "enter"), key.WithHelp("←→", "slide"))
	g.k.auto = key.NewBinding(key.WithKeys("p"), key.WithHelp("p", "autoplay"))
	g.k.jump = key.NewBinding(key.WithKeys("home", "end"), key.WithHelp("home/end", "first/last"))
	g.k.scroll = key.NewBinding(key.WithKeys("pgdown", "pgup"), key.WithHelp("pgdn/up", "scroll text"))
	return g
}

func (g *guideScreen) title() string  { return "Guide" }
func (g *guideScreen) captures() bool { return false }
func (g *guideScreen) keys() []key.Binding {
	return []key.Binding{g.k.nav, g.k.auto, g.k.jump, g.k.scroll}
}

func (g *guideScreen) enter(a *App) tea.Cmd {
	g.t0 = a.t
	if g.caseNet == nil {
		g.caseNet = sim.NewNetwork(caseSeed)
		j := sim.RouteSetup(g.caseNet, caseLib[1].setup(), sim.Presets()[0].Params)
		g.caseJ = &j
	}
	return nil
}

func (g *guideScreen) go_(a *App, i int) {
	i = min(max(i, 0), len(g.slides)-1)
	if i != g.sel {
		g.sel, g.t0, g.text.off = i, a.t, 0
	}
}

func (g *guideScreen) update(a *App, msg tea.KeyMsg) tea.Cmd {
	ks := msg.String()
	if g.text.key(ks) {
		return nil
	}
	switch ks {
	case "right", "enter", "l":
		if g.sel == len(g.slides)-1 && ks == "enter" {
			return a.switchTo(scrSymbols, 1)
		}
		g.go_(a, g.sel+1)
	case "left", "h":
		g.go_(a, g.sel-1)
	case "home":
		g.go_(a, 0)
	case "end":
		g.go_(a, len(g.slides)-1)
	case "p":
		g.auto = !g.auto
		g.t0 = a.t
	}
	return nil
}

func (g *guideScreen) tick(a *App, steps int) bool {
	if g.caseNet == nil {
		g.enter(a)
	}
	if g.auto && a.t-g.t0 > autoplaySecs {
		if g.sel == len(g.slides)-1 {
			g.auto = false
		} else {
			g.go_(a, g.sel+1)
		}
	}
	return true // every visual is animated
}

func (g *guideScreen) draw(a *App, c *Canvas, w, h int) {
	if g.caseNet == nil {
		g.enter(a)
	}
	sl := g.slides[g.sel]
	t := a.t - g.t0

	// heading row: section · n/N · title, progress dots on the right
	c.Fill(0, 0, w, 2, cPanel)
	x := 1
	x += c.TextA(x, 0, " "+sl.section+" ", cBG, attrRev|attrBold)
	x += 1
	x += c.Text(x, 0, fmt.Sprintf("%d/%d", g.sel+1, len(g.slides)), cDim) + 1
	c.TextA(x, 0, slideTitle(sl), cWhite, attrBold)
	dots := len(g.slides)*2 - 1
	if w-x-runeLen(slideTitle(sl)) > dots+4 {
		for i := range g.slides {
			ch, col := '·', cFaint
			switch {
			case i == g.sel:
				ch, col = '●', cRain
			case i < g.sel:
				ch, col = '•', cRainDim
			}
			c.Put(w-dots-1+i*2, 0, ch, col)
		}
	}
	if g.auto {
		f := math.Min(1, t/autoplaySecs)
		for i := 0; i < w; i++ {
			if float64(i)/float64(w) < f {
				c.Put(i, 1, '▁', cRainDim)
			}
		}
		c.TextR(w-1, 1, " autoplay · p to stop ", cAmber)
	}

	top := 1
	if g.auto {
		top = 2
	}
	bh := h - top
	var vx, vy, vw, vh, tx, ty, tw, th int
	if w >= 104 {
		vw = w * 56 / 100
		vx, vy, vh = 0, top, bh
		tx, ty, tw, th = vw, top, w-vw, bh
	} else {
		vh = max(8, bh*3/5)
		vx, vy, vw = 0, top, w
		tx, ty, tw, th = 0, top+vh, w, bh-vh
	}
	done := c.Box(vx, vy, vw, vh, cBorder, "")
	ih := vh - 2
	if sl.need > 0 && ih > sl.need+1 {
		r := c.Sub(0, (ih-sl.need)/2, vw-4, sl.need)
		sl.vis(g, a, c, vw-4, sl.need, t)
		r()
	} else {
		sl.vis(g, a, c, vw-4, ih, t)
	}
	done()
	nav := "← prev · next →"
	if g.sel == len(g.slides)-1 {
		nav = "enter: Symbols"
	}
	done = c.Box(tx, ty, tw, th, cBorderHi, "Explanation")
	g.text.draw(c, tw-4, th-2, slideText(sl, a))
	done()
	c.TextR(tx+tw-2, ty+th-1, " "+nav+" ", cDim)
}

// ---------------------------------------------------------------- visuals

func hash2(a, b int) uint32 {
	h := uint32(a)*0x9e3779b1 ^ uint32(b)*0x85ebca77
	h ^= h >> 15
	h *= 0x2c1b3c6d
	h ^= h >> 12
	return h
}

func visProblem(g *guideScreen, a *App, c *Canvas, w, h int, t float64) {
	phase := int(t/5) % 2
	local := math.Mod(t, 5)
	frac := 1 - math.Pow(1-math.Min(1, local/1.4), 3)
	mv := mapView{j: g.caseJ, net: g.caseNet, t: a.t, frac: frac}
	caption, col := "Time-only router (A0): motorcycle straight through the storm", cMagenta
	if phase == 0 {
		mv.cmp, mv.noBase = 0, true
	} else {
		mv.cmp = int(model.A3)
		caption, col = "Weather-aware router (A3): walk + BRT + rail, almost dry", cRain
	}
	r := c.Sub(-1, 1, w+2, h-1)
	g.m.draw(a, c, w+2, h-1, mv)
	r()
	o0, o3 := g.caseJ.Out[0], g.caseJ.Out[model.A3]
	c.TextA(0, 0, caption, col, attrBold)
	if h > 6 {
		c.Text(0, h-1, fmt.Sprintf("A0 %.0f min, %.1f mm rain │ A3 %.0f min, %.1f mm rain", o0.T, o0.Dose, o3.T, o3.Dose), cText)
	}
}

func visFormula(g *guideScreen, a *App, c *Canvas, w, h int, t float64) {
	type tok struct {
		s     string
		label string
		col   uint8
	}
	toks := []tok{
		{"c", "generalised cost, what Dijkstra minimises", cWhite},
		{" = ", "", 0},
		{"τ", "minutes spent on this edge", cText},
		{" · ", "", 0},
		{"w_m", "walk/wait minutes count 1.5×", cGreen},
		{" · (1 + ", "", 0},
		{"β", "how much you mind rain", cGold},
		{" · ", "", 0},
		{"E", "exposure of the edge, 0 … 1", cRain},
		{" · ", "", 0},
		{"φ(r_f)", "forecast rain → 0 … 1", cAmber},
		{")", "", 0},
	}
	total := 0
	for _, tk := range toks {
		total += runeLen(tk.s)
	}
	x0 := max(0, (w-total)/2-12)
	type mark struct {
		x     int
		label string
		col   uint8
	}
	var marks []mark
	x := x0
	for _, tk := range toks {
		col := cDim
		if tk.label != "" {
			col = tk.col
			marks = append(marks, mark{x, tk.label, tk.col})
		}
		c.TextA(x, 0, tk.s, col, attrBold)
		x += runeLen(tk.s)
	}
	// callouts: rightmost symbol gets the shortest stem
	for k := len(marks) - 1; k >= 0; k-- {
		order := len(marks) - 1 - k
		if t < 0.4+0.45*float64(order) {
			continue
		}
		m := marks[k]
		row := 2 + order
		if row >= h {
			continue
		}
		for y := 1; y < row; y++ {
			c.Put(m.x, y, '│', m.col)
		}
		c.Put(m.x, row, '└', m.col)
		c.Text(m.x+2, row, m.label, m.col)
	}
	y := 2 + len(marks) + 1
	if t > 3.4 && y+1 < h {
		richC(c, 0, y, w, "dry edge: φ(0) = 0  →  c = τ · w_m   ‹(time-only, exactly)›", cDim)
		richC(c, 0, y+1, w, "max penalty: φ → 1  →  c ≤ τ · w_m · (1 + β·E)   ‹(bounded)›", cDim)
	}
}

func visVariants(g *guideScreen, a *App, c *Canvas, w, h int, t float64) {
	rows := []struct {
		v          model.Variant
		rule, role string
	}{
		{model.A0, "c = τ·w", "control: what routers do today"},
		{model.A1, "×(1+β) if r_f ≥ r0 and E > 0", "baseline: simple rain rule"},
		{model.A2, "×(1 + α_m·(r_f − r0)⁺)", "baseline: linear penalty"},
		{model.A3, "×(1 + β·E·φ(r_f))", "PROPOSED: Discomfort Penalty"},
		{model.A4, "A3 but waits get E = 0", "ablation: does wait exposure matter?"},
	}
	step := 2
	if h < 11 {
		step = 1
	}
	for i, r := range rows {
		if t < 0.3*float64(i) {
			break
		}
		y := i * step
		col := variantColor[r.v]
		c.TextA(0, y, r.v.String(), col, attrBold)
		c.Text(4, y, r.rule, cText)
		rx := min(36, w/2+4)
		if step == 1 || w >= 70 {
			c.Text(rx, y, r.role, col)
		} else {
			c.Text(4, y+1, r.role, col)
		}
	}
	y := len(rows)*step + 1
	if y < h {
		rich(c, 0, y, w, h-y, "All five see the «same forecast» and are scored on the «same true rain» with the same E. Only the cost function changes.", cDim)
	}
}

func visWeights(g *guideScreen, a *App, c *Canvas, w, h int, t float64) {
	rows := []struct {
		name string
		k    model.Kind
		col  uint8
	}{
		{"ride bus/rail", model.RideBus, cRain},
		{"motorcycle", model.Moto, cMagenta},
		{"walk", model.Walk, cGreen},
		{"wait at stop", model.WaitBRT, cAmber},
	}
	c.Text(0, 0, "10 real minutes, as the router counts them:", cDim)
	bw := max(10, w-30)
	grow := math.Min(1, t/1.2)
	for i, r := range rows {
		y := 2 + i*max(1, min(2, (h-4)/len(rows)))
		cost := 10 * r.k.Weight()
		c.Text(0, y, r.name, cText)
		hbar(c, 15, y, bw, grow*cost/15, r.col)
		c.Text(16+bw, y, fmt.Sprintf("%4.1f", cost*grow), r.col)
	}
	if h > 12 {
		rich(c, 0, h-3, w, 3, "‹w_m› is applied «before» any rain term. It is the dry-weather value of time, so A0 is already realistic.", cDim)
	}
}

func visExposure(g *guideScreen, a *App, c *Canvas, w, h int, t float64) {
	rows := []struct {
		name, why string
		k         model.Kind
		col       uint8
	}{
		{"walk", "open sky", model.Walk, cGreen},
		{"motorcycle", "open sky, spray", model.Moto, cMagenta},
		{"BRT wait", "roofed halte, wind", model.WaitBRT, cAmber},
		{"rail wait", "enclosed station", model.WaitRail, cGold},
		{"in vehicle", "dry inside", model.RideBus, cRain},
	}
	per := 2
	if h < 11 {
		per = 1
	}
	bw := max(10, w-42)
	frame := int(t * 12)
	for i, r := range rows {
		y := i*per + per - 1
		e := r.k.Exposure()
		c.Text(0, y, r.name, cText)
		hbar(c, 12, y, bw, e*math.Min(1, t/1.0), r.col)
		c.Text(13+bw, y, fmt.Sprintf("E=%.1f", e), r.col)
		c.Text(20+bw, y, r.why, cDim)
		if per == 2 {
			// rain falling onto the exposed part of the bar
			for k := 0; k < int(e*float64(bw)); k++ {
				if hash2(k, frame+i*31+k/3)%5 == 0 {
					c.Put(12+k, y-1, '╎', cRainDim)
				}
			}
		}
	}
	y := len(rows) * per
	if y+1 < h {
		rich(c, 0, y+1, w, h-y-1, "E multiplies the rain term only. ‹E = 0› means rain never changes that edge's cost.", cDim)
	}
}

func visRain(g *guideScreen, a *App, c *Canvas, w, h int, t float64) {
	// intensity scale on a square-root axis so light rain is readable
	pos := func(r float64) int { return int(math.Sqrt(r/40) * float64(w-1)) }
	for x := 0; x < w; x++ {
		r := math.Pow(float64(x)/float64(w-1), 2) * 40
		lv := rainLevel(r)
		if lv == 0 {
			lv = cCity
		}
		c.SetBG(x, 0, lv)
		if a.th.mono {
			c.Put(x, 0, []rune(" ·░▒▓█")[min(int(r/8), 5)], cText)
		}
	}
	for _, tk := range []float64{1, 5, 10, 20, 40} {
		x := pos(tk)
		c.Put(x, 1, '┴', cBorder)
		s := fmt.Sprintf("%g", tk)
		c.Text(min(x, w-len(s)), 2, s, cDim)
	}
	c.Text(0, 2, "mm/h", cDim)
	cats := []struct {
		lo, hi float64
		s      string
	}{{1, 5, "light"}, {5, 10, "moderate"}, {10, 20, "heavy"}, {20, 40, "very heavy"}}
	for _, ct := range cats {
		x0, x1 := pos(ct.lo), pos(ct.hi)
		s := ct.s
		if runeLen(s) > x1-x0 {
			s = s[:max(0, x1-x0-1)]
		}
		c.Text(x0+(x1-x0-runeLen(s))/2, 3, s, cText)
	}
	r0x := pos(a.params.R0)
	c.PutA(r0x, 1, '▲', cGold, attrBold)
	c.Text(min(r0x+1, w-10), 1, fmt.Sprintf("r0=%g", a.params.R0), cGold)

	// truth vs forecast along a 30 km transect
	if h < 10 {
		return
	}
	shift := 3 * math.Sin(t*0.6)
	noise := []float64{1.25, 0.8, 1.1, 0.75, 1.3, 0.9, 1.15, 0.85, 1.2, 0.95, 1.05, 0.8, 1.1, 0.9, 1.2}
	truth := func(x float64) float64 { return 26 * math.Exp(-(x-15)*(x-15)/(2*2.5*2.5)) }
	fcAt := func(x float64) float64 {
		b := min(max(int(x/2), 0), 14)
		var s float64
		for i := 0; i < 8; i++ {
			s += truth(float64(b)*2 + (float64(i)+0.5)/4 - shift)
		}
		return s / 8 * noise[b]
	}
	ph := h - 5
	r := c.Sub(0, 5, w, ph)
	g.p.setup(c, w, ph, 0, 30, 0, 35, []float64{0, 10, 20, 30}, []float64{0, 10, 20, 30},
		func(v float64) string { return fmt.Sprintf("%gkm", v) }, func(v float64) string { return fmt.Sprintf("%g", v) })
	g.p.fn(func(x float64) float64 { return a.params.R0 }, cGoldDim)
	g.p.fn(fcAt, cAmber)
	g.p.fn(truth, cRain)
	g.p.blit(c)
	c.Text(g.p.x0+1, 0, "━ true rain r", cRain)
	c.Text(g.p.x0+16, 0, fmt.Sprintf("━ forecast r_f (shift %+.1f km)", shift), cAmber)
	r()
}

func visPhi(g *guideScreen, a *App, c *Canvas, w, h int, t float64) {
	mp := a.params.Model()
	cur := 10 + 9.5*math.Sin(t*0.5-math.Pi/2)
	g.p.setup(c, w, h-1, 0, 20, 0, 1.05, []float64{0, 5, 10, 15, 20}, []float64{0, 0.5, 1},
		func(v float64) string { return fmt.Sprintf("%g", v) }, func(v float64) string { return fmt.Sprintf("%.1f", v) })
	g.p.fn(func(float64) float64 { return 0.5 }, cFaint)
	g.p.vline(mp.R0, cGoldDim)
	g.p.vline(cur, cBorderHi)
	g.p.fn(func(r float64) float64 { return model.Phi(r, mp) }, cAmber)
	g.p.marker(cur, model.Phi(cur, mp), cWhite)
	g.p.blit(c)
	cx, _ := g.p.cellOf(mp.R0, 1)
	c.Text(cx+1, 0, "r0", cGold)
	richC(c, 0, h-1, w, fmt.Sprintf("r = ‹%4.1f› mm/h  →  φ = ‹%.2f›   (k = %.2f, mm/h on x-axis)", cur, model.Phi(cur, mp), mp.K), cText)
}

func visCompare(g *guideScreen, a *App, c *Canvas, w, h int, t float64) {
	mp := a.params.Model()
	ymax := (1 + math.Max(mp.Beta, 0.5)) * 1.12
	g.p.setup(c, w, h-1, 0, 25, 1, ymax, []float64{0, 5, 10, 15, 20, 25}, []float64{1, 1 + mp.Beta/2, 1 + mp.Beta},
		func(v float64) string { return fmt.Sprintf("%g", v) }, func(v float64) string { return fmt.Sprintf("×%.2g", v) })
	lo, hi := mp.R0*math.Exp(-0.3), mp.R0*math.Exp(0.3)
	g.p.vline(lo, cFaint)
	g.p.vline(hi, cFaint)
	g.p.fn(func(r float64) float64 {
		if r >= mp.R0 {
			return 1 + mp.Beta
		}
		return 1
	}, cAmber)
	g.p.fn(func(r float64) float64 { return 1 + 0.060*math.Max(0, r-mp.R0) }, cMagenta)
	g.p.fn(func(r float64) float64 { return 1 + mp.Beta*model.Phi(r, mp) }, cRain)
	// a forecast jittering around r0: show what each rule makes of it
	rf := mp.R0 * math.Exp(0.3*math.Sin(t*1.3))
	g.p.marker(rf, 1+mp.Beta*model.Phi(rf, mp), cWhite)
	g.p.blit(c)
	c.Text(g.p.x0+1, 0, "━A1 step", cAmber)
	c.Text(g.p.x0+11, 0, "━A2 linear", cMagenta)
	c.Text(g.p.x0+23, 0, "━A3 sigmoid", cRain)
	a1 := 1.0
	if rf >= mp.R0 {
		a1 = 1 + mp.Beta
	}
	richC(c, 0, h-1, w, fmt.Sprintf("forecast r_f = ‹%.1f› (±30%% band ┊┊)  A1 ‹×%.2f›  A3 ‹×%.2f›", rf, a1, 1+mp.Beta*model.Phi(rf, mp)), cText)
}

func visBeta(g *guideScreen, a *App, c *Canvas, w, h int, t float64) {
	mp := a.params.Model()
	betas := []float64{0, 0.5, 1, 2, 4, 8}
	richAt(c, 0, 0, "Walking 1 min in 15 mm/h rain «feels» like:", cDim)
	bw := max(10, w-34)
	per := 1
	if h >= 16 {
		per = 2
	}
	grow := math.Min(1, t/1.5)
	for i, b := range betas {
		y := 2 + i*per
		if y >= h {
			break
		}
		m := 1 + b*model.Phi(15, mp)
		col := cRain
		if b == a.params.Beta {
			col = cGold
		}
		c.Text(0, y, fmt.Sprintf("β=%-4g", b), col)
		hbar(c, 7, y, bw, grow*(m-1)/8.2+0.02, col)
		c.Text(8+bw, y, fmt.Sprintf("%.1f dry minutes", 1+(m-1)*grow), col)
	}
	y := 2 + len(betas)*per + 1
	if a.sweep != nil && y+2 < h {
		c.Text(0, y, "Your last β sweep (A3, all journeys):", cDim)
		y++
		for _, p := range a.sweep {
			if p.Family != "A3" || y >= h {
				continue
			}
			c.Text(0, y, fmt.Sprintf(" β %-4g  dose −%5.1f%%   time +%4.1f%%", p.Beta, p.DoseRedPct, p.TimeIncPct), cText)
			y++
		}
	} else if y < h {
		rich(c, 0, y, w, h-y, "Open the «Trade-off» screen to sweep β on real runs.", cDim)
	}
}

func visCity(g *guideScreen, a *App, c *Canvas, w, h int, t float64) {
	r := c.Sub(-1, 0, w+2, h-1)
	g.m.draw(a, c, w+2, h-1, mapView{net: g.caseNet, t: a.t})
	r()
	x := 0
	for _, l := range []struct {
		s   string
		col uint8
	}{{"── 11 BRT lines (open haltes)", cFaint}, {"── 2 rail lines", cGoldDim}, {"30 × 16 km, 1 km grid", cDim}} {
		x += c.Text(x, h-1, l.s, l.col) + 2
	}
}

func visPipeline(g *guideScreen, a *App, c *Canvas, w, h int, t float64) {
	stages := []struct{ head, body string }{
		{"Forecast", "rain per 2×2 km block → r_f on every edge"},
		{"Price edges", "c = τ·w_m·(1+β·E·φ(r_f)), one multiply each"},
		{"Dijkstra ×2", "door-to-door moto layer │ walk + transit layer"},
		{"Choose", "the cheaper of the two generalised costs"},
		{"Score", "on the TRUE rain: time, dose, exposed min"},
	}
	per := 2
	if h < len(stages)*2 {
		per = 1
	}
	active := int(t/1.2) % len(stages)
	for i, s := range stages {
		y := i * per
		col, at := cDim, attr(0)
		if i == active {
			col, at = cRain, attrBold
		}
		c.TextA(0, y, fmt.Sprintf(" %d ", i+1), cBG, attrRev)
		c.TextA(4, y, s.head, col, at)
		bx := 18
		if per == 2 && w < 60 {
			c.Text(4, y+1, s.body, cText)
		} else {
			c.Text(bx, y, s.body, cText)
		}
		if per == 2 && i < len(stages)-1 && w >= 60 {
			c.Put(1, y+1, '↓', cFaint)
		}
	}
	y := len(stages) * per
	if y+1 < h {
		rich(c, 0, y+1, w, h-y-1, "⟦Only step 2 is new.⟧ Steps 1, 3 and 4 are what any router already does.", cText)
	}
}

func visMeasure(g *guideScreen, a *App, c *Canvas, w, h int, t float64) {
	segs := []struct {
		name string
		k    model.Kind
		min  float64
		r    float64
	}{
		{"walk", model.Walk, 6, 12}, {"wait", model.WaitBRT, 4, 12}, {"bus", model.RideBus, 15, 12}, {"walk", model.Walk, 5, 2},
	}
	total := 0.0
	for _, s := range segs {
		total += s.min
	}
	bw := w - 2
	c.Text(0, 0, "Example trip, 30 min:", cDim)
	x := 0
	var dose, exposed float64
	for i, s := range segs {
		n := int(math.Round(s.min / total * float64(bw)))
		if i == len(segs)-1 {
			n = bw - x
		}
		col := kindColor[s.k]
		for k := 0; k < n; k++ {
			c.Put(x+k, 1, '█', col)
			if lv := rainLevel(s.r); lv != 0 {
				c.SetBG(x+k, 2, lv)
			}
		}
		c.Text(x, 3, s.name, col)
		d := s.min * s.k.Exposure() * s.r / 60
		dose += d
		if s.k.Exposure() > 0 && s.r >= a.params.R0 {
			exposed += s.min
		}
		if h > 9 {
			c.Text(x, 4, fmt.Sprintf("%.2f", d), cText)
		}
		x += n
	}
	if h <= 9 {
		return
	}
	c.Text(0, 2, "rain", cBG)
	y := 6
	y += rich(c, 0, y, w, 2, fmt.Sprintf("«dose» D = Σ τ·E·r/60 = ‹%.2f mm›   «exposed» = ‹%.0f min› (E>0, r ≥ r0)", dose, exposed), cText)
	if y+6 > h {
		return
	}
	y++
	c.Text(0, y, "Did the router reroute when it should?", cDim)
	y++
	grid := [][]string{
		{"", "oracle: drier route exists", "oracle: no"},
		{"rerouted", "TP  ✓ good call", "FP  wasted detour"},
		{"kept route", "FN  missed chance", "TN  ✓"},
	}
	for i, row := range grid {
		c.Text(0, y+i, fmt.Sprintf("%-11s", row[0]), cDim)
		c.Text(12, y+i, row[1], map[bool]uint8{true: cDim, false: cGreen}[i == 0])
		c.Text(40, y+i, row[2], map[bool]uint8{true: cDim, false: cAmber}[i == 0])
	}
	if y+4 < h {
		c.Text(0, y+4, "precision = TP/(TP+FP)  recall = TP/(TP+FN)", cText)
	}
}

func visStats(g *guideScreen, a *App, c *Canvas, w, h int, t float64) {
	type stage struct{ q, test, live string }
	var live [4]string
	if a.result != nil {
		s := a.result.Summary
		live[0] = fmt.Sprintf("χ²=%.1f, p=%s", s.Friedman.Chi2, fmtP(s.Friedman.P))
		var ps []string
		for _, cmp := range s.Wilcoxon {
			ps = append(ps, fmt.Sprintf("%s %s", cmp.Vs, fmtP(cmp.PHolm)))
		}
		live[1] = "A3 vs " + strings.Join(ps, " · ")
		live[2] = "4 comparisons → p adjusted"
		v := s.Variants[model.A3]
		live[3] = fmt.Sprintf("A3 −%.1f%% [%.1f, %.1f]", v.DoseRedPct, v.DoseRedCI[0], v.DoseRedCI[1])
	} else {
		for i := range live {
			live[i] = "press r to run → live value"
		}
	}
	stages := []stage{
		{"Do the 5 variants differ at all?", "Friedman (paired ranks)", live[0]},
		{"Which ones differ from A3?", "Wilcoxon signed-rank", live[1]},
		{"Not fooled by testing 4 times?", "Holm correction", live[2]},
		{"How big, and how sure?", "Bootstrap 95% CI", live[3]},
	}
	per := max(1, min(3, h/len(stages)))
	for i, s := range stages {
		y := i * per
		col := cDim
		if int(t/1.5)%len(stages) == i {
			col = cRain
		}
		c.TextA(0, y, s.q, col, attrBold)
		if per >= 2 {
			c.Text(2, y+1, s.test, cGold)
			c.Text(26, y+1, s.live, cText)
		} else {
			c.Text(34, y, s.test, cGold)
		}
	}
}

func visApps(g *guideScreen, a *App, c *Canvas, w, h int, t float64) {
	code := []string{
		"// the entire change, inside any router's edge-weight function",
		"phi := (sig(rf) - sig(0)) / (1 - sig(0))",
		"cost := tau * w[mode] * (1 + beta*E[mode]*phi)",
	}
	for i, l := range code {
		col := cGreen
		if i == 0 {
			col = cDim
		}
		c.Text(0, i, l, col)
	}
	y := len(code) + 1
	if a.bench != nil && y+3 < h {
		c.Text(0, y, "Measured routing call on this machine:", cDim)
		y++
		for _, v := range a.bench.Variants {
			if v.Name != "A0" && v.Name != "A3" {
				continue
			}
			c.Text(0, y, fmt.Sprintf(" %s median %6.1f µs   p95 %6.1f µs", v.Name, v.MedianUs, v.P95Us), variantColor[map[string]int{"A0": 0, "A3": 3}[v.Name]])
			y++
		}
		y++
	}
	flow := []string{"nowcast (BMKG / OWM)", "→ r_f per road segment", "→ DP weights", "→ existing engine", "→ “+6 min, 80% less rain”"}
	x := 0
	for i, f := range flow {
		if x+runeLen(f) > w {
			y++
			x = 0
		}
		if y >= h {
			break
		}
		col := cText
		if i == 2 {
			col = cGold
		}
		x += c.Text(x, y, f, col) + 1
	}
}

func visNotify(g *guideScreen, a *App, c *Canvas, w, h int, t float64) {
	// a phone-style notification counting down as rain approaches
	phase := math.Mod(t, 12)
	mins := math.Max(0, 15-phase*1.4)
	bw := min(w, 58)
	x0 := (w - bw) / 2
	slide := math.Min(1, phase/0.6)
	by := int(math.Round((slide - 1) * 5))
	done := c.Box(x0, by, bw, 5, cAmber, "")
	if mins >= 1 {
		c.TextA(0, 0, fmt.Sprintf("RAIN ALERT · heavy rain ahead of you in %.0f min", mins), cAmber, attrBold)
	} else {
		c.TextA(0, 0, "RAIN ALERT · you are in heavy rain (19 mm/h)", cAmber, attrBold)
	}
	rich(c, 0, 1, bw-4, 2, "Pull over in about 14 min and put on your «raincoat» before continuing.", cText)
	done()
	// the trip strip below: rain moving toward the rider
	y := 7
	if y+3 >= h {
		return
	}
	sw := w - 2
	c.Text(0, y-1, "trip  0 min", cDim)
	c.TextR(w, y-1, "55 min", cDim)
	rider := int(phase / 12 * float64(sw))
	front := int((0.9 - phase/12*0.35) * float64(sw))
	for x := 0; x < sw; x++ {
		c.Put(x, y, '▀', cMagenta)
		if x >= front {
			c.SetBG(x, y+1, cR4)
		}
	}
	c.Put(rider, y+2, '●', cWhite)
	c.Put(int(0.55*float64(sw)), y+2, '▲', cGold)
	c.Text(0, y+3, "● you   ▲ stop here for the raincoat   rain front moving toward you", cDim)
}

func visLimits(g *guideScreen, a *App, c *Canvas, w, h int, t float64) {
	yes := []string{"rain varies in space", "forecast error (σ, shift)", "mode choice moto vs transit", "shelter per edge (E)", "paired, seeded statistics"}
	no := []string{"rain changing during a trip", "crowding / capacity", "real Jakarta street graph", "E from a user survey", "traffic slowing in rain"}
	cw := w / 2
	c.TextA(0, 0, "modelled", cGreen, attrBold)
	c.TextA(cw, 0, "not modelled (future work)", cAmber, attrBold)
	for i := range yes {
		if 1+i >= h {
			break
		}
		c.Text(0, 1+i, "✓ "+yes[i], cText)
		c.Text(cw, 1+i, "✗ "+no[i], cText)
	}
}

// ---------------------------------------------------------------- slides

func guideSlides() []slide {
	return []slide{
		{"WHY", "Rain changes how people should travel", static(
			"Jakarta's wet season brings short, intense convective storms that are very «local». One district can be dry while the next gets heavy rain.\n\n" +
				"Many trips use «open» modes: motorcycles and ojek, walking to a halte, waiting at a roofed but open BRT stop.\n\n" +
				"Routing apps rank options by «time only». They will happily send you on a motorcycle through a storm when a sheltered rail trip takes almost the same time.\n\n" +
				"«Research question:» can a router trade a few minutes for a large cut in rain exposure, using only a forecast?"), visProblem, 0},
		{"IDEA", "Price rain into every edge of the graph", static(
			"We keep the router (Dijkstra) and change only «how each edge is priced».\n\n" +
				"Every edge gets its normal time cost ‹τ·w_m›, multiplied by a ‹discomfort penalty› that grows with forecast rain, but only as much as that edge is «exposed».\n\n" +
				"Two properties matter:\n" +
				"• «dry = unchanged»: with no rain the cost is exactly the time-only cost.\n" +
				"• «bounded»: even in extreme rain an edge costs at most (1+β·E)× more, so the router never makes absurd detours."), visFormula, 12},
		{"DESIGN", "Five cost functions, one experiment", static(
			"To show the proposed model is «better», not just «different», every journey is routed five times:\n\n" +
				"• ‹A0› is the control: today's routers.\n" +
				"• ‹A1› and ‹A2› are the obvious simpler ideas a reviewer would suggest: a rain threshold and a linear penalty.\n" +
				"• ‹A3› is our Discomfort Penalty.\n" +
				"• ‹A4› is an «ablation». It removes waiting exposure, to test whether that part of the model earns its place. It does not: A4 is at least as good in every seed and setting, so waits are scored but «not priced» in routing.\n\n" +
				"Same journeys, same forecast, same truth. This is a «paired» design."), visVariants, 12},
		{"SYMBOLS", "τ and w_m: time, and how time feels", static(
			"‹τ› (tau) is the travel time of an edge in minutes: walking 1 km, riding between two stops, or waiting for a bus.\n\n" +
				"‹w_m› is the value-of-time weight of the mode. Transport-planning practice weights out-of-vehicle time (walking, waiting) higher than in-vehicle time, because people dislike it more. Meta-analyses (Wardman and co-authors) put this multiplier between about 1.5 and 2. We use the conservative ‹1.5› for walking and waiting and ‹1.0› for riding.\n\n" +
				"«Why it matters:» without w_m the time-only baseline would be unrealistically keen to walk, and every rain result would be measured against a straw man."), visWeights, 12},
		{"SYMBOLS", "E: how exposed is each edge?", static(
			"‹E› (exposure, 0 … 1) says how much of the rain actually reaches the traveller on that edge.\n\n" +
				"• Walking and motorcycle: ‹1.0›, fully in the open.\n" +
				"• Waiting at a BRT halte: ‹0.4›. It has a roof, but sides are open and rain is wind-driven.\n" +
				"• Waiting in a rail station: ‹0.1›, enclosed apart from the access walk.\n" +
				"• Inside a vehicle: ‹0›.\n\n" +
				"⟦These are modelling assumptions, not measurements.⟧ A4 tests one of them, and the same E is used to «score» every variant, so no variant gets an unfair advantage."), visExposure, 12},
		{"SYMBOLS", "r and r_f: real rain vs the forecast", static(
			"‹r› is rain intensity in mm/h. The categories follow Indonesia's BMKG hourly scale: «light» 1–5, «moderate» 5–10, «heavy» 10–20, «very heavy» above 20.\n\n" +
				"The router never sees the true rain. It sees ‹r_f›, a forecast that is:\n" +
				"• «blocky»: averaged over 2×2 km tiles, like a nowcast grid,\n" +
				"• «displaced»: the whole field shifted by ‹shift› km,\n" +
				"• «noisy»: each tile multiplied by a log-normal error ‹σ›.\n\n" +
				"Routes are «chosen» on r_f and «scored» on r. That is the honest way to evaluate a forecast-driven router."), visRain, 0},
		{"SYMBOLS", "φ(r): turning mm/h into discomfort", static(
			"‹φ› maps rain intensity to a discomfort level between 0 and 1, using a logistic (sigmoid) curve with two parameters:\n\n" +
				"• ‹r0›, the «midpoint»: the intensity where discomfort is half way (default 5 mm/h, the BMKG light/moderate boundary).\n" +
				"• ‹k›, the «steepness»: how quickly discomfort rises around r0 (default 0.74).\n\n" +
				"The raw sigmoid σ(0) is slightly above 0, so we «normalise»: φ(r) = (σ(r) − σ(0)) / (1 − σ(0)). This guarantees ‹φ(0) = 0›, so dry edges are untouched.\n\n" +
				"Reference values: φ(1)=0.03, φ(5)=0.49, φ(7.5)=0.86, φ(10)=0.98."), visPhi, 0},
		{"WHY THIS", "Why a sigmoid, not a threshold or a line?", static(
			"The white dot is a forecast jittering ±30 % around r0, as real forecasts do.\n\n" +
				"• ‹A1 threshold› jumps between ×1 and ×(1+β). A tiny forecast error flips the whole route, so decisions look random near r0.\n" +
				"• ‹A2 linear› ignores everything below r0 and grows «without limit». One 40 mm/h tile can dominate a whole trip.\n" +
				"• ‹A3 sigmoid› is «smooth», so small errors cause small changes. It is «bounded», because being soaked is being soaked. It is «graded», so drizzle counts a little.\n\n" +
				"See it for real in Cases 4 and 5."), visCompare, 0},
		{"SYMBOLS", "β: the traveller's trade-off", func(a *App) string {
			return "‹β› (beta) is the weight of the discomfort term, i.e. «how much this person minds rain».\n\n" +
				"• ‹β = 0›: DP is switched off and the router is identical to A0.\n" +
				"• ‹β = 1› (default): a minute fully exposed in heavy rain feels like «two» dry minutes.\n" +
				"• ‹β = 4›: rain-averse, worth a much longer detour.\n\n" +
				"In an app, β is a «user preference slider»: a commuter in a suit and a student with a raincoat want different answers.\n\n" +
				fmt.Sprintf("Current β = ‹%.2f›. The Trade-off screen sweeps β ∈ {0 … 8} to show the full time-vs-rain curve.", a.params.Beta)
		}, visBeta, 20},
		{"DATA", "The synthetic city", static(
			"The experiment runs on a «controlled» synthetic city, so the true rain on every edge is known exactly:\n\n" +
				"• 30 × 16 km lattice with separate «walk» (5 km/h) and «motorcycle» (22 km/h) layers, with seeded random link-time variation.\n" +
				"• ‹11 BRT› lines (20 km/h, 4 min wait, open haltes) and ‹2 rail› lines (40 km/h, 6 min wait incl. access).\n" +
				"• Each journey: a random origin and destination at least 8 km apart, with 1–3 Gaussian storm cells (10–40 mm/h peak) near the corridor.\n\n" +
				"The «Data» screen shows the actual distributions."), visCity, 0},
		{"HOW", "How a route is chosen", static(
			"For every journey and every variant:\n\n" +
				"1. Look up the «forecast» rain at every edge.\n" +
				"2. «Price» every edge with that variant's cost function.\n" +
				"3. Run «Dijkstra twice»: door-to-door motorcycle, and walk + BRT + rail.\n" +
				"4. Take the cheaper option. This is the «mode choice».\n" +
				"5. Score the chosen path on the «true» rain.\n\n" +
				"On the Cases screen press ‹s› to «watch» step 3. The search front visibly flows around a storm."), visPipeline, 12},
		{"AHEAD", "Rain that has not arrived yet", static(
			"Storms «move». Pricing edges on the rain «right now» is not enough:\n\n" +
				"• A route that is dry now can be under a storm in 20 minutes.\n" +
				"• A storm over the route now may be gone before you get there. Dodging it can even put you «into» its path.\n\n" +
				"So the router looks up each edge's rain «at the minute you will reach it», using the storm's motion as a nowcast would predict it.\n\n" +
				"When rain is unavoidable, the system «warns you ahead of time»: \"rain ahead of you in 15 min, pull over and put on your raincoat\". It uses the same E, so you are not warned while inside a train.\n\n" +
				"Try it on the «Rain alert» screen."), visNotify, 10},
		{"MEASURE", "What we measure", static(
			"• ‹T› is travel time in minutes. The «cost» of being weather-aware.\n" +
				"• ‹D› is «rain dose», D = Σ τ·E·r_true / 60, in mm of rain received. The main outcome.\n" +
				"• «Exposed minutes» is time on exposed edges where true rain ≥ r0.\n" +
				"• «Moto share» and «reroute share» show how behaviour changes.\n" +
				"• ‹Precision / recall / F1› ask: when a drier route really existed (oracle = A3 on true rain), did the forecast router find it? When it rerouted, was it worth it?\n\n" +
				"Dose reduction is reported «relative to A0» on the same journeys."), visMeasure, 16},
		{"EVIDENCE", "Is the difference real?", static(
			"Each journey gives five «paired» doses, one per variant, and doses are skewed with many zeros. So we use «non-parametric, paired» tests:\n\n" +
				"1. ‹Friedman› asks whether any variant differs.\n" +
				"2. ‹Wilcoxon signed-rank›, A3 vs each other variant, asks which ones.\n" +
				"3. ‹Holm› correction, because we test 4 times. It controls the family-wise error.\n" +
				"4. ‹Bootstrap› 95 % CIs, 2000 resamples, answer «how big» the effect is, not just whether it exists.\n\n" +
				"All randomness is seeded: the same seed gives the same numbers."), visStats, 12},
		{"IMPACT", "Why apps should adopt it", static(
			"• «Tiny change»: one multiply per edge, inside an edge-weight function the engine already has. No new algorithm, no new data structures.\n" +
				"• «Safe by construction»: dry weather or β = 0 gives exactly today's routes.\n" +
				"• «Fast»: same Dijkstra, same complexity (see the Bench screen).\n" +
				"• «Personal»: β is a user setting.\n" +
				"• «Explainable»: \"+6 min, 80 % less rain\" is a message users understand.\n" +
				"• «Uses data that already exists»: BMKG / OpenWeatherMap nowcasts.\n\n" +
				"For a rain-heavy, motorcycle-heavy city this is a «comfort and safety» feature."), visApps, 12},
		{"HONESTY", "What this model does not claim", static(
			"A reviewer will ask about limits, so we state them first:\n\n" +
				"• The city is «synthetic». It isolates the cost model from map-data noise, but it is not Jakarta's real network.\n" +
				"• E values and w_m are «assumptions». The sensitivity grid shows the ranking holds, and a stated-preference survey would calibrate them.\n" +
				"• In the main experiment rain is static during a trip. The moving-storm experiment relaxes this with simple advection, not a real nowcast.\n" +
				"• No crowding or rain-induced traffic slowdown.\n" +
				"• Results vary by seed. They are «not» the paper's original run.\n\n" +
				"⟦Next:⟧ the «Symbols» screen has a reference card for every variable."), visLimits, 8},
	}
}
