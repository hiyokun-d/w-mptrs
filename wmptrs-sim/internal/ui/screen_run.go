package ui

import (
	"fmt"
	"math"
	"time"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"

	"wmptrs-sim/internal/model"
	"wmptrs-sim/internal/sim"
)

const routeDrawSecs = 0.9

type runScreen struct {
	m         cityMap
	cur       *sim.Journey
	browse    int // index into result journeys when browsing
	drawStart float64
	cmp       int
	forecast  bool
	bar       Spring
	k         struct{ browse, fc, cmp key.Binding }
}

func newRunScreen() *runScreen {
	s := &runScreen{cmp: int(model.A3), bar: newSpring(6, 0.9)}
	s.k.browse = key.NewBinding(key.WithKeys("left", "right", "h", "l"), key.WithHelp("←→", "journey"))
	s.k.fc = key.NewBinding(key.WithKeys("f"), key.WithHelp("f", "truth/forecast"))
	s.k.cmp = key.NewBinding(key.WithKeys("v"), key.WithHelp("v", "variant"))
	return s
}

func (s *runScreen) title() string       { return "Run" }
func (s *runScreen) captures() bool      { return false }
func (s *runScreen) keys() []key.Binding { return []key.Binding{s.k.browse, s.k.fc, s.k.cmp} }
func (s *runScreen) enter(a *App) tea.Cmd {
	if !a.running && a.result == nil {
		return a.startRun()
	}
	return nil
}

func (s *runScreen) show(a *App, j *sim.Journey) {
	s.cur, s.drawStart = j, a.t
}

func (s *runScreen) update(a *App, msg tea.KeyMsg) tea.Cmd {
	switch msg.String() {
	case "left", "h", "right", "l":
		if a.result == nil || len(a.result.Journeys) == 0 {
			return nil
		}
		n := len(a.result.Journeys)
		if s.cur != nil {
			s.browse = s.cur.Index
		}
		if msg.String() == "left" || msg.String() == "h" {
			s.browse = (s.browse + n - 1) % n
		} else {
			s.browse = (s.browse + 1) % n
		}
		s.show(a, &a.result.Journeys[s.browse])
	case "f":
		s.forecast = !s.forecast
	case "v":
		s.cmp = s.cmp%int(model.A4) + 1
		s.drawStart = a.t
	}
	return nil
}

func (s *runScreen) tick(a *App, steps int) bool {
	if a.runTotal > 0 {
		s.bar.Target = float64(a.runDone) / float64(a.runTotal)
	} else {
		s.bar.Target = 0
	}
	if a.running && len(a.arrived) > 0 {
		latest := a.arrived[len(a.arrived)-1]
		if s.cur == nil || (a.t-s.drawStart > routeDrawSecs+0.35 && latest != s.cur) {
			s.show(a, latest)
		}
	}
	if !a.running && a.result != nil && s.cur != nil && s.cur.Index < len(a.result.Journeys) {
		// re-point to the stored journey (identical data) so browsing works
		s.cur = &a.result.Journeys[s.cur.Index]
	}
	if a.running && len(a.arrived) == 0 {
		s.cur = nil
	}
	if !a.running && a.result != nil && s.cur == nil && len(a.result.Journeys) > 0 {
		pick := 0
		for i, j := range a.result.Journeys {
			if j.Out[s.cmp].Rerouted && !j.Out[s.cmp].Moto {
				pick = i
				break
			}
		}
		s.show(a, &a.result.Journeys[pick])
	}
	moving := s.bar.Step(steps)
	return moving || (s.cur != nil && a.t-s.drawStart < routeDrawSecs)
}

func (s *runScreen) draw(a *App, c *Canvas, w, h int) {
	rw := 32
	mw := w - rw
	field := "true rain"
	if s.forecast {
		field = "forecast (router's view)"
	}
	title := "City 30×16 km · " + field
	if s.cur != nil {
		title = fmt.Sprintf("Journey #%d · %s", s.cur.Index+1, field)
	}
	done := c.Box(0, 0, mw, h, cBorder, title)
	frac := 1.0
	if s.cur != nil {
		t := math.Min(1, (a.t-s.drawStart)/routeDrawSecs)
		frac = 1 - math.Pow(1-t, 3)
	}
	r := c.Sub(-1, 0, mw-2, h-3)
	s.m.draw(a, c, mw-2, h-3, mapView{j: s.cur, base: 0, cmp: s.cmp, frac: frac, showForecast: s.forecast, t: a.t})
	r()
	x := 0
	y := h - 3
	legend := []struct {
		s   string
		col uint8
	}{{"━moto", cMagenta}, {"━walk", cGreen}, {"━BRT", cRain}, {"━rail", cGold}, {"━A0", cDim}}
	for _, l := range legend {
		x += c.Text(x, y, l.s, l.col) + 1
	}
	c.Text(x, y, fmt.Sprintf("vs %s  O→D", model.Variant(s.cmp)), cText)
	done()

	done = c.Box(mw, 0, rw, h, cBorderHi, "Run")
	iw := rw - 4
	y = 0
	switch {
	case a.running:
		c.Text(0, y, a.spinner()+" running", cRain)
	case a.result != nil:
		c.Text(0, y, "● done", cGreen)
	default:
		c.Text(0, y, "idle · press r", cDim)
	}
	y++
	progressBar(c, 0, y, iw, s.bar.Pos)
	y++
	c.Text(0, y, fmt.Sprintf("%d / %d journeys", a.runDone, a.runTotal), cText)
	y++
	el := time.Since(a.runStart).Seconds()
	if a.result != nil {
		el = a.result.Elapsed.Seconds()
	}
	if a.runTotal > 0 {
		rate := float64(a.runDone) / math.Max(el, 1e-3)
		c.Text(0, y, fmt.Sprintf("%.2f s · %.0f journeys/s", el, rate), cDim)
	}
	y += 2
	if s.cur != nil {
		j := s.cur
		c.Text(0, y, fmt.Sprintf("#%d  %.1f km  %d rain cell(s)", j.Index+1,
			math.Hypot(float64(j.DX-j.OX), float64(j.DY-j.OY)), len(j.Cells)), cText)
		y++
		for _, v := range []int{0, s.cmp} {
			o := j.Out[v]
			mode := "transit"
			if o.Moto {
				mode = "moto"
			}
			c.Text(0, y, fmt.Sprintf("%-3s %-7s %4.0fm %6.2fmm", model.Variant(v), mode, o.T, o.Dose), variantColor[v])
			y++
		}
		if d0 := j.Out[0].Dose; d0 > 0 {
			red := 100 * (1 - j.Out[s.cmp].Dose/d0)
			col := cGreen
			if red < 0 {
				col = cRed
			}
			c.Text(0, y, fmt.Sprintf("dose %+.0f%% · time %+.0f%%", -red, 100*(j.Out[s.cmp].T/j.Out[0].T-1)), col)
		}
		y += 2
	}
	if y < h-3 {
		c.Text(0, y, "recent", cDim)
		y++
		for i := len(a.arrived) - 1; i >= 0 && y < h-2; i-- {
			j := a.arrived[i]
			o0, o3 := j.Out[0], j.Out[model.A3]
			arrow := "="
			if o3.Rerouted {
				arrow = "→"
			}
			m0, m3 := modeShort(o0.Moto), modeShort(o3.Moto)
			c.Text(0, y, fmt.Sprintf("#%-4d %s%s%s %5.2f→%5.2f", j.Index+1, m0, arrow, m3, o0.Dose, o3.Dose), cDim)
			y++
		}
	}
	done()
}

func modeShort(moto bool) string {
	if moto {
		return "M"
	}
	return "T"
}

// progressBar draws a fractional block bar.
func progressBar(c *Canvas, x, y, w int, f float64) {
	f = math.Min(math.Max(f, 0), 1)
	eighths := []rune(" ▏▎▍▌▋▊▉█")
	total := f * float64(w)
	full := int(total)
	for i := 0; i < w; i++ {
		switch {
		case i < full:
			c.Put(x+i, y, '█', cRain)
		case i == full:
			c.Put(x+i, y, eighths[int((total-float64(full))*8)], cRain)
			if c.at(x+i, y) != nil && c.at(x+i, y).r == ' ' {
				c.Put(x+i, y, '─', cFaint)
			}
		default:
			c.Put(x+i, y, '─', cFaint)
		}
	}
}
