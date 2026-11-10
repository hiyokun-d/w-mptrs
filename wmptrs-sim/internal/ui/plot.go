package ui

import (
	"math"
	"unicode/utf8"

	"wmptrs-sim/internal/ui/chart"
)

// plot is a braille line chart with text axes.
type plot struct {
	br                     chart.Braille
	x0, pw, ph             int
	xmin, xmax, ymin, ymax float64
}

// setup draws axes into a w x h area and prepares the braille plot region.
func (p *plot) setup(c *Canvas, w, h int, xmin, xmax, ymin, ymax float64,
	xticks, yticks []float64, xfmt, yfmt func(float64) string) {
	p.xmin, p.xmax, p.ymin, p.ymax = xmin, xmax, ymin, ymax
	lm := 0
	for _, t := range yticks {
		lm = max(lm, utf8.RuneCountInString(yfmt(t)))
	}
	p.x0 = lm + 1
	p.pw = max(w-p.x0-1, 1)
	p.ph = max(h-2, 1)
	p.br.Reset(p.pw, p.ph)
	for y := 0; y < p.ph; y++ {
		c.Put(lm, y, '│', cBorder)
	}
	c.Put(lm, p.ph, '└', cBorder)
	for x := 0; x < p.pw; x++ {
		c.Put(p.x0+x, p.ph, '─', cBorder)
	}
	for _, t := range yticks {
		cy := int(p.dotY(t) / 4)
		cy = min(max(cy, 0), p.ph-1)
		c.Put(lm, cy, '┤', cBorder)
		c.TextR(lm, cy, yfmt(t), cDim)
	}
	for _, t := range xticks {
		cx := p.x0 + int(p.dotX(t)/2)
		c.Put(cx, p.ph, '┴', cBorder)
		s := xfmt(t)
		n := utf8.RuneCountInString(s)
		c.Text(min(max(cx-n/2, p.x0-1), p.x0+p.pw-n), p.ph+1, s, cDim)
	}
}

func (p *plot) dotX(x float64) float64 {
	return (x - p.xmin) / (p.xmax - p.xmin) * float64(p.pw*2-1)
}

func (p *plot) dotY(y float64) float64 {
	return (1 - (y-p.ymin)/(p.ymax-p.ymin)) * float64(p.ph*4-1)
}

func (p *plot) line(x0, y0, x1, y1 float64, col uint8) {
	p.br.Line(p.dotX(x0), p.dotY(y0), p.dotX(x1), p.dotY(y1), col)
}

// fn plots y = f(x) sampled once per dot column, clipped to the y range.
func (p *plot) fn(f func(float64) float64, col uint8) {
	n := p.pw * 2
	prevOK := false
	var px, py float64
	for i := 0; i < n; i++ {
		x := p.xmin + (p.xmax-p.xmin)*float64(i)/float64(n-1)
		y := f(x)
		ok := !math.IsNaN(y) && y >= p.ymin && y <= p.ymax
		if ok {
			dx, dy := float64(i), p.dotY(y)
			if prevOK {
				p.br.Line(px, py, dx, dy, col)
			} else {
				p.br.Dot(int(dx), int(math.Round(dy)), col)
			}
			px, py = dx, dy
		}
		prevOK = ok
	}
}

// vline draws a dotted vertical line at x.
func (p *plot) vline(x float64, col uint8) {
	dx := int(math.Round(p.dotX(x)))
	for y := 0; y < p.ph*4; y += 2 {
		p.br.Dot(dx, y, col)
	}
}

// marker draws a small square at (x, y).
func (p *plot) marker(x, y float64, col uint8) {
	dx, dy := int(math.Round(p.dotX(x))), int(math.Round(p.dotY(y)))
	for i := -1; i <= 1; i++ {
		for j := -1; j <= 1; j++ {
			p.br.Dot(dx+i, dy+j, col)
		}
	}
}

// cellOf converts data coordinates to a canvas cell (relative to setup area).
func (p *plot) cellOf(x, y float64) (int, int) {
	return p.x0 + int(p.dotX(x)/2), int(p.dotY(y) / 4)
}

func (p *plot) blit(c *Canvas) {
	for cy := 0; cy < p.br.H; cy++ {
		for cx := 0; cx < p.br.W; cx++ {
			if r, col, ok := p.br.Cell(cx, cy); ok {
				c.Put(p.x0+cx, cy, r, col)
			}
		}
	}
}

// niceCeil rounds v up to 1, 2 or 5 times a power of ten.
func niceCeil(v float64) float64 {
	if v <= 0 {
		return 1
	}
	e := math.Pow(10, math.Floor(math.Log10(v)))
	for _, m := range []float64{1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10} {
		if m*e >= v {
			return m * e
		}
	}
	return 10 * e
}
