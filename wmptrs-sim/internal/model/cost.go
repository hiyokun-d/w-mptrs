package model

// Kind classifies a graph edge by travel mode and exposure.
type Kind uint8

const (
	Walk Kind = iota
	Moto
	WaitBRT  // boarding wait at an open BRT stop
	WaitRail // boarding wait inside a rail station (includes access)
	RideBus
	RideRail
	Alight // zero-time transfer from a stop back to the street
	numKinds
)

var kindNames = [numKinds]string{"walk", "moto", "wait-brt", "wait-rail", "ride-bus", "ride-rail", "alight"}

func (k Kind) String() string { return kindNames[k] }

// Weight is the value-of-time multiplier w_m: 1.5 for walking and waiting,
// 1.0 for riding.
func (k Kind) Weight() float64 {
	switch k {
	case Walk, WaitBRT, WaitRail:
		return 1.5
	}
	return 1.0
}

// Exposure is the rain-exposure coefficient E. Outcomes are always scored with
// this value, whatever the variant assumed while routing.
func (k Kind) Exposure() float64 {
	switch k {
	case Walk, Moto:
		return 1
	case WaitBRT:
		return 0.4
	case WaitRail:
		return 0.1
	}
	return 0
}

// IsWait reports whether the edge is a boarding wait.
func (k Kind) IsWait() bool { return k == WaitBRT || k == WaitRail }

// alpha returns the A2 linear coefficient (per mm/h above r0) for the edge mode.
func (k Kind) alpha() float64 {
	switch k {
	case Moto:
		return 0.065
	case Walk:
		return 0.060
	case WaitBRT, RideBus:
		return 0.010
	case WaitRail, RideRail:
		return 0.005
	}
	return 0
}

// Variant identifies a routing cost function.
type Variant uint8

const (
	A0 Variant = iota // time only
	A1                // hard threshold
	A2                // linear excess rain
	A3                // proposed Discomfort Penalty
	A4                // A3 with waiting treated as enclosed
	NumVariants
)

var variantNames = [NumVariants]string{"A0", "A1", "A2", "A3", "A4"}
var variantDesc = [NumVariants]string{"time only", "hard threshold", "linear", "DP (proposed)", "DP, enclosed wait"}

func (v Variant) String() string { return variantNames[v] }

// Describe returns a short human-readable description.
func (v Variant) Describe() string { return variantDesc[v] }

// Cost is the generalised cost of an edge with travel time tau (minutes) and
// forecast rain rhat (mm/h) under variant v.
func (v Variant) Cost(tau float64, k Kind, rhat float64, p Params) float64 {
	base := tau * p.Shelter.W(k)
	switch v {
	case A1:
		if p.Shelter.E(k) > 0 && rhat >= p.R0 {
			return base * (1 + p.Beta)
		}
		return base
	case A2:
		excess := rhat - p.R0
		if excess <= 0 {
			return base
		}
		return base * (1 + p.AlphaScale*k.alpha()*excess)
	case A3:
		return base * (1 + p.Beta*p.Shelter.E(k)*Phi(rhat, p))
	case A4:
		e := p.Shelter.E(k)
		if k.IsWait() {
			e = 0
		}
		return base * (1 + p.Beta*e*Phi(rhat, p))
	}
	return base
}
