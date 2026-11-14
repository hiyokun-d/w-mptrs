package ui

import (
	"strings"
	"unicode/utf8"
)

// Rich text markup used by the explainer screens:
//
//	‹symbol›   gold, bold  (a model symbol or key number)
//	«phrase»   cyan        (emphasis)
//	⟦warning⟧  amber       (caveat / limitation)
//
// Paragraphs are separated by "\n". A paragraph starting with "• " or "1. "
// style prefixes gets a hanging indent. An empty paragraph is a blank line.

type glyph struct {
	r   rune
	col uint8
	at  attr
}

type richLine struct {
	g      []glyph
	indent int
}

// wrapRich lays out marked-up text into lines at most w cells wide.
func wrapRich(s string, w int, base uint8) []richLine {
	if w < 4 {
		return nil
	}
	var out []richLine
	col, at := base, attr(0)
	for _, para := range strings.Split(s, "\n") {
		if strings.TrimSpace(para) == "" {
			out = append(out, richLine{})
			continue
		}
		hang := 0
		switch {
		case strings.HasPrefix(para, "• "), strings.HasPrefix(para, "→ "), strings.HasPrefix(para, "✓ "), strings.HasPrefix(para, "✗ "):
			hang = 2
		case len(para) > 2 && para[0] >= '0' && para[0] <= '9' && para[1] == '.':
			hang = 3
		}
		// split into styled words
		var words [][]glyph
		var cur []glyph
		flush := func() {
			if len(cur) > 0 {
				words = append(words, cur)
				cur = nil
			}
		}
		for _, r := range para {
			switch r {
			case '‹':
				col, at = cGold, attrBold
				continue
			case '«':
				col, at = cRain, 0
				continue
			case '⟦':
				col, at = cAmber, 0
				continue
			case '›', '»', '⟧':
				col, at = base, 0
				continue
			case ' ':
				flush()
				continue
			}
			cur = append(cur, glyph{r, col, at})
		}
		flush()
		line := richLine{}
		width := 0
		for _, wd := range words {
			avail := w - line.indent
			if width > 0 && width+1+len(wd) > avail {
				out = append(out, line)
				line = richLine{indent: hang}
				width = 0
				avail = w - hang
			}
			for len(wd) > avail && avail > 0 { // hard-split very long words
				if width > 0 {
					out = append(out, line)
					line = richLine{indent: hang}
					width = 0
					avail = w - hang
				}
				line.g = append(line.g, wd[:avail]...)
				out = append(out, line)
				line = richLine{indent: hang}
				wd = wd[avail:]
				avail = w - hang
			}
			if width > 0 {
				line.g = append(line.g, glyph{' ', base, 0})
				width++
			}
			line.g = append(line.g, wd...)
			width += len(wd)
		}
		if len(line.g) > 0 {
			out = append(out, line)
		}
	}
	return out
}

// drawLines draws wrapped lines starting at line skip, at most h lines.
func drawLines(c *Canvas, x, y, h int, lines []richLine, skip int) {
	for i := skip; i < len(lines) && i-skip < h; i++ {
		l := lines[i]
		for k, g := range l.g {
			c.PutA(x+l.indent+k, y+i-skip, g.r, g.col, g.at)
		}
	}
}

// rich wraps and draws s, returning the number of lines drawn.
func rich(c *Canvas, x, y, w, h int, s string, base uint8) int {
	lines := wrapRich(s, w, base)
	drawLines(c, x, y, h, lines, 0)
	return min(len(lines), h)
}

// richWidth is the display width of a single marked-up line.
func richWidth(s string) int {
	n := 0
	for _, r := range s {
		switch r {
		case '‹', '›', '«', '»', '⟦', '⟧':
		default:
			n++
		}
	}
	return n
}

// richC draws one marked-up line centred in a span of width w.
func richC(c *Canvas, x, y, w int, s string, base uint8) {
	richAt(c, x+(w-richWidth(s))/2, y, s, base)
}

// richAt draws one marked-up line at (x, y) without wrapping, keeping
// every space (for aligned tables and worked arithmetic).
func richAt(c *Canvas, x, y int, s string, base uint8) {
	col, at := base, attr(0)
	for _, r := range s {
		switch r {
		case '‹':
			col, at = cGold, attrBold
		case '«':
			col, at = cRain, 0
		case '⟦':
			col, at = cAmber, 0
		case '›', '»', '⟧':
			col, at = base, 0
		default:
			c.PutA(x, y, r, col, at)
			x++
		}
	}
}

// scrollText is a scrollable rich-text panel body.
type scrollText struct {
	off int
}

// draw renders s into w x h with a scroll indicator, clamping the offset.
func (st *scrollText) draw(c *Canvas, w, h int, s string) {
	lines := wrapRich(s, w-1, cText)
	st.off = min(st.off, max(len(lines)-h, 0))
	st.off = max(st.off, 0)
	drawLines(c, 0, 0, h, lines, st.off)
	if len(lines) > h {
		if st.off > 0 {
			c.Put(w-1, 0, '▲', cRain)
		}
		if st.off+h < len(lines) {
			c.Put(w-1, h-1, '▼', cRain)
		}
		// thumb
		th := max(1, h*h/len(lines))
		ty := (h - th) * st.off / max(len(lines)-h, 1)
		for i := 1; i < h-1; i++ {
			ch, col := '│', cFaint
			if i >= ty && i < ty+th {
				ch, col = '┃', cBorderHi
			}
			c.Put(w-1, i, ch, col)
		}
	}
}

func (st *scrollText) key(k string) bool {
	switch k {
	case "pgdown", "J", " ", "ctrl+d":
		st.off += 5
	case "pgup", "K", "ctrl+u":
		st.off = max(st.off-5, 0)
	default:
		return false
	}
	return true
}

func runeLen(s string) int { return utf8.RuneCountInString(s) }

// hbar draws a horizontal bar of fraction f with eighth-block precision.
func hbar(c *Canvas, x, y, w int, f float64, col uint8) {
	f = clamp(f, 0, 1)
	eighths := []rune(" ▏▎▍▌▋▊▉")
	total := f * float64(w)
	full := int(total)
	for i := 0; i < full && i < w; i++ {
		c.Put(x+i, y, '█', col)
	}
	if full < w {
		if e := int((total - float64(full)) * 8); e > 0 {
			c.Put(x+full, y, eighths[e], col)
		}
	}
}

// histogram draws vertical bars for counts in a w x h area (bars bottom-up).
func histogram(c *Canvas, x, y, w, h int, counts []int, col uint8) {
	if len(counts) == 0 || h < 1 {
		return
	}
	mx := 0
	for _, n := range counts {
		mx = max(mx, n)
	}
	if mx == 0 {
		return
	}
	blocks := []rune(" ▁▂▃▄▅▆▇█")
	bw := max(1, w/len(counts))
	for i, n := range counts {
		v := float64(n) / float64(mx) * float64(h*8)
		for row := 0; row < h; row++ {
			level := int(v) - row*8
			var r rune
			switch {
			case level >= 8:
				r = '█'
			case level > 0:
				r = blocks[level]
			default:
				continue
			}
			for k := 0; k < bw-1 || (bw == 1 && k == 0); k++ {
				c.Put(x+i*bw+k, y+h-1-row, r, col)
			}
		}
	}
}
