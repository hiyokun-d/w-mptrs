package ui

import (
	"strings"
	"unicode/utf8"
)

type attr uint8

const (
	attrBold attr = 1 << iota
	attrRev
)

type cell struct {
	r      rune
	fg, bg uint8
	at     attr
}

// Canvas is a cell buffer with a movable origin and clip rectangle. All
// glyphs used are single-width.
type Canvas struct {
	W, H               int
	cells              []cell
	ox, oy             int
	cx0, cy0, cx1, cy1 int
}

func (c *Canvas) Reset(w, h int) {
	c.W, c.H = w, h
	if cap(c.cells) < w*h {
		c.cells = make([]cell, w*h)
	}
	c.cells = c.cells[:w*h]
	for i := range c.cells {
		c.cells[i] = cell{r: ' ', fg: cText, bg: cBG}
	}
	c.ox, c.oy = 0, 0
	c.cx0, c.cy0, c.cx1, c.cy1 = 0, 0, w, h
}

// Sub moves the origin to (x, y) and clips to a w x h rectangle there.
// Call the returned function to restore.
func (c *Canvas) Sub(x, y, w, h int) func() {
	ox, oy, a, b, d, e := c.ox, c.oy, c.cx0, c.cy0, c.cx1, c.cy1
	c.ox += x
	c.oy += y
	c.cx0, c.cy0 = max(c.cx0, c.ox), max(c.cy0, c.oy)
	c.cx1, c.cy1 = min(c.cx1, c.ox+w), min(c.cy1, c.oy+h)
	return func() { c.ox, c.oy, c.cx0, c.cy0, c.cx1, c.cy1 = ox, oy, a, b, d, e }
}

func (c *Canvas) at(x, y int) *cell {
	ax, ay := x+c.ox, y+c.oy
	if ax < c.cx0 || ay < c.cy0 || ax >= c.cx1 || ay >= c.cy1 {
		return nil
	}
	return &c.cells[ay*c.W+ax]
}

// Put writes a glyph keeping the background.
func (c *Canvas) Put(x, y int, r rune, fg uint8) { c.PutA(x, y, r, fg, 0) }

func (c *Canvas) PutA(x, y int, r rune, fg uint8, at attr) {
	if p := c.at(x, y); p != nil {
		p.r, p.fg, p.at = r, fg, at
	}
}

// SetBG changes only the background colour of a cell.
func (c *Canvas) SetBG(x, y int, bg uint8) {
	if p := c.at(x, y); p != nil {
		p.bg = bg
	}
}

// Text writes s and returns its width in cells.
func (c *Canvas) Text(x, y int, s string, fg uint8) int { return c.TextA(x, y, s, fg, 0) }

func (c *Canvas) TextA(x, y int, s string, fg uint8, at attr) int {
	n := 0
	for _, r := range s {
		c.PutA(x+n, y, r, fg, at)
		n++
	}
	return n
}

// TextR right-aligns s so it ends just before column x.
func (c *Canvas) TextR(x, y int, s string, fg uint8) {
	c.Text(x-utf8.RuneCountInString(s), y, s, fg)
}

// TextC centres s in a span of width w starting at x.
func (c *Canvas) TextC(x, y, w int, s string, fg uint8, at attr) {
	c.TextA(x+(w-utf8.RuneCountInString(s))/2, y, s, fg, at)
}

// Fill blanks a rectangle with the given background.
func (c *Canvas) Fill(x, y, w, h int, bg uint8) {
	for j := y; j < y+h; j++ {
		for i := x; i < x+w; i++ {
			if p := c.at(i, j); p != nil {
				*p = cell{r: ' ', fg: cText, bg: bg}
			}
		}
	}
}

// Box draws a rounded panel with an optional title, then moves the origin
// and clip to its padded interior. Call the returned function to restore.
func (c *Canvas) Box(x, y, w, h int, border uint8, title string) func() {
	if w < 2 || h < 2 {
		return c.Sub(x, y, 0, 0)
	}
	c.Fill(x, y, w, h, cPanel)
	for i := x + 1; i < x+w-1; i++ {
		c.Put(i, y, '─', border)
		c.Put(i, y+h-1, '─', border)
	}
	for j := y + 1; j < y+h-1; j++ {
		c.Put(x, j, '│', border)
		c.Put(x+w-1, j, '│', border)
	}
	c.Put(x, y, '╭', border)
	c.Put(x+w-1, y, '╮', border)
	c.Put(x, y+h-1, '╰', border)
	c.Put(x+w-1, y+h-1, '╯', border)
	if title != "" {
		maxw := w - 4
		t := []rune(" " + title + " ")
		if len(t) > maxw {
			t = t[:max(maxw, 0)]
		}
		c.TextA(x+2, y, string(t), cText, attrBold)
	}
	return c.Sub(x+2, y+1, w-4, h-2)
}

// Render serialises the canvas with ANSI styling, emitting only the style
// parts that change between cells.
func (c *Canvas) Render(t *theme) string {
	var b strings.Builder
	b.Grow(c.W * c.H * 4)
	for y := 0; y < c.H; y++ {
		var cur cell
		for x := 0; x < c.W; x++ {
			p := c.cells[y*c.W+x]
			fg := p.fg
			if p.r == ' ' && p.at&attrRev == 0 && x > 0 {
				fg = cur.fg // foreground is invisible on blanks
			}
			if x == 0 || p.at != cur.at {
				b.WriteString("\x1b[0m")
				if p.at&attrBold != 0 {
					b.WriteString("\x1b[1m")
				}
				if p.at&attrRev != 0 {
					b.WriteString("\x1b[7m")
				}
				b.WriteString(t.fg[fg])
				b.WriteString(t.bg[p.bg])
			} else if !t.mono {
				if fg != cur.fg {
					b.WriteString(t.fg[fg])
				}
				if p.bg != cur.bg {
					b.WriteString(t.bg[p.bg])
				}
			}
			cur = cell{fg: fg, bg: p.bg, at: p.at}
			b.WriteRune(p.r)
		}
		b.WriteString("\x1b[0m")
		if y < c.H-1 {
			b.WriteByte('\n')
		}
	}
	return b.String()
}
