package ui

import (
	"fmt"
	"math"
	"runtime"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"

	"wmptrs-sim/internal/model"
	"wmptrs-sim/internal/stats"
)

type benchScreen struct {
	bars   [model.NumVariants]Spring
	reveal Spring
	ver    int
	rerun  key.Binding
}

func newBenchScreen() *benchScreen {
	s := &benchScreen{reveal: newSpring(2, 1), ver: -1}
	for i := range s.bars {
		s.bars[i] = newSpring(5, 0.6)
	}
	s.rerun = key.NewBinding(key.WithKeys("b"), key.WithHelp("b", "re-run bench"))
	return s
}

func (s *benchScreen) title() string       { return "Bench" }
func (s *benchScreen) captures() bool      { return false }
func (s *benchScreen) keys() []key.Binding { return []key.Binding{s.rerun} }

func (s *benchScreen) enter(a *App) tea.Cmd {
	s.ver = -1
	if !a.benchRunning && (a.bench == nil || a.benchFor != a.params) {
		return a.startBench()
	}
	return nil
}

func (s *benchScreen) update(a *App, msg tea.KeyMsg) tea.Cmd {
	if key.Matches(msg, s.rerun) && !a.benchRunning {
		return a.startBench()
	}
	return nil
}

func (s *benchScreen) tick(a *App, steps int) bool {
	if a.bench == nil {
		return false
	}
	if s.ver != a.benchVer {
		s.ver = a.benchVer
		for i := range s.bars {
			s.bars[i].Jump(0)
		}
		s.reveal.Jump(0)
	}
	moving := false
	for i := range s.bars {
		s.bars[i].Target = a.bench.Variants[i].MedianUs
		moving = s.bars[i].Step(steps) || moving
	}
	s.reveal.Target = 1
	return s.reveal.Step(steps) || moving
}

var sparkRunes = []rune("▁▂▃▄▅▆▇█")

func (s *benchScreen) draw(a *App, c *Canvas, w, h int) {
	ih := 7
	done := c.Box(0, 0, w, h-ih, cBorderHi, "Time per routing call: price all edges + 2 Dijkstra searches")
	if a.bench == nil {
		c.TextC(0, (h-ih)/2-1, w-4, a.spinner()+" benchmarking on one goroutine…", cText, 0)
		done()
		s.drawInfo(a, c, w, h, ih)
		return
	}
	b := a.bench
	iw := w - 4
	c.Text(0, 0, "var   median      p95   median bar", cDim)
	barX, barW := 26, max(10, iw/3)
	sparkX := barX + barW + 2
	sparkW := iw - sparkX
	c.Text(sparkX, 0, "per-batch medians", cDim)
	maxV := 1.0
	for _, v := range b.Variants {
		maxV = math.Max(maxV, v.P95Us)
	}
	// sparkline buckets share one scale so variants are comparable
	buckets := make([][]float64, len(b.Variants))
	lo, hi := math.Inf(1), math.Inf(-1)
	for i, v := range b.Variants {
		n := min(sparkW, len(v.Samples))
		for k := 0; k < n; k++ {
			a0, a1 := k*len(v.Samples)/n, (k+1)*len(v.Samples)/n
			m := stats.Median(v.Samples[a0:a1])
			buckets[i] = append(buckets[i], m)
			lo, hi = math.Min(lo, m), math.Max(hi, m)
		}
	}
	rowH := max(1, min(2, (h-ih-4)/len(b.Variants)))
	for i, v := range b.Variants {
		y := 1 + i*rowH
		col := variantColor[i]
		c.TextA(0, y, v.Name, col, attrBold)
		c.TextR(14, y, fmt.Sprintf("%.1fµs", s.bars[i].Pos), cText)
		c.TextR(24, y, fmt.Sprintf("%.1fµs", v.P95Us*s.reveal.Pos), cDim)
		bl := int(s.bars[i].Pos / maxV * float64(barW))
		for k := 0; k < barW; k++ {
			if k < bl {
				c.Put(barX+k, y, '█', col)
			} else {
				c.Put(barX+k, y, '·', cFaint)
			}
		}
		if p := int(v.P95Us / maxV * float64(barW)); p < barW && s.reveal.Pos > 0.9 {
			c.Put(barX+p, y, '┃', cDim)
		}
		shown := int(s.reveal.Pos * float64(len(buckets[i])))
		for k := 0; k < shown; k++ {
			lvl := 0
			if hi > lo {
				lvl = int((buckets[i][k] - lo) / (hi - lo) * 7.999)
			}
			c.Put(sparkX+k, y, sparkRunes[lvl], col)
		}
	}
	c.Text(0, h-ih-3, "┃ = p95.  A3/A4 evaluate φ (one exp) per edge, so pricing costs more.", cDim)
	done()
	s.drawInfo(a, c, w, h, ih)
}

func (s *benchScreen) drawInfo(a *App, c *Canvas, w, h, ih int) {
	done := c.Box(0, h-ih, w, ih, cBorder, "Setup")
	nodes, edges, calls := a.net.NumNodes, a.net.NumEdges(), 0
	if a.bench != nil {
		nodes, edges, calls = a.bench.Nodes, a.bench.Edges, a.bench.Calls
	}
	c.Text(0, 0, fmt.Sprintf("graph   %d nodes · %d directed edges (walk, moto, 11 BRT, 2 rail)", nodes, edges), cText)
	c.Text(0, 1, fmt.Sprintf("calls   %d per variant (≤200 journeys × 3 reps), single goroutine", calls), cText)
	c.Text(0, 2, fmt.Sprintf("host    %s/%s · %d CPUs · %s", runtime.GOOS, runtime.GOARCH, runtime.NumCPU(), runtime.Version()), cText)
	c.Text(0, 3, "Wall-clock timings vary between machines and runs.", cDim)
	done()
}
