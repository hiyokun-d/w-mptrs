package ui

import (
	"fmt"
	"math"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"

	"wmptrs-sim/internal/model"
)

const phiRmax = 25.0

type phiScreen struct {
	r0, k, beta, cursor Spring
	cursorT             float64
	cmpOverlay          bool
	init                bool
	p                   plot
	kb                  struct{ r0, k, beta, cur, cmp key.Binding }
}

func newPhi() *phiScreen {
	s := &phiScreen{
		r0: newSpring(6, 0.8), k: newSpring(6, 0.8), beta: newSpring(6, 0.8), cursor: newSpring(9, 0.9),
		cursorT: 7.5, cmpOverlay: true,
	}
	s.kb.r0 = key.NewBinding(key.WithKeys("left", "right"), key.WithHelp("←→", "r0"))
	s.kb.k = key.NewBinding(key.WithKeys("up", "down"), key.WithHelp("↑↓", "k"))
	s.kb.beta = key.NewBinding(key.WithKeys("+", "-", "="), key.WithHelp("+/-", "β"))
	s.kb.cur = key.NewBinding(key.WithKeys("[", "]"), key.WithHelp("[ ]", "cursor"))
	s.kb.cmp = key.NewBinding(key.WithKeys("c"), key.WithHelp("c", "A1/A2 overlay"))
	return s
}

func (s *phiScreen) title() string  { return "φ explorer" }
func (s *phiScreen) captures() bool { return false }
func (s *phiScreen) keys() []key.Binding {
	return []key.Binding{s.kb.r0, s.kb.k, s.kb.beta, s.kb.cur, s.kb.cmp}
}

func (s *phiScreen) enter(a *App) tea.Cmd {
	if !s.init {
		s.init = true
		s.r0.Jump(a.params.R0)
		s.k.Jump(0.05)
		s.beta.Jump(a.params.Beta)
		s.cursor.Jump(s.cursorT)
	}
	return nil
}

func clamp(v, lo, hi float64) float64 { return math.Min(math.Max(v, lo), hi) }

func (s *phiScreen) update(a *App, msg tea.KeyMsg) tea.Cmd {
	p := &a.params
	switch msg.String() {
	case "left":
		p.R0 = clamp(p.R0-0.5, 1, 15)
	case "right":
		p.R0 = clamp(p.R0+0.5, 1, 15)
	case "up":
		p.K = math.Round(clamp(p.K+0.05, 0.1, 3)*100) / 100
	case "down":
		p.K = math.Round(clamp(p.K-0.05, 0.1, 3)*100) / 100
	case "+", "=":
		p.Beta = clamp(p.Beta+0.25, 0, 8)
	case "-":
		p.Beta = clamp(p.Beta-0.25, 0, 8)
	case "[":
		s.cursorT = clamp(s.cursorT-0.5, 0, phiRmax)
	case "]":
		s.cursorT = clamp(s.cursorT+0.5, 0, phiRmax)
	case "c":
		s.cmpOverlay = !s.cmpOverlay
	}
	return nil
}

func (s *phiScreen) tick(a *App, steps int) bool {
	s.r0.Target, s.k.Target, s.beta.Target, s.cursor.Target = a.params.R0, a.params.K, a.params.Beta, s.cursorT
	m := s.r0.Step(steps)
	m = s.k.Step(steps) || m
	m = s.beta.Step(steps) || m
	return s.cursor.Step(steps) || m
}

var exposureClasses = []struct {
	name string
	kind model.Kind
	col  uint8
}{
	{"walk / moto", model.Walk, cMagenta},
	{"BRT wait", model.WaitBRT, cRain},
	{"rail wait", model.WaitRail, cGold},
	{"in-vehicle", model.RideBus, cDim},
}

func (s *phiScreen) draw(a *App, c *Canvas, w, h int) {
	rw := 30
	cw := w - rw
	mp := model.Params{Beta: s.beta.Pos, R0: s.r0.Pos, K: math.Max(s.k.Pos, 0.01), AlphaScale: 1}
	done := c.Box(0, 0, cw, h, cBorder, "Cost multiplier vs rain intensity (mm/h)")
	ymax := 1 + math.Max(mp.Beta, 0.5)*1.08
	ystep := niceCeil((ymax - 1) / 4)
	var yt []float64
	for v := 1.0; v <= ymax+1e-9; v += ystep {
		yt = append(yt, v)
	}
	s.p.setup(c, cw-4, h-2, 0, phiRmax, 1, ymax, []float64{0, 5, 10, 15, 20, 25}, yt,
		func(v float64) string { return fmt.Sprintf("%.0f", v) },
		func(v float64) string { return fmt.Sprintf("×%.2g", v) })
	s.p.vline(mp.R0, cFaint)
	s.p.vline(s.cursor.Pos, cBorderHi)
	if s.cmpOverlay {
		s.p.fn(func(r float64) float64 {
			if r >= mp.R0 {
				return 1 + mp.Beta
			}
			return 1
		}, cAmber)
		s.p.fn(func(r float64) float64 { return 1 + 0.065*math.Max(0, r-mp.R0) }, cRed)
	}
	for i := len(exposureClasses) - 1; i >= 0; i-- {
		e := exposureClasses[i].kind.Exposure()
		s.p.fn(func(r float64) float64 { return 1 + mp.Beta*e*model.Phi(r, mp) }, exposureClasses[i].col)
	}
	s.p.blit(c)
	cx, _ := s.p.cellOf(mp.R0, 1)
	c.Text(cx+1, 0, "r0", cDim)
	done()

	// readouts use the exact (target) parameters
	tp := model.Params{Beta: a.params.Beta, R0: a.params.R0, K: a.params.K, AlphaScale: 1}
	done = c.Box(cw, 0, rw, h, cBorderHi, "Parameters")
	y := 0
	c.Text(0, y, fmt.Sprintf("β %.2f  r0 %.1f  k %.2f", tp.Beta, tp.R0, tp.K), cWhite)
	y += 2
	c.Text(0, y, "φ at reference points", cDim)
	y++
	for _, r := range []float64{1, 5, 7.5, 10} {
		c.Text(0, y, fmt.Sprintf(" %-7s = %.2f", fmt.Sprintf("φ(%g)", r), model.Phi(r, tp)), cText)
		y++
	}
	y++
	c.Text(0, y, fmt.Sprintf("at r = %.1f mm/h  (1+βEφ)", s.cursorT), cDim)
	y++
	for _, ec := range exposureClasses {
		c.Text(0, y, "━", ec.col)
		c.Text(2, y, fmt.Sprintf("%-11s ×%.2f", ec.name, model.A3.Cost(1, ec.kind, s.cursorT, tp)/ec.kind.Weight()), cText)
		y++
	}
	if s.cmpOverlay && y+2 < h-2 {
		y++
		c.Text(0, y, "━", cAmber)
		c.Text(2, y, "A1 threshold (E>0)", cDim)
		y++
		c.Text(0, y, "━", cRed)
		c.Text(2, y, "A2 linear, moto", cDim)
		y++
	}
	if y+1 < h-2 {
		c.Text(0, h-3, "changes apply to next run", cAmber)
	}
	done()
}
