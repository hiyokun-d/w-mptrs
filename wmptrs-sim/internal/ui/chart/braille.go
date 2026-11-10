// Package chart provides a braille dot canvas (2x4 dots per terminal cell)
// with one colour per cell, used for the map and line charts.
package chart

import "math"

// Braille is a dot canvas W cells wide and H cells tall.
type Braille struct {
	W, H int
	bits []uint8
	col  []uint8
}

// Reset resizes and clears the canvas.
func (b *Braille) Reset(w, h int) {
	b.W, b.H = max(w, 0), max(h, 0)
	n := b.W * b.H
	if cap(b.bits) < n {
		b.bits = make([]uint8, n)
		b.col = make([]uint8, n)
	}
	b.bits = b.bits[:n]
	b.col = b.col[:n]
	clear(b.bits)
	clear(b.col)
}

// DotsW and DotsH are the canvas size in dots.
func (b *Braille) DotsW() int { return b.W * 2 }
func (b *Braille) DotsH() int { return b.H * 4 }

var dotBit = [4][2]uint8{{0x01, 0x08}, {0x02, 0x10}, {0x04, 0x20}, {0x40, 0x80}}

// Dot sets one dot; the cell takes the latest colour.
func (b *Braille) Dot(x, y int, col uint8) {
	if x < 0 || y < 0 || x >= b.W*2 || y >= b.H*4 {
		return
	}
	i := (y/4)*b.W + x/2
	b.bits[i] |= dotBit[y%4][x%2]
	b.col[i] = col
}

// Line draws a straight line between dot coordinates.
func (b *Braille) Line(x0, y0, x1, y1 float64, col uint8) {
	steps := int(math.Ceil(math.Max(math.Abs(x1-x0), math.Abs(y1-y0))))
	if steps == 0 {
		b.Dot(int(math.Round(x0)), int(math.Round(y0)), col)
		return
	}
	for i := 0; i <= steps; i++ {
		t := float64(i) / float64(steps)
		b.Dot(int(math.Round(x0+(x1-x0)*t)), int(math.Round(y0+(y1-y0)*t)), col)
	}
}

// Cell returns the braille rune and colour of a cell, ok=false if empty.
func (b *Braille) Cell(cx, cy int) (r rune, col uint8, ok bool) {
	i := cy*b.W + cx
	if b.bits[i] == 0 {
		return 0, 0, false
	}
	return rune(0x2800 + int(b.bits[i])), b.col[i], true
}
