package model

import (
	"math"
	"testing"
)

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func TestA0IsTimeTimesWeight(t *testing.T) {
	p := Default()
	if got := A0.Cost(10, Walk, 30, p); !near(got, 15) {
		t.Errorf("A0 walk = %v, want 15", got)
	}
	if got := A0.Cost(10, Moto, 30, p); !near(got, 10) {
		t.Errorf("A0 moto = %v, want 10", got)
	}
}

func TestA1Threshold(t *testing.T) {
	p := Default()
	p.Beta = 2
	if got := A1.Cost(10, Moto, 4.99, p); !near(got, 10) {
		t.Errorf("A1 below r0 = %v, want 10", got)
	}
	if got := A1.Cost(10, Moto, 5, p); !near(got, 30) {
		t.Errorf("A1 at r0 = %v, want 30", got)
	}
	if got := A1.Cost(10, WaitRail, 20, p); !near(got, 45) { // exposed (E=0.1>0)
		t.Errorf("A1 rail wait = %v, want 45", got)
	}
	if got := A1.Cost(10, RideBus, 20, p); !near(got, 10) {
		t.Errorf("A1 in-vehicle = %v, want 10", got)
	}
}

func TestA2Linear(t *testing.T) {
	p := Default()
	if got := A2.Cost(10, Moto, 15, p); !near(got, 10*(1+0.065*10)) {
		t.Errorf("A2 moto = %v", got)
	}
	if got := A2.Cost(10, Walk, 15, p); !near(got, 15*(1+0.060*10)) {
		t.Errorf("A2 walk = %v", got)
	}
	if got := A2.Cost(10, RideRail, 15, p); !near(got, 10*(1+0.005*10)) {
		t.Errorf("A2 rail = %v", got)
	}
	if got := A2.Cost(10, Moto, 3, p); !near(got, 10) {
		t.Errorf("A2 below r0 = %v", got)
	}
	p.AlphaScale = 2
	if got := A2.Cost(10, Moto, 15, p); !near(got, 10*(1+0.13*10)) {
		t.Errorf("A2 scaled = %v", got)
	}
}

func TestA3DP(t *testing.T) {
	p := Default()
	r := 7.5
	phi := Phi(r, p)
	if got := A3.Cost(10, Walk, r, p); !near(got, 15*(1+phi)) {
		t.Errorf("A3 walk = %v", got)
	}
	if got := A3.Cost(10, WaitBRT, r, p); !near(got, 15*(1+0.4*phi)) {
		t.Errorf("A3 brt wait = %v", got)
	}
	if got := A3.Cost(10, WaitRail, r, p); !near(got, 15*(1+0.1*phi)) {
		t.Errorf("A3 rail wait = %v", got)
	}
	if got := A3.Cost(10, Moto, 0, p); !near(got, 10) {
		t.Errorf("A3 dry = %v", got)
	}
}

func TestA4EnclosedWait(t *testing.T) {
	p := Default()
	for _, k := range []Kind{WaitBRT, WaitRail} {
		if got := A4.Cost(4, k, 30, p); !near(got, A0.Cost(4, k, 30, p)) {
			t.Errorf("A4 %v = %v, want A0 cost", k, got)
		}
	}
	if !near(A4.Cost(10, Walk, 8, p), A3.Cost(10, Walk, 8, p)) {
		t.Error("A4 walk must equal A3 walk")
	}
}

func TestInVehicleUnpenalised(t *testing.T) {
	p := Default()
	p.Beta = 8
	for v := A0; v < NumVariants; v++ {
		for _, k := range []Kind{RideBus, RideRail} {
			want := 10.0
			if v == A2 {
				want = 10 * (1 + k.alpha()*25)
			}
			if got := v.Cost(10, k, 30, p); !near(got, want) {
				t.Errorf("%v %v = %v, want %v", v, k, got, want)
			}
		}
	}
}

func TestShelterOverride(t *testing.T) {
	p := Default()
	r := 7.5
	if A3.Cost(10, WaitBRT, r, p) != func() float64 { q := p; q.Shelter = DefaultShelter(); return A3.Cost(10, WaitBRT, r, q) }() {
		t.Fatal("DefaultShelter must reproduce the paper constants")
	}
	p.Shelter = DefaultShelter()
	p.Shelter.EBRT, p.Shelter.WOut = 0.8, 2
	if got := A3.Cost(10, WaitBRT, r, p); !near(got, 20*(1+0.8*Phi(r, p))) {
		t.Errorf("overridden BRT wait = %v", got)
	}
	if got := A3.Cost(10, Moto, r, p); !near(got, 10*(1+Phi(r, p))) {
		t.Errorf("moto must be unaffected = %v", got)
	}
}
