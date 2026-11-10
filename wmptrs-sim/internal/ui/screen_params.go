package ui

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"

	"wmptrs-sim/internal/sim"
)

type paramField struct {
	label, help    string
	min, max, step float64
	get            func(*sim.Params) float64
	set            func(*sim.Params, float64)
	format         func(float64) string
	integer        bool
}

var paramFields = []paramField{
	{"β  beta", "Weight of the discomfort term. β = 0 makes A3 identical to A0 (time only); larger β trades travel time for less rain.",
		0, 8, 0.25, func(p *sim.Params) float64 { return p.Beta }, func(p *sim.Params, v float64) { p.Beta = v },
		func(v float64) string { return fmt.Sprintf("%.2f", v) }, false},
	{"r0 midpoint", "Rain intensity at the sigmoid midpoint. Also the A1 threshold, the A2 onset and the cutoff for 'exposed minutes'.",
		1, 15, 0.5, func(p *sim.Params) float64 { return p.R0 }, func(p *sim.Params, v float64) { p.R0 = v },
		func(v float64) string { return fmt.Sprintf("%.1f mm/h", v) }, false},
	{"k steepness", "Steepness of φ. Large k approaches a hard threshold at r0; small k spreads the penalty over light rain.",
		0.1, 3, 0.02, func(p *sim.Params) float64 { return p.K }, func(p *sim.Params, v float64) { p.K = v },
		func(v float64) string { return fmt.Sprintf("%.2f", v) }, false},
	{"σ forecast", "Log-normal multiplicative error applied to each 2×2 km forecast block. 0 = exact intensities.",
		0, 1.5, 0.05, func(p *sim.Params) float64 { return p.Sigma }, func(p *sim.Params, v float64) { p.Sigma = v },
		func(v float64) string { return fmt.Sprintf("%.2f", v) }, false},
	{"shift", "Standard deviation of the displacement between the forecast and the true rain field.",
		0, 5, 0.25, func(p *sim.Params) float64 { return p.Shift }, func(p *sim.Params, v float64) { p.Shift = v },
		func(v float64) string { return fmt.Sprintf("%.2f km", v) }, false},
	{"journeys", "Random origin–destination pairs at least 8 km apart, each with 1–3 Gaussian rain cells near its corridor.",
		50, 1000, 50, func(p *sim.Params) float64 { return float64(p.Journeys) }, func(p *sim.Params, v float64) { p.Journeys = int(v) },
		func(v float64) string { return fmt.Sprintf("%d", int(v)) }, true},
	{"seed", "Same seed + same parameters = identical results. Network link times also depend on the seed.",
		0, 99999, 1, func(p *sim.Params) float64 { return float64(p.Seed) }, func(p *sim.Params, v float64) { p.Seed = uint64(v) },
		func(v float64) string { return fmt.Sprintf("%d", int(v)) }, true},
}

type paramsScreen struct {
	sel     int
	editing bool
	buf     string
	knobs   []Spring
	init    bool
	k       struct{ nav, adj, preset, run, edit, esc key.Binding }
}

func newParams() *paramsScreen {
	s := &paramsScreen{}
	for range paramFields {
		s.knobs = append(s.knobs, newSpring(10, 0.65))
	}
	s.k.nav = key.NewBinding(key.WithKeys("up", "down", "k", "j"), key.WithHelp("↑↓", "select"))
	s.k.adj = key.NewBinding(key.WithKeys("left", "right", "h", "l", "shift+left", "shift+right"), key.WithHelp("←→", "adjust"))
	s.k.preset = key.NewBinding(key.WithKeys("1", "2", "3", "4"), key.WithHelp("1-4", "preset"))
	s.k.edit = key.NewBinding(key.WithKeys("e"), key.WithHelp("e/0-9", "type value"))
	s.k.run = key.NewBinding(key.WithKeys("enter"), key.WithHelp("enter", "run"))
	s.k.esc = key.NewBinding(key.WithKeys("esc"), key.WithHelp("esc", "cancel"))
	return s
}

func (s *paramsScreen) title() string  { return "Params" }
func (s *paramsScreen) captures() bool { return s.editing }
func (s *paramsScreen) keys() []key.Binding {
	if s.editing {
		return []key.Binding{s.k.run, s.k.esc}
	}
	return []key.Binding{s.k.nav, s.k.adj, s.k.preset, s.k.edit, s.k.run}
}

func (s *paramsScreen) frac(a *App, i int) float64 {
	f := paramFields[i]
	return (f.get(&a.params) - f.min) / (f.max - f.min)
}

func (s *paramsScreen) enter(a *App) tea.Cmd {
	if !s.init {
		s.init = true
		for i := range s.knobs {
			s.knobs[i].Jump(0)
		}
	}
	return nil
}

func (s *paramsScreen) set(a *App, i int, v float64) {
	f := paramFields[i]
	v = math.Min(math.Max(v, f.min), f.max)
	if f.integer {
		v = math.Round(v)
	} else {
		v = math.Round(v/f.step) * f.step
		v = math.Round(v*1e6) / 1e6
	}
	f.set(&a.params, v)
}

func (s *paramsScreen) update(a *App, msg tea.KeyMsg) tea.Cmd {
	ks := msg.String()
	if s.editing {
		switch {
		case ks == "enter":
			if v, err := strconv.ParseFloat(strings.TrimSpace(s.buf), 64); err == nil {
				f := paramFields[s.sel]
				f.set(&a.params, math.Min(math.Max(v, f.min), f.max))
				if f.integer {
					f.set(&a.params, math.Round(f.get(&a.params)))
				}
			}
			s.editing = false
		case ks == "esc":
			s.editing = false
		case ks == "backspace":
			if len(s.buf) > 0 {
				s.buf = s.buf[:len(s.buf)-1]
			}
		case len(ks) == 1 && strings.ContainsAny(ks, "0123456789."):
			if len(s.buf) < 8 {
				s.buf += ks
			}
		}
		return nil
	}
	f := paramFields[s.sel]
	mult := 1.0
	if strings.HasPrefix(ks, "shift+") {
		mult = 5
	}
	switch ks {
	case "up", "k":
		s.sel = (s.sel + len(paramFields) - 1) % len(paramFields)
	case "down", "j":
		s.sel = (s.sel + 1) % len(paramFields)
	case "left", "h", "shift+left":
		s.set(a, s.sel, f.get(&a.params)-f.step*mult)
	case "right", "l", "shift+right":
		s.set(a, s.sel, f.get(&a.params)+f.step*mult)
	case "1", "2", "3", "4":
		a.params = sim.Presets()[int(ks[0]-'1')].Params
	case "e":
		s.editing, s.buf = true, ""
	case "enter":
		return a.startRunAndShow()
	default:
		if len(ks) == 1 && strings.ContainsAny(ks, "056789.") {
			s.editing, s.buf = true, ks
		}
	}
	return nil
}

func (s *paramsScreen) tick(a *App, steps int) bool {
	moving := false
	for i := range s.knobs {
		s.knobs[i].Target = s.frac(a, i)
		moving = s.knobs[i].Step(steps) || moving
	}
	return moving
}

func (s *paramsScreen) draw(a *App, c *Canvas, w, h int) {
	lw := max(50, w*3/5)
	rw := w - lw
	rows := min(2, max(1, (h-4)/len(paramFields)))
	bh := min(h, len(paramFields)*rows+4)
	done := c.Box(0, 0, lw, bh, cBorderHi, "Parameters")
	iw := lw - 4
	sx := 24
	slw := iw - sx
	for i, f := range paramFields {
		y := i*rows + 1
		sel := i == s.sel
		if sel {
			c.Put(-1, y, '›', cRain)
			c.TextA(0, y, f.label, cWhite, a.hl())
		} else {
			c.Text(0, y, f.label, cDim)
		}
		val := f.format(f.get(&a.params))
		if sel && s.editing {
			c.TextA(12, y, fmt.Sprintf("%-9s", s.buf+"▏"), cAmber, attrBold)
		} else {
			c.TextR(22, y, val, cText)
		}
		knob := int(math.Round(s.knobs[i].Pos * float64(slw-1)))
		knob = min(max(knob, 0), slw-1)
		for k := 0; k < slw; k++ {
			switch {
			case k < knob:
				col := cRainDim
				if sel {
					col = cRain
				}
				c.Put(sx+k, y, '━', col)
			case k == knob:
				col := cDim
				if sel {
					col = cWhite
				}
				c.Put(sx+k, y, '●', col)
			default:
				c.Put(sx+k, y, '─', cFaint)
			}
		}
	}
	c.Text(0, bh-3, "enter: run all 5 variants · shift+←→: ×5", cDim)
	done()

	if rw < 20 {
		return
	}
	ph := 4 + len(sim.Presets())
	done = c.Box(lw, 0, rw, ph, cBorder, "Presets")
	for i, p := range sim.Presets() {
		mark, col := " ", cDim
		if p.Params == a.params {
			mark, col = "●", cRain
		}
		c.Text(0, i+1, fmt.Sprintf("%s %d %s", mark, i+1, p.Name), col)
	}
	done()
	if h-ph >= 5 {
		f := paramFields[s.sel]
		done = c.Box(lw, ph, rw, min(h-ph, bh-ph), cBorder, strings.TrimSpace(f.label))
		for i, line := range wrap(f.help, rw-4) {
			c.Text(0, i, line, cText)
		}
		done()
	}
}

// wrap breaks s into lines of at most w runes.
func wrap(s string, w int) []string {
	var lines []string
	var cur []rune
	for _, word := range strings.Fields(s) {
		wr := []rune(word)
		if len(cur) > 0 && len(cur)+1+len(wr) > w {
			lines = append(lines, string(cur))
			cur = cur[:0]
		}
		if len(cur) > 0 {
			cur = append(cur, ' ')
		}
		cur = append(cur, wr...)
	}
	if len(cur) > 0 {
		lines = append(lines, string(cur))
	}
	return lines
}
