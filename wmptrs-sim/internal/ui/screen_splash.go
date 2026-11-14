package ui

import (
	"math"
	"strings"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
)

// The title is the full system name, set in spaced capitals; every letter
// falls into place on its own spring like a raindrop.
var titleLines = []string{"WEATHER-AWARE  MULTIMODAL", "PUBLIC  TRANSPORTATION", "ROUTING  SYSTEM"}

func spaced(s string) string {
	r := []rune(s)
	var b strings.Builder
	for i, ch := range r {
		if i > 0 {
			b.WriteRune(' ')
		}
		b.WriteRune(ch)
	}
	return b.String()
}

type splash struct {
	letters [][]Spring
	t0      float64
	started bool
	rain    *rainField
	enterK  key.Binding
}

func newSplash() *splash {
	s := &splash{
		rain:   newRainField(0.05, 18, 22, 3),
		enterK: key.NewBinding(key.WithKeys("enter", " "), key.WithHelp("enter", "open menu")),
	}
	for _, l := range titleLines {
		var row []Spring
		for range []rune(spaced(l)) {
			sp := newSpring(5.5, 0.42)
			sp.Jump(-14)
			row = append(row, sp)
		}
		s.letters = append(s.letters, row)
	}
	return s
}

func (s *splash) title() string       { return "Intro" }
func (s *splash) keys() []key.Binding { return []key.Binding{s.enterK} }
func (s *splash) captures() bool      { return false }
func (s *splash) enter(a *App) tea.Cmd {
	if !s.started {
		s.started, s.t0 = true, a.t
	}
	return nil
}

func (s *splash) update(a *App, msg tea.KeyMsg) tea.Cmd {
	if key.Matches(msg, s.enterK) {
		return a.switchTo(scrMenu, 1)
	}
	return nil
}

func (s *splash) tick(a *App, steps int) bool {
	k := 0
	for li := range s.letters {
		for i := range s.letters[li] {
			if a.t-s.t0 > 0.2+0.025*float64(k) {
				s.letters[li][i].Target = 0
			}
			s.letters[li][i].Step(steps)
			k++
		}
	}
	s.rain.step(float64(steps) / 60)
	return true
}

func (s *splash) draw(a *App, c *Canvas, w, h int) {
	s.rain.resize(w, h)
	gap := 2
	if h < 26 {
		gap = 1
	}
	y0 := max(1, (h-(len(titleLines)*gap+12))/2)
	mask := make([]bool, w*h)
	shades := []uint8{cWhite, cRain, cR6}
	for li, l := range titleLines {
		txt := []rune(spaced(l))
		if len(txt) > w-2 {
			txt = []rune(l)
		}
		x0 := (w - len(txt)) / 2
		for i, ch := range txt {
			if py := y0 + li*gap; ch == ' ' && py >= 0 && py < h && x0+i >= 0 && x0+i < w {
				mask[py*w+x0+i] = true // keep rain out of the gaps between letters
				continue
			}
			dy := 0
			if i < len(s.letters[li]) {
				dy = int(math.Round(s.letters[li][i].Pos))
			}
			px, py := x0+i, y0+li*gap+dy
			c.PutA(px, py, ch, shades[li], attrBold)
			if px >= 0 && px < w && py >= 0 && py < h {
				mask[py*w+px] = true
			}
		}
	}
	for _, d := range s.rain.drops {
		dx, dy := int(d.x), int(d.y)
		if dx < 0 || dx >= w || dy < 0 || dy >= h {
			continue
		}
		if mask[dy*w+dx] {
			if p := c.at(dx, dy); p != nil {
				p.fg = cGold // a drop "lights up" the letter it passes
			}
			continue
		}
		if p := c.at(dx, dy); p != nil && p.r == ' ' {
			c.Put(dx, dy, '│', cRainDim)
			if dy+1 < h && !mask[(dy+1)*w+dx] {
				if q := c.at(dx, dy+1); q != nil && q.r == ' ' {
					c.Put(dx, dy+1, '╵', cRain)
				}
			}
		}
	}

	el := a.t - s.t0
	y := y0 + len(titleLines)*gap + 1
	c.TextC(0, y, w, "─────  interactive research simulator  ─────", cDim, 0)
	lines := []struct {
		s   string
		col uint8
		at  attr
	}{
		{"The Discomfort Penalty model · ICDSG 2026", cText, attrBold},
		{"c = τ · w_m · (1 + β · E · φ(r_f))", cGold, 0},
		{"", 0, 0},
		{"Explains itself: guided slides, symbol reference, map case studies,", cDim, 0},
		{"live experiments, data provenance and answers for reviewers.", cDim, 0},
	}
	reveal := int((el - 1.6) * 60)
	for i, l := range lines {
		n := min(max(reveal-i*25, 0), runeLen(l.s))
		if n > 0 {
			c.TextA((w-runeLen(l.s))/2, y+2+i, string([]rune(l.s)[:n]), l.col, l.at)
		}
	}
	if el > 2.6 {
		col := cText
		if math.Mod(el, 1.2) > 0.8 {
			col = cDim
		}
		c.TextC(0, y+2+len(lines)+1, w, "press enter to open the menu", col, attrBold)
	}
}
