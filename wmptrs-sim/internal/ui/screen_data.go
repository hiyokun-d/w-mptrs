package ui

import (
	"fmt"
	"math"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"

	"wmptrs-sim/internal/model"
	"wmptrs-sim/internal/sim"
)

// dataStats are distributions derived from the current run, cached per run.
type dataStats struct {
	ver                 int
	dist, peak, cells   []int
	dose0               []int
	fcErr               []int // log2(r_f / r) on A0-path edges with r ≥ 1
	fcTP, fcFP, fcFN    int   // forecast vs truth on "r ≥ r0", A0-path edges
	fcTN                int
	red3                []int // per-journey A3 dose reduction %, exposed journeys
	dtime3              []int // per-journey A3 time change, minutes
	shift               [2][2]int
	maxDose             float64
	exposedN, journeysN int
}

const (
	nBins = 16
)

func binOf(v, lo, hi float64, n int) int {
	return min(max(int((v-lo)/(hi-lo)*float64(n)), 0), n-1)
}

func computeData(res *sim.Result, r0 float64) *dataStats {
	d := &dataStats{
		dist: make([]int, nBins), peak: make([]int, nBins), cells: make([]int, 3),
		dose0: make([]int, nBins), fcErr: make([]int, nBins), red3: make([]int, nBins), dtime3: make([]int, nBins),
	}
	net := res.Net
	for _, j := range res.Journeys {
		d.maxDose = math.Max(d.maxDose, j.Out[0].Dose)
	}
	d.maxDose = niceCeil(math.Max(d.maxDose, 1))
	for _, j := range res.Journeys {
		d.journeysN++
		d.dist[binOf(math.Hypot(float64(j.DX-j.OX), float64(j.DY-j.OY)), 8, 34, nBins)]++
		d.cells[min(len(j.Cells), 3)-1]++
		for _, c := range j.Cells {
			d.peak[binOf(c.Peak, 10, 40, nBins)]++
		}
		o0, o3 := j.Out[0], j.Out[model.A3]
		d.dose0[binOf(o0.Dose, 0, d.maxDose, nBins)]++
		d.shift[b2i(!o0.Moto)][b2i(!o3.Moto)]++
		if o0.Dose > 0.01 {
			d.exposedN++
			d.red3[binOf(100*(1-o3.Dose/o0.Dose), -40, 100, nBins)]++
			d.dtime3[binOf(o3.T-o0.T, -8, 24, nBins)]++
		}
		fc := sim.NewForecast(j.Cells, j.ShiftX, j.ShiftY, &j.Noise)
		for _, e := range o0.Path {
			if net.Kind[e].Exposure() == 0 {
				continue
			}
			rt := sim.RainAt(j.Cells, net.MidX[e], net.MidY[e], 0, 0)
			rf := fc.At(net.MidX[e], net.MidY[e])
			if rt >= 1 {
				d.fcErr[binOf(math.Log2(math.Max(rf, 1e-3)/rt), -3, 3, nBins)]++
			}
			switch {
			case rf >= r0 && rt >= r0:
				d.fcTP++
			case rf >= r0:
				d.fcFP++
			case rt >= r0:
				d.fcFN++
			default:
				d.fcTN++
			}
		}
	}
	return d
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

type dataScreen struct {
	page int
	st   *dataStats
	text scrollText
	k    struct{ page, scroll key.Binding }
}

var dataPages = []string{"Network & constants", "Journeys & storms", "Forecast error", "Outcomes per journey"}

func newData() *dataScreen {
	s := &dataScreen{}
	s.k.page = key.NewBinding(key.WithKeys("left", "right"), key.WithHelp("←→", "page"))
	s.k.scroll = key.NewBinding(key.WithKeys("pgdown", "pgup"), key.WithHelp("pgdn/up", "scroll"))
	return s
}

func (s *dataScreen) title() string       { return "Data" }
func (s *dataScreen) captures() bool      { return false }
func (s *dataScreen) keys() []key.Binding { return []key.Binding{s.k.page, s.k.scroll} }
func (s *dataScreen) enter(a *App) tea.Cmd {
	if a.result == nil && !a.running {
		return a.startRun()
	}
	return nil
}

func (s *dataScreen) update(a *App, msg tea.KeyMsg) tea.Cmd {
	ks := msg.String()
	if s.text.key(ks) {
		return nil
	}
	switch ks {
	case "left", "h":
		s.page = (s.page + len(dataPages) - 1) % len(dataPages)
		s.text.off = 0
	case "right", "l":
		s.page = (s.page + 1) % len(dataPages)
		s.text.off = 0
	}
	return nil
}

func (s *dataScreen) tick(a *App, steps int) bool {
	if a.result != nil && (s.st == nil || s.st.ver != a.resultVer) {
		s.st = computeData(a.result, a.result.Params.R0)
		s.st.ver = a.resultVer
	}
	return false
}

func (s *dataScreen) draw(a *App, c *Canvas, w, h int) {
	if a.result != nil && (s.st == nil || s.st.ver != a.resultVer) {
		s.tick(a, 0)
	}
	// page tabs
	x := 0
	for i, p := range dataPages {
		label := fmt.Sprintf(" %d %s ", i+1, p)
		if i == s.page {
			x += c.TextA(x, 0, label, cWhite, attrRev|attrBold)
		} else {
			x += c.Text(x, 0, label, cDim)
		}
		x++
	}
	top := 1
	bh := h - top
	var vw, tw int
	side := w >= 100
	if side {
		vw = w * 58 / 100
		tw = w - vw
	} else {
		vw, tw = w, w
	}
	vh := bh
	if !side {
		vh = bh * 3 / 5
	}
	done := c.Box(0, top, vw, vh, cBorder, dataPages[s.page])
	iw, ih := vw-4, vh-2
	var text string
	if s.page > 0 && s.st == nil {
		c.Text(0, 0, "waiting for a run… (press r)", cDim)
		text = "These pages are computed from the «current run», so they always match the Results screen."
	} else {
		switch s.page {
		case 0:
			text = s.network(a, c, iw, ih)
		case 1:
			text = s.journeys(a, c, iw, ih)
		case 2:
			text = s.forecast(a, c, iw, ih)
		case 3:
			text = s.outcomes(a, c, iw, ih)
		}
	}
	done()
	if side {
		done = c.Box(vw, top, tw, bh, cBorderHi, "Why this matters")
		s.text.draw(c, tw-4, bh-2, text)
	} else {
		done = c.Box(0, top+vh, tw, bh-vh, cBorderHi, "Why this matters")
		s.text.draw(c, tw-4, bh-vh-2, text)
	}
	done()
}

func (s *dataScreen) network(a *App, c *Canvas, w, h int) string {
	net := a.net
	counts := map[model.Kind]int{}
	for e := 0; e < net.NumEdges(); e++ {
		counts[net.Kind[e]]++
	}
	c.Text(0, 0, fmt.Sprintf("%d nodes · %d directed edges · %d lines", net.NumNodes, net.NumEdges(), len(net.Lines)), cText)
	y := 2
	kinds := []model.Kind{model.Walk, model.Moto, model.WaitBRT, model.WaitRail, model.RideBus, model.RideRail, model.Alight}
	mx := 0
	for _, k := range kinds {
		mx = max(mx, counts[k])
	}
	bw := max(6, w-26)
	for _, k := range kinds {
		if y >= h {
			break
		}
		c.Text(0, y, fmt.Sprintf("%-9s", k), kindColor[k])
		hbar(c, 10, y, bw, float64(counts[k])/float64(mx), kindColor[k])
		c.Text(11+bw, y, fmt.Sprintf("%5d  E=%.1f", counts[k], k.Exposure()), cDim)
		y++
	}
	y++
	rows := []struct{ name, val, src string }{
		{"walk speed", "5 km/h", "typical pedestrian"},
		{"moto speed", "22 km/h", "assumed urban avg"},
		{"BRT speed/wait", "20 km/h · 4 min", "½ of 8-min headway"},
		{"rail speed/wait", "40 km/h · 6 min", "incl. station access"},
		{"w_m walk/wait", "1.5", "VoT meta-analyses: 1.5–2"},
		{"E values", "1 / .4 / .1 / 0", "assumption (A4 tests)"},
		{"r0", fmt.Sprintf("%g mm/h", a.params.R0), "BMKG light/moderate"},
		{"k", fmt.Sprintf("%g", a.params.K), "design: 10–90% ≈ 2–8 mm/h"},
		{"storm peak", "10–40 mm/h", "heavy convective cells"},
		{"forecast tile", "2 × 2 km", "nowcast-grid scale"},
	}
	if y < h {
		c.Text(0, y, fmt.Sprintf("%-16s %-17s %s", "constant", "value", "source"), cDim)
		y++
	}
	for _, r := range rows {
		if y >= h {
			break
		}
		c.Text(0, y, fmt.Sprintf("%-16s", r.name), cText)
		c.Text(17, y, fmt.Sprintf("%-17s", r.val), cGold)
		c.Text(35, y, trunc(r.src, max(w-35, 2)), cDim)
		y++
	}
	return "Every constant in the model is listed here with its «source», so a reviewer can see what is «measured convention» and what is a «modelling assumption».\n\n" +
		"• ‹Speeds and waits› are plausible urban values, the same for every variant. They set the dry-weather baseline, not the result.\n" +
		"• ‹r0› is tied to the BMKG category boundary, so it is not tuned to make A3 win.\n" +
		"• ⟦E values are assumptions.⟧ The A4 ablation and the β sweep show how much the conclusions depend on them.\n\n" +
		"The graph keeps walk and motorcycle layers separate, so a traveller cannot park a motorcycle mid-trip. Transit stops connect only to the walk layer."
}

func histPanel(c *Canvas, x, y, w, h int, title string, counts []int, lo, hi string, col uint8) {
	c.Text(x, y, title, cText)
	histogram(c, x, y+1, w, h-2, counts, col)
	c.Text(x, y+h-1, lo, cDim)
	c.TextR(x+w, y+h-1, hi, cDim)
}

func (s *dataScreen) journeys(a *App, c *Canvas, w, h int) string {
	st := s.st
	hw := w/2 - 1
	ph := max(4, h/2)
	histPanel(c, 0, 0, hw, ph, "OD distance (km)", st.dist, "8", "34", cRain)
	histPanel(c, hw+2, 0, hw, ph, "storm peak (mm/h)", st.peak, "10", "40", cAmber)
	if h-ph >= 4 {
		histPanel(c, 0, ph, hw, h-ph, "A0 rain dose (mm)", st.dose0, "0", fmt.Sprintf("%g", st.maxDose), cMagenta)
		c.Text(hw+2, ph, "storm cells per journey", cText)
		for i, n := range st.cells {
			y := ph + 2 + i
			if y >= h {
				break
			}
			c.Text(hw+2, y, fmt.Sprintf("%d", i+1), cDim)
			hbar(c, hw+4, y, hw-10, float64(n)/float64(max(st.journeysN, 1)), cRain)
			c.TextR(hw+2+hw, y, fmt.Sprintf("%d", n), cDim)
		}
	}
	return fmt.Sprintf("These are the «%d journeys» of the current run (seed %d).\n\n", st.journeysN, a.result.Params.Seed) +
		"• Origins and destinations are at least ‹8 km› apart, the trips where mode choice matters.\n" +
		"• Storm cells are placed «near the corridor», so most journeys meet some rain. " +
		fmt.Sprintf("Here ‹%d of %d› journeys get wet under A0.\n", st.exposedN, st.journeysN) +
		"• Peaks of 10–40 mm/h represent convective storms from heavy to very heavy.\n\n" +
		"⟦Why sample this way?⟧ Uniformly random rain would leave most trips dry and dilute every effect toward zero. We measure the method «where it can act», and report how many journeys were exposed."
}

func (s *dataScreen) forecast(a *App, c *Canvas, w, h int) string {
	st := s.st
	ph := max(5, h-6)
	histPanel(c, 0, 0, w, ph, "log2(forecast / truth) on exposed A0-route edges with rain ≥ 1 mm/h", st.fcErr, "÷8", "×8", cAmber)
	mid := w / 2
	c.Put(mid, ph-1, '┴', cFaint)
	c.Text(mid-2, ph-1, " =1 ", cDim)
	y := ph + 1
	tot := max(st.fcTP+st.fcFP+st.fcFN+st.fcTN, 1)
	if y+3 < h+1 {
		c.Text(0, y, fmt.Sprintf("edge says r ≥ r0?   truth yes   truth no"), cDim)
		c.Text(0, y+1, fmt.Sprintf("forecast yes        %6.1f%%    %6.1f%%", pct(st.fcTP, tot), pct(st.fcFP, tot)), cText)
		c.Text(0, y+2, fmt.Sprintf("forecast no         %6.1f%%    %6.1f%%", pct(st.fcFN, tot), pct(st.fcTN, tot)), cText)
	}
	p := a.result.Params
	return fmt.Sprintf("The router sees a forecast with ‹σ = %.2f› intensity noise and ‹%.2f km› displacement.\n\n", p.Sigma, p.Shift) +
		"The histogram shows how wrong the forecast is «on the edges the traveller actually uses». The centre means exact. Each step out doubles or halves the rain.\n\n" +
		"The table shows how often the forecast puts an edge on the «wrong side of r0». That is exactly where threshold router A1 flips its decision. The smooth A3 penalty changes only a little there.\n\n" +
		"Try the «High error» preset (Params, key 3), re-run, and come back."
}

func pct(n, tot int) float64 { return 100 * float64(n) / float64(tot) }

func (s *dataScreen) outcomes(a *App, c *Canvas, w, h int) string {
	st := s.st
	hw := w/2 - 1
	ph := max(4, h-6)
	histPanel(c, 0, 0, hw, ph, "A3 dose cut per journey (%)", st.red3, "−40", "100", cGreen)
	histPanel(c, hw+2, 0, hw, ph, "A3 extra minutes", st.dtime3, "−8", "+24", cAmber)
	y := ph + 1
	if y+3 <= h {
		c.Text(0, y, "mode A0 → A3   to moto   to transit", cDim)
		c.Text(0, y+1, fmt.Sprintf("from moto      %7d   %10d", st.shift[0][0], st.shift[0][1]), cText)
		c.Text(0, y+2, fmt.Sprintf("from transit   %7d   %10d", st.shift[1][0], st.shift[1][1]), cText)
	}
	return "Averages hide a lot, so here is the «per-journey» picture for A3 against A0 on the rain-exposed journeys.\n\n" +
		"• Most journeys sit at a «large dose cut»: the router found a drier option.\n" +
		"• A bar at «0 %» means no drier route was worth it. DP does not force detours.\n" +
		"• «Negative» cuts are forecast errors: the router avoided rain that was not there and met rain that was.\n\n" +
		"The mode table shows the «modal shift»: how many motorcycle trips moved to sheltered transit. This is the behaviour a city would see if apps adopted DP."
}
