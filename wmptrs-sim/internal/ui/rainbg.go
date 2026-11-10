package ui

import "math/rand/v2"

type drop struct{ x, y, v float64 }

// rainField is a set of falling drops over a w x h area.
type rainField struct {
	drops   []drop
	w, h    int
	density float64 // drops per cell
	rng     *rand.Rand
	vmin    float64
	vspread float64
}

func newRainField(density, vmin, vspread float64, seed uint64) *rainField {
	return &rainField{density: density, vmin: vmin, vspread: vspread, rng: rand.New(rand.NewPCG(seed, 99))}
}

func (r *rainField) resize(w, h int) {
	if w == r.w && h == r.h {
		return
	}
	r.w, r.h = w, h
	n := int(float64(w*h) * r.density)
	r.drops = r.drops[:0]
	for i := 0; i < n; i++ {
		r.drops = append(r.drops, r.spawn(r.rng.Float64()*float64(h)))
	}
}

func (r *rainField) spawn(y float64) drop {
	return drop{x: float64(r.rng.IntN(max(r.w, 1))), y: y, v: r.vmin + r.vspread*r.rng.Float64()}
}

func (r *rainField) step(dt float64) {
	for i := range r.drops {
		d := &r.drops[i]
		d.y += d.v * dt
		if d.y >= float64(r.h) {
			*d = r.spawn(-r.rng.Float64() * 3)
		}
	}
}

// drawBG paints drops only on empty page-background cells.
func (r *rainField) drawBG(c *Canvas) {
	for _, d := range r.drops {
		x, y := int(d.x), int(d.y)
		p := c.at(x, y)
		if p == nil || p.r != ' ' || p.bg != cBG {
			continue
		}
		if y == r.h-1 {
			p.r, p.fg = '.', cRainDim
		} else {
			p.r, p.fg = '╎', cRainDim
		}
	}
}
