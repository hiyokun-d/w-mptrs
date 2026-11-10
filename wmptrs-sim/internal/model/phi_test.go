package model

import (
	"math"
	"testing"
)

func TestPhiPaperValues(t *testing.T) {
	p := Default()
	cases := []struct{ r, want float64 }{{1, 0.03}, {5, 0.49}, {7.5, 0.86}, {10, 0.98}}
	for _, c := range cases {
		got := math.Round(Phi(c.r, p)*100) / 100
		if got != c.want {
			t.Errorf("phi(%v) = %.4f, want %.2f", c.r, Phi(c.r, p), c.want)
		}
	}
}

func TestPhiBoundsAndMonotone(t *testing.T) {
	p := Default()
	if Phi(0, p) != 0 || Phi(-3, p) != 0 {
		t.Fatal("phi must be 0 for r <= 0")
	}
	prev := 0.0
	for r := 0.1; r < 60; r += 0.1 {
		v := Phi(r, p)
		if v < prev || v > 1 {
			t.Fatalf("phi not monotone in [0,1] at r=%v: %v", r, v)
		}
		prev = v
	}
}
