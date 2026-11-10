package ui

import (
	"fmt"
	"math"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"

	"wmptrs-sim/internal/model"
	"wmptrs-sim/internal/sim"
)

type resultsScreen struct {
	bars   [model.NumVariants]Spring
	reveal Spring
	ver    int
	t0     float64
	replay key.Binding
}

func newResults() *resultsScreen {
	s := &resultsScreen{reveal: newSpring(3, 1), ver: -1}
	for i := range s.bars {
		s.bars[i] = newSpring(4.5, 0.55)
	}
	s.replay = key.NewBinding(key.WithKeys("a"), key.WithHelp("a", "replay animation"))
	return s
}

func (s *resultsScreen) title() string       { return "Results" }
func (s *resultsScreen) captures() bool      { return false }
func (s *resultsScreen) keys() []key.Binding { return []key.Binding{s.replay} }
func (s *resultsScreen) enter(a *App) tea.Cmd {
	s.restart(a)
	return nil
}

func (s *resultsScreen) restart(a *App) {
	s.ver, s.t0 = a.resultVer, a.t
	for i := range s.bars {
		s.bars[i].Jump(0)
	}
	s.reveal.Jump(0)
}

func (s *resultsScreen) update(a *App, msg tea.KeyMsg) tea.Cmd {
	if key.Matches(msg, s.replay) {
		s.restart(a)
	}
	return nil
}

func (s *resultsScreen) tick(a *App, steps int) bool {
	if s.ver != a.resultVer {
		s.restart(a)
	}
	if a.result == nil {
		return false
	}
	moving := false
	for i := range s.bars {
		if a.t-s.t0 > 0.1+0.12*float64(i) {
			s.bars[i].Target = a.result.Summary.Variants[i].DoseRedPct
		}
		moving = s.bars[i].Step(steps) || moving || s.bars[i].Target != a.result.Summary.Variants[i].DoseRedPct
	}
	s.reveal.Target = 1
	return s.reveal.Step(steps) || moving
}

func fmtP(p float64) string {
	switch {
	case p == 0:
		return "<1e-300"
	case p < 0.001:
		return fmt.Sprintf("%.1e", p)
	}
	return fmt.Sprintf("%.4f", p)
}

func (s *resultsScreen) draw(a *App, c *Canvas, w, h int) {
	if a.result == nil {
		done := c.Box(0, 0, w, h, cBorder, "Results")
		msg := "No results yet — press r to run the simulation."
		if a.running {
			msg = fmt.Sprintf("%s running… %d / %d journeys", a.spinner(), a.runDone, a.runTotal)
		}
		c.TextC(0, h/2-1, w-4, msg, cText, 0)
		done()
		return
	}
	sum := a.result.Summary
	th := 8 // table box
	if h >= 26 {
		th = 9
	}
	top := h - th
	bw := w / 2
	drawBars(c, a, s, sum, 0, 0, bw, top)
	drawStats(c, a, sum, bw, 0, w-bw, top)
	drawTable(c, a, sum, s.reveal.Pos, 0, top, w, th)
}

func drawBars(c *Canvas, a *App, s *resultsScreen, sum sim.Summary, x, y, w, h int) {
	done := c.Box(x, y, w, h, cBorderHi, "Total dose ↓ vs A0 · ├─┤ 95% CI")
	iw := w - 4
	scale := 10.0
	for _, v := range sum.Variants {
		scale = math.Max(scale, math.Max(math.Abs(v.DoseRedPct), v.DoseRedCI[1]))
	}
	scale = niceCeil(scale * 1.05)
	barX, valW := 4, 7
	barW := iw - barX - valW
	rowH := min(3, max(1, (h-2)/len(sum.Variants)))
	eighths := []rune(" ▏▎▍▌▋▊▉")
	for i, v := range sum.Variants {
		ry := i * rowH
		col := variantColor[i]
		c.TextA(0, ry, v.Name, col, attrBold)
		val := s.bars[i].Pos
		length := math.Abs(val) / scale * float64(barW)
		full := int(length)
		barCol := col
		if val < 0 {
			barCol = cRed
		}
		for k := 0; k < full && k < barW; k++ {
			c.Put(barX+k, ry, '█', barCol)
		}
		if full < barW {
			if e := int((length - float64(full)) * 8); e > 0 {
				c.Put(barX+full, ry, eighths[e], barCol)
			}
		}
		if rowH > 1 && i > 0 {
			lo := int(math.Round(math.Max(v.DoseRedCI[0], 0) / scale * float64(barW)))
			hi := int(math.Round(math.Max(v.DoseRedCI[1], 0) / scale * float64(barW)))
			if hi > lo && s.bars[i].Pos == s.bars[i].Target {
				for k := lo; k <= hi && k < barW; k++ {
					c.Put(barX+k, ry+1, '─', cDim)
				}
				c.Put(barX+lo, ry+1, '├', cDim)
				c.Put(barX+min(hi, barW-1), ry+1, '┤', cDim)
			}
		}
		c.TextR(iw, ry, fmt.Sprintf("%5.1f%%", val), cText)
	}
	if rowH*len(sum.Variants) < h-2 {
		c.Text(0, h-3, fmt.Sprintf("bar scale 0 … %.0f%%, bootstrap CI", scale), cDim)
	}
	done()
}

func drawStats(c *Canvas, a *App, sum sim.Summary, x, y, w, h int) {
	done := c.Box(x, y, w, h, cBorder, "Significance (per-journey dose)")
	f := sum.Friedman
	ln := 0
	c.Text(0, ln, "Friedman, A0–A4", cDim)
	ln++
	c.Text(0, ln, fmt.Sprintf(" χ²(%d) = %.1f   p = %s", f.DF, f.Chi2, fmtP(f.P)), cText)
	ln++
	c.Text(0, ln, "Wilcoxon A3 vs …, Holm-adjusted", cDim)
	ln++
	for _, cmp := range sum.Wilcoxon {
		dir, col := "lower ", cGreen
		if cmp.Z > 0 {
			dir, col = "higher", cRed
		}
		if cmp.N == 0 {
			dir, col = "same  ", cDim
		}
		sig := " "
		if cmp.PHolm < 0.05 {
			sig = "*"
		}
		c.Text(0, ln, fmt.Sprintf(" %-3s", cmp.Vs), cText)
		c.Text(4, ln, "A3 "+dir, col)
		c.Text(14, ln, fmt.Sprintf("p=%-8s%s n=%d", fmtP(cmp.PHolm), sig, cmp.N), cText)
		ln++
	}
	a3 := sum.Variants[model.A3]
	if ln+2 < h-2 {
		ln++
		c.Text(0, ln, fmt.Sprintf("Median per-journey ↓, n=%d", sum.ExposedJourneys), cDim)
		ln++
		c.Text(0, ln, fmt.Sprintf(" A3 %.1f%%  CI [%.1f, %.1f]", a3.MedianRedPct, a3.MedianRedCI[0], a3.MedianRedCI[1]), cRain)
		ln++
	}
	if ln < h-2 {
		c.Text(0, ln, fmt.Sprintf("Oracle reroutes: %d / %d", sum.OraclePositives, sum.Journeys), cDim)
	}
	done()
}

func drawTable(c *Canvas, a *App, sum sim.Summary, reveal float64, x, y, w, h int) {
	done := c.Box(x, y, w, h, cBorder, "Outcomes on true rain (means per journey)")
	cols := []struct {
		name string
		w    int
	}{{"", 4}, {"Δtime", 8}, {"dose mm", 9}, {"exposed", 9}, {"moto", 7}, {"rerouted", 10}, {"P", 6}, {"R", 6}, {"F1", 6}}
	xx := 0
	for _, col := range cols {
		c.TextR(xx+col.w, 0, col.name, cDim)
		xx += col.w
	}
	for i, v := range sum.Variants {
		yy := i + 1
		r := reveal
		cells := []string{
			v.Name,
			fmt.Sprintf("%+.1f%%", v.TimeIncPct*r),
			fmt.Sprintf("%.2f", v.MeanDose*r),
			fmt.Sprintf("%.1fm", v.MeanExposed*r),
			fmt.Sprintf("%.0f%%", 100*v.MotoShare*r),
			fmt.Sprintf("%.0f%%", 100*v.RerouteShare*r),
			fmt.Sprintf("%.2f", v.Precision*r),
			fmt.Sprintf("%.2f", v.Recall*r),
			fmt.Sprintf("%.2f", v.F1*r),
		}
		if v.PredPositives == 0 {
			cells[6], cells[7], cells[8] = "—", "—", "—"
		}
		xx = 0
		for k, col := range cols {
			fg := cText
			if k == 0 {
				fg = variantColor[i]
			}
			if k == 0 {
				c.TextA(xx+1, yy, cells[k], fg, attrBold)
			} else {
				c.TextR(xx+col.w, yy, cells[k], fg)
			}
			xx += col.w
		}
		if xx+2+len([]rune(v.Description)) <= w-4 {
			c.Text(xx+2, yy, v.Description, cDim)
		}
	}
	if h >= 9 {
		c.Text(0, len(sum.Variants)+1, "P/R/F1: rerouted when the oracle (A3 on true rain) found a drier route", cFaint)
	}
	done()
}
