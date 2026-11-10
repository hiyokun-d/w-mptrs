// Package model implements the Discomfort Penalty (DP) edge-cost model and
// the comparison variants A0–A4.
package model

import "math"

// Params holds the tunable DP parameters.
type Params struct {
	Beta float64 // weight of the discomfort term
	R0   float64 // rain intensity (mm/h) at the sigmoid midpoint
	K    float64 // sigmoid steepness
	// AlphaScale multiplies the A2 linear coefficients (1 = paper values).
	// Only used for the A2 family in the trade-off sweep.
	AlphaScale float64
}

// Default returns the paper's default parameters.
func Default() Params {
	return Params{Beta: 1, R0: 5, K: 0.74, AlphaScale: 1}
}

func sig(r, r0, k float64) float64 {
	return 1 / (1 + math.Exp(-k*(r-r0)))
}

// Phi is the normalised rain-discomfort response in [0, 1):
// phi(r) = (sig(r) - sig(0)) / (1 - sig(0)).
func Phi(r float64, p Params) float64 {
	if r <= 0 {
		return 0
	}
	s0 := sig(0, p.R0, p.K)
	return (sig(r, p.R0, p.K) - s0) / (1 - s0)
}
