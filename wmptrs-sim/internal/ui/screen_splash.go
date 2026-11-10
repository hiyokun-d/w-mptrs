package ui

import (
	"math"
	"unicode/utf8"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
)

var logoFont = map[rune][5]string{
	'W': {"█   █", "█   █", "█ █ █", "██ ██", "█   █"},
	'-': {"    ", "    ", "████", "    ", "    "},
	'M': {"█   █", "██ ██", "█ █ █", "█   █", "█   █"},
	'P': {"████ ", "█   █", "████ ", "█    ", "█    "},
	'T': {"█████", "  █  ", "  █  ", "  █  ", "  █  "},
	'R': {"████ ", "█   █", "████ ", "█  █ ", "█   █"},
	'S': {" ████", "█    ", " ███ ", "    █", "████ "},
}

const logoText = "W-MPTRS"

type splash struct {
	letters []Spring
	t0      float64
	started bool
	rain    *rainField
	enterK  key.Binding
}

func newSplash() *splash {
	s := &splash{
		rain:   newRainField(0.05, 18, 22, 3),
		enterK: key.NewBinding(key.WithKeys("enter", " "), key.WithHelp("enter", "begin")),
	}
	for range logoText {
		sp := newSpring(5.5, 0.42)
		sp.Jump(-14)
		s.letters = append(s.letters, sp)
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
		return a.switchTo(1, 1)
	}
	return nil
}

func (s *splash) tick(a *App, steps int) bool {
	for i := range s.letters {
		if a.t-s.t0 > 0.25+0.11*float64(i) {
			s.letters[i].Target = 0
		}
		s.letters[i].Step(steps)
	}
	s.rain.step(float64(steps) / 60)
	return true
}

func (s *splash) draw(a *App, c *Canvas, w, h int) {
	scale := 1
	if w >= 110 && h >= 28 {
		scale = 2
	}
	logoW := 0
	for i, r := range logoText {
		if i > 0 {
			logoW++
		}
		logoW += utf8.RuneCountInString(logoFont[r][0])
	}
	logoW *= scale
	x0 := (w - logoW) / 2
	y0 := max(1, (h-15)/2)
	s.rain.resize(w, h)

	// logo mask so rain can light up the glyphs it passes through
	mask := make([]bool, w*h)
	x := x0
	for i, r := range logoText {
		glyph := logoFont[r]
		gw := utf8.RuneCountInString(glyph[0])
		dy := int(math.Round(s.letters[i].Pos))
		for row, line := range glyph {
			for col, ch := range []rune(line) {
				if ch == ' ' {
					continue
				}
				for k := 0; k < scale; k++ {
					px, py := x+col*scale+k, y0+row+dy
					shade := []uint8{cRain, cRain, cR6, cR5, cR5}[row]
					c.Put(px, py, '█', shade)
					if px >= 0 && px < w && py >= 0 && py < h {
						mask[py*w+px] = true
					}
				}
			}
		}
		x += (gw + 1) * scale
	}
	for _, d := range s.rain.drops {
		dx, dy := int(d.x), int(d.y)
		if dx < 0 || dx >= w || dy < 0 || dy >= h {
			continue
		}
		if mask[dy*w+dx] {
			c.Put(dx, dy, '█', cWhite)
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
	y := y0 + 6
	c.TextC(0, y, w, "S  I  M  U  L  A  T  O  R", cDim, 0)
	lines := []struct {
		s   string
		col uint8
		at  attr
	}{
		{"Weather-Aware Multimodal Public Transportation Routing", cText, attrBold},
		{"Discomfort Penalty model · ICDSG 2026", cDim, 0},
		{"", 0, 0},
		{"c = τ · w_m · (1 + β · E · φ(r))", cGold, 0},
	}
	reveal := int((el - 1.0) * 45)
	for i, l := range lines {
		n := min(max(reveal-i*20, 0), utf8.RuneCountInString(l.s))
		if n > 0 {
			full := utf8.RuneCountInString(l.s)
			c.TextA((w-full)/2, y+2+i, string([]rune(l.s)[:n]), l.col, l.at)
		}
	}
	if el > 2.2 {
		col := cText
		if math.Mod(el, 1.2) > 0.8 {
			col = cDim
		}
		c.TextC(0, y+8, w, "press enter to begin", col, attrBold)
	}
}
