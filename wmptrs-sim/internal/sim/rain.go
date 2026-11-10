package sim

import (
	"math"
	"math/rand/v2"
)

// Forecast blocks are 2x2 km.
const (
	BlockKm = 2
	BX      = GridW / BlockKm
	BY      = GridH / BlockKm
)

// Cell is a Gaussian rain cell.
type Cell struct {
	X, Y   float64 // centre, km
	Peak   float64 // mm/h
	Radius float64 // km (Gaussian sigma)
}

// RainAt evaluates the summed rain field at (x, y), with the whole field
// displaced by (dx, dy).
func RainAt(cells []Cell, x, y, dx, dy float64) float64 {
	var r float64
	for _, c := range cells {
		ex, ey := x-dx-c.X, y-dy-c.Y
		r += c.Peak * math.Exp(-(ex*ex+ey*ey)/(2*c.Radius*c.Radius))
	}
	return r
}

// Forecast is the block-averaged, displaced, noisy rain the router sees.
type Forecast [BX * BY]float64

// NewForecast samples the displaced truth on a 4x4 sub-grid per block and
// multiplies each block by its noise factor.
func NewForecast(cells []Cell, shiftX, shiftY float64, noise *[BX * BY]float64) Forecast {
	var f Forecast
	const sub = 4
	for by := 0; by < BY; by++ {
		for bx := 0; bx < BX; bx++ {
			var s float64
			for j := 0; j < sub; j++ {
				for i := 0; i < sub; i++ {
					x := (float64(bx) + (float64(i)+0.5)/sub) * BlockKm
					y := (float64(by) + (float64(j)+0.5)/sub) * BlockKm
					s += RainAt(cells, x, y, shiftX, shiftY)
				}
			}
			k := by*BX + bx
			f[k] = s / (sub * sub) * noise[k]
		}
	}
	return f
}

// At returns the forecast for the block containing (x, y).
func (f *Forecast) At(x, y float64) float64 {
	bx := min(max(int(x/BlockKm), 0), BX-1)
	by := min(max(int(y/BlockKm), 0), BY-1)
	return f[by*BX+bx]
}

// Setup is everything random about one journey, drawn before routing.
type Setup struct {
	OX, OY, DX, DY int
	Cells          []Cell
	ShiftX, ShiftY float64
	Noise          [BX * BY]float64
}

// GenSetups draws n journeys deterministically from seed. Rain cells are
// centred near the OD corridor so most journeys meet some rain.
func GenSetups(n int, seed uint64, sigma, shift float64) []Setup {
	rng := rand.New(rand.NewPCG(seed, 0x6a6f75726e))
	out := make([]Setup, n)
	for i := range out {
		s := &out[i]
		for {
			s.OX, s.OY = rng.IntN(NX), rng.IntN(NY)
			s.DX, s.DY = rng.IntN(NX), rng.IntN(NY)
			if math.Hypot(float64(s.DX-s.OX), float64(s.DY-s.OY)) >= 8 {
				break
			}
		}
		nc := 1 + rng.IntN(3)
		for c := 0; c < nc; c++ {
			t := 0.15 + 0.7*rng.Float64()
			cx := float64(s.OX) + t*float64(s.DX-s.OX) + 2.5*rng.NormFloat64()
			cy := float64(s.OY) + t*float64(s.DY-s.OY) + 2.5*rng.NormFloat64()
			s.Cells = append(s.Cells, Cell{
				X:      min(max(cx, 0), GridW),
				Y:      min(max(cy, 0), GridH),
				Peak:   10 + 30*rng.Float64(),
				Radius: 1.5 + 2.5*rng.Float64(),
			})
		}
		s.ShiftX, s.ShiftY = shift*rng.NormFloat64(), shift*rng.NormFloat64()
		for k := range s.Noise {
			s.Noise[k] = math.Exp(sigma * rng.NormFloat64())
		}
	}
	return out
}
