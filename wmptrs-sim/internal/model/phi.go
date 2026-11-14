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
	// Shelter overrides the exposure and value-of-time constants for the
	// sensitivity analysis; the zero value means the paper defaults.
	Shelter Shelter
}

// Shelter holds the assumed constants a reviewer is most likely to question.
// When Set is false every method returns the paper default.
type Shelter struct {
	Set   bool
	EBRT  float64 // exposure while waiting at an open BRT halte (default 0.4)
	ERail float64 // exposure while waiting in a rail station (default 0.1)
	WOut  float64 // value-of-time weight for walking and waiting (default 1.5)
}

// E is the exposure coefficient of k under these constants.
func (s Shelter) E(k Kind) float64 {
	if s.Set {
		switch k {
		case WaitBRT:
			return s.EBRT
		case WaitRail:
			return s.ERail
		}
	}
	return k.Exposure()
}

// W is the value-of-time weight of k under these constants.
func (s Shelter) W(k Kind) float64 {
	if s.Set && k.Weight() > 1 {
		return s.WOut
	}
	return k.Weight()
}

// DefaultShelter returns the paper constants with Set = true, as a starting
// point for one-at-a-time changes.
func DefaultShelter() Shelter {
	return Shelter{Set: true, EBRT: 0.4, ERail: 0.1, WOut: 1.5}
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
