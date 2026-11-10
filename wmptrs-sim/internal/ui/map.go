package ui

import (
	"math"

	"wmptrs-sim/internal/model"
	"wmptrs-sim/internal/sim"
	"wmptrs-sim/internal/ui/chart"
)

var kindColor = map[model.Kind]uint8{
	model.Walk:     cGreen,
	model.Moto:     cMagenta,
	model.RideBus:  cRain,
	model.RideRail: cGold,
	model.WaitBRT:  cAmber,
	model.WaitRail: cAmber,
	model.Alight:   cDim,
}

// cityMap draws the 30x16 km city with rain, transit lines and routes.
type cityMap struct {
	br chart.Braille
}

type mapView struct {
	j            *sim.Journey
	base, cmp    int     // config indices to draw (dim base, coloured cmp)
	frac         float64 // fraction of the cmp route drawn
	showForecast bool
	t            float64
}

func (m *cityMap) draw(a *App, c *Canvas, w, h int, v mapView) {
	if w < 4 || h < 3 {
		return
	}
	net := a.net
	m.br.Reset(w, h)
	dw, dh := float64(m.br.DotsW()), float64(m.br.DotsH())
	s := math.Min((dw-2)/sim.GridW, (dh-2)/sim.GridH)
	offX := (dw - sim.GridW*s) / 2
	offY := (dh - sim.GridH*s) / 2
	toDot := func(x, y float64) (float64, float64) {
		return offX + x*s, offY + (sim.GridH-y)*s
	}

	// rain background, pulsing gently per cell
	var fc *sim.Forecast
	if v.j != nil && v.showForecast {
		f := sim.NewForecast(v.j.Cells, v.j.ShiftX, v.j.ShiftY, &v.j.Noise)
		fc = &f
	}
	levels := make([]uint8, w*h)
	for cy := 0; cy < h; cy++ {
		for cx := 0; cx < w; cx++ {
			kx := (float64(cx*2+1) - offX) / s
			ky := sim.GridH - (float64(cy*4+2)-offY)/s
			if kx < -0.5 || kx > sim.GridW+0.5 || ky < -0.5 || ky > sim.GridH+0.5 {
				continue
			}
			c.SetBG(cx, cy, cCity)
			if v.j == nil {
				continue
			}
			var r float64
			if fc != nil {
				r = fc.At(kx, ky) * (1 + 0.06*math.Sin(2*v.t))
			} else {
				for i, cell := range v.j.Cells {
					pulse := 1 + 0.12*math.Sin(2.2*v.t+float64(i)*1.7)
					ex, ey := kx-cell.X, ky-cell.Y
					rad := cell.Radius * (1 + 0.04*math.Sin(2.2*v.t+float64(i)*1.7))
					r += cell.Peak * pulse * math.Exp(-(ex*ex+ey*ey)/(2*rad*rad))
				}
			}
			if lv := rainLevel(r); lv != 0 {
				c.SetBG(cx, cy, lv)
				levels[cy*w+cx] = lv
			}
		}
	}

	for _, ln := range net.Lines {
		col := cFaint
		if ln.Rail {
			col = cGoldDim
		}
		for i := 1; i < len(ln.Stops); i++ {
			x0, y0 := toDot(ln.Stops[i-1][0], ln.Stops[i-1][1])
			x1, y1 := toDot(ln.Stops[i][0], ln.Stops[i][1])
			m.br.Line(x0, y0, x1, y1, col)
		}
	}

	drawPath := func(path []int32, frac float64, colour func(model.Kind) uint8) {
		segs := 0
		for _, e := range path {
			if net.Tau[e] > 0 && !net.Kind[e].IsWait() && net.Kind[e] != model.Alight {
				segs++
			}
		}
		limit := frac * float64(segs)
		k := 0.0
		for _, e := range path {
			kind := net.Kind[e]
			if kind.IsWait() || kind == model.Alight {
				continue
			}
			if k >= limit {
				break
			}
			part := math.Min(1, limit-k)
			fx, fy := net.NodeX[net.From[e]], net.NodeY[net.From[e]]
			tx, ty := net.NodeX[net.To[e]], net.NodeY[net.To[e]]
			x0, y0 := toDot(fx, fy)
			x1, y1 := toDot(fx+(tx-fx)*part, fy+(ty-fy)*part)
			m.br.Line(x0, y0, x1, y1, colour(kind))
			k++
		}
	}
	if v.j != nil {
		drawPath(v.j.Out[v.base].Path, 1, func(model.Kind) uint8 { return cDim })
		if v.cmp != v.base {
			drawPath(v.j.Out[v.cmp].Path, v.frac, func(k model.Kind) uint8 { return kindColor[k] })
		}
	}

	for cy := 0; cy < h; cy++ {
		for cx := 0; cx < w; cx++ {
			if r, col, ok := m.br.Cell(cx, cy); ok {
				c.PutA(cx, cy, r, col, attrBold)
			} else if a.th.mono && levels[cy*w+cx] != 0 {
				shade := []rune{'·', '░', '░', '▒', '▒', '▓'}[min(int(levels[cy*w+cx]-cR1), 5)]
				c.Put(cx, cy, shade, cText)
			}
		}
	}
	if v.j != nil {
		ox, oy := toDot(float64(v.j.OX), float64(v.j.OY))
		dx, dy := toDot(float64(v.j.DX), float64(v.j.DY))
		c.PutA(int(ox/2), int(oy/4), 'O', cWhite, attrBold)
		c.PutA(int(dx/2), int(dy/4), 'D', cAmber, attrBold)
	}
}
