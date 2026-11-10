package ui

import (
	"fmt"
	"math"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"

	"wmptrs-sim/internal/model"
	"wmptrs-sim/internal/sim"
)

var familyColor = map[string]uint8{"A3": cRain, "A1": cAmber, "A2": cMagenta}
var familyName = map[string]string{"A3": "DP", "A1": "threshold", "A2": "linear α×β"}

type tradeoffScreen struct {
	reveal Spring
	ver    int
	sel    int
	p      plot
	kb     struct{ sel, rerun key.Binding }
}

func newTradeoff() *tradeoffScreen {
	s := &tradeoffScreen{reveal: newSpring(1.6, 1), ver: -1, sel: 3}
	s.kb.sel = key.NewBinding(key.WithKeys("left", "right"), key.WithHelp("←→", "β"))
	s.kb.rerun = key.NewBinding(key.WithKeys("s"), key.WithHelp("s", "re-sweep"))
	return s
}

func (s *tradeoffScreen) title() string       { return "Trade-off" }
func (s *tradeoffScreen) captures() bool      { return false }
func (s *tradeoffScreen) keys() []key.Binding { return []key.Binding{s.kb.sel, s.kb.rerun} }

func (s *tradeoffScreen) enter(a *App) tea.Cmd {
	s.reveal.Jump(0)
	s.ver = -1
	if !a.sweepRunning && (a.sweep == nil || a.sweepFor != a.params) {
		return a.startSweep()
	}
	return nil
}

func (s *tradeoffScreen) update(a *App, msg tea.KeyMsg) tea.Cmd {
	switch msg.String() {
	case "left":
		s.sel = (s.sel + len(sim.SweepBetas) - 1) % len(sim.SweepBetas)
	case "right":
		s.sel = (s.sel + 1) % len(sim.SweepBetas)
	case "s":
		if !a.sweepRunning {
			s.reveal.Jump(0)
			return a.startSweep()
		}
	}
	return nil
}

func (s *tradeoffScreen) tick(a *App, steps int) bool {
	if a.sweep == nil {
		return false
	}
	if s.ver != a.sweepVer {
		s.ver = a.sweepVer
		s.reveal.Jump(0)
	}
	s.reveal.Target = 1
	return s.reveal.Step(steps)
}

func (s *tradeoffScreen) series(a *App, fam string) []sim.SweepPoint {
	var out []sim.SweepPoint
	for _, p := range a.sweep {
		if p.Family == fam {
			out = append(out, p)
		}
	}
	return out
}

func (s *tradeoffScreen) draw(a *App, c *Canvas, w, h int) {
	rw := 34
	cw := w - rw
	done := c.Box(0, 0, cw, h, cBorder, "Dose reduction vs time increase, β sweep")
	if a.sweep == nil {
		msg := "starting sweep…"
		if a.sweepRunning {
			msg = fmt.Sprintf("%s sweeping β × 3 families… %d / %d journeys", a.spinner(), a.sweepDone.Load(), a.sweepTotal.Load())
		}
		c.TextC(0, h/2-1, cw-4, msg, cText, 0)
		done()
		s.drawSide(a, c, cw, rw, h)
		return
	}
	xmax, ymax := 1.0, 1.0
	xmin, ymin := 0.0, 0.0
	for _, p := range a.sweep {
		xmax, ymax = math.Max(xmax, p.TimeIncPct), math.Max(ymax, p.DoseRedPct)
		xmin, ymin = math.Min(xmin, p.TimeIncPct), math.Min(ymin, p.DoseRedPct)
	}
	xmax, ymax = math.Ceil(xmax*1.05/5)*5, math.Ceil(ymax*1.08/5)*5
	if xmin < 0 {
		xmin = -niceCeil(-xmin)
	}
	if ymin < 0 {
		ymin = -niceCeil(-ymin)
	}
	ticks := func(lo, hi float64) []float64 {
		step := niceCeil((hi - lo) / 4)
		var t []float64
		for v := math.Ceil(lo/step) * step; v <= hi+1e-9; v += step {
			t = append(t, v)
		}
		return t
	}
	pct := func(v float64) string { return fmt.Sprintf("%.0f%%", v) }
	s.p.setup(c, cw-4, h-3, xmin, xmax, ymin, ymax, ticks(xmin, xmax), ticks(ymin, ymax), pct, pct)
	for _, fam := range []string{"A2", "A1", "A3"} {
		pts := s.series(a, fam)
		col := familyColor[fam]
		segs := s.reveal.Pos * float64(len(pts)-1)
		for i := 1; i < len(pts); i++ {
			f := segs - float64(i-1)
			if f <= 0 {
				break
			}
			f = math.Min(f, 1)
			p0, p1 := pts[i-1], pts[i]
			s.p.line(p0.TimeIncPct, p0.DoseRedPct,
				p0.TimeIncPct+(p1.TimeIncPct-p0.TimeIncPct)*f, p0.DoseRedPct+(p1.DoseRedPct-p0.DoseRedPct)*f, col)
		}
		for i, p := range pts {
			if float64(i) <= segs+1e-9 && i == s.sel {
				s.p.marker(p.TimeIncPct, p.DoseRedPct, cWhite)
			}
		}
	}
	s.p.blit(c)
	if s.reveal.Pos > 0.98 {
		if pts := s.series(a, "A3"); s.sel < len(pts) {
			x, y := s.p.cellOf(pts[s.sel].TimeIncPct, pts[s.sel].DoseRedPct)
			c.Text(x+2, max(y-1, 0), fmt.Sprintf("β=%g", pts[s.sel].Beta), cWhite)
		}
	}
	c.Text(0, h-3, "x: time ↑   y: rain dose ↓   (totals vs A0)", cDim)
	done()
	s.drawSide(a, c, cw, rw, h)
}

func (s *tradeoffScreen) drawSide(a *App, c *Canvas, x, w, h int) {
	done := c.Box(x, 0, w, h, cBorderHi, fmt.Sprintf("β = %g", sim.SweepBetas[s.sel]))
	y := 0
	c.Text(0, y, "family         dose↓  time↑", cDim)
	y++
	for _, fam := range []model.Variant{model.A3, model.A1, model.A2} {
		name := fam.String()
		c.Text(0, y, "━", familyColor[name])
		c.Text(2, y, fmt.Sprintf("%s %-10s", name, familyName[name]), cText)
		if a.sweep != nil {
			if pts := s.series(a, name); s.sel < len(pts) {
				p := pts[s.sel]
				c.Text(16, y, fmt.Sprintf("%5.1f%% %5.1f%%", p.DoseRedPct, p.TimeIncPct), cText)
			}
		}
		y++
	}
	y++
	c.Text(0, y, "moto share at this β", cDim)
	y++
	if a.sweep != nil {
		for _, fam := range []string{"A3", "A1", "A2"} {
			if pts := s.series(a, fam); s.sel < len(pts) {
				c.Text(0, y, fmt.Sprintf(" %s %3.0f%%", fam, 100*pts[s.sel].MotoShare), familyColor[fam])
				y++
			}
		}
	}
	y++
	for _, line := range wrap("Same journeys and forecasts at every β; only the cost function changes. A2 has no β, so its α coefficients are scaled by the same factors.", w-4) {
		if y >= h-3 {
			break
		}
		c.Text(0, y, line, cDim)
		y++
	}
	c.Text(0, h-3, fmt.Sprintf("%d journeys · seed %d", a.sweepFor.Journeys, a.sweepFor.Seed), cFaint)
	done()
}
