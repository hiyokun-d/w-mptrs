package stats

import (
	"math"
	"math/rand/v2"
	"testing"
)

func approx(a, b, tol float64) bool { return math.Abs(a-b) <= tol }

func TestHolm(t *testing.T) {
	got := Holm([]float64{0.01, 0.04, 0.03, 0.005})
	want := []float64{0.03, 0.06, 0.06, 0.02}
	for i := range want {
		if !approx(got[i], want[i], 1e-12) {
			t.Fatalf("Holm = %v, want %v", got, want)
		}
	}
	if got := Holm([]float64{0.5, 0.6}); got[0] != 1 || got[1] != 1 {
		t.Fatalf("Holm must cap at 1, got %v", got)
	}
}

func TestWilcoxonExactHandComputed(t *testing.T) {
	// ranks 2..10 positive, rank 1 negative: W+ = 54, W- = 1.
	// P(W- <= 1) = 2/1024, two-sided p = 4/1024.
	x := []float64{-1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
	y := make([]float64, len(x))
	r := Wilcoxon(x, y)
	if !r.Exact || r.WPlus != 54 || !approx(r.P, 4.0/1024, 1e-12) {
		t.Fatalf("got %+v", r)
	}
}

func TestWilcoxonExactMatchesEnumeration(t *testing.T) {
	rng := rand.New(rand.NewPCG(1, 2))
	for trial := 0; trial < 20; trial++ {
		n := 4 + rng.IntN(9)
		perm := rng.Perm(n)
		x := make([]float64, n)
		for i, p := range perm {
			x[i] = float64(p + 1)
			if rng.IntN(2) == 0 {
				x[i] = -x[i]
			}
		}
		res := Wilcoxon(x, make([]float64, n))
		// brute force over all 2^n sign patterns of ranks 1..n
		mean := float64(n*(n+1)) / 4
		obs := math.Abs(res.WPlus - mean)
		var extreme int
		for mask := 0; mask < 1<<n; mask++ {
			var w float64
			for k := 0; k < n; k++ {
				if mask&(1<<k) != 0 {
					w += float64(k + 1)
				}
			}
			if math.Abs(w-mean) >= obs-1e-9 {
				extreme++
			}
		}
		want := math.Min(1, float64(extreme)/float64(int(1)<<n))
		if !approx(res.P, want, 1e-12) {
			t.Fatalf("n=%d x=%v: p=%v want %v", n, x, res.P, want)
		}
	}
}

func TestWilcoxonNormalApprox(t *testing.T) {
	// 30 positive differences 1..30: W+ = 465, mean 232.5,
	// var = 30*31*61/24 = 2363.75, z = 232.5/sqrt(2363.75) = 4.78217...
	n := 30
	x := make([]float64, n)
	for i := range x {
		x[i] = float64(i + 1)
	}
	r := Wilcoxon(x, make([]float64, n))
	if r.Exact || !approx(r.Z, 232.5/math.Sqrt(2363.75), 1e-9) {
		t.Fatalf("got %+v", r)
	}
	if !approx(r.P, 2*NormalSF(r.Z), 1e-15) || r.P > 2e-6 {
		t.Fatalf("p = %v", r.P)
	}
	// all-zero differences
	if r := Wilcoxon([]float64{1, 2}, []float64{1, 2}); r.P != 1 || r.N != 0 {
		t.Fatalf("zeros: %+v", r)
	}
}

func TestFriedmanHandComputed(t *testing.T) {
	// identical ordering in 3 subjects: rank sums 3,6,9 -> chi2 = 6, p = e^-3.
	rows := [][]float64{{1, 2, 3}, {10, 20, 30}, {0.1, 0.5, 0.9}}
	r := Friedman(rows)
	if !approx(r.Chi2, 6, 1e-12) || !approx(r.P, math.Exp(-3), 1e-10) || r.DF != 2 {
		t.Fatalf("got %+v", r)
	}
	if r := Friedman([][]float64{{1, 1, 1}, {2, 2, 2}}); r.P != 1 {
		t.Fatalf("all ties: %+v", r)
	}
}

func TestChiSqSF(t *testing.T) {
	cases := []struct {
		x    float64
		df   int
		want float64
	}{{3.841458820694124, 1, 0.05}, {9.487729036781154, 4, 0.05}, {13.276704135987622, 4, 0.01}, {0.5, 4, 0.9735009788392561}}
	for _, c := range cases {
		if got := ChiSqSF(c.x, c.df); !approx(got, c.want, 1e-9) {
			t.Errorf("ChiSqSF(%v,%d) = %v want %v", c.x, c.df, got, c.want)
		}
	}
}

func TestRankTies(t *testing.T) {
	r, ties := Rank([]float64{3, 1, 3, 2})
	want := []float64{3.5, 1, 3.5, 2}
	for i := range want {
		if r[i] != want[i] {
			t.Fatalf("ranks %v", r)
		}
	}
	if ties != 6 {
		t.Fatalf("tie term %v", ties)
	}
}

func TestBootstrapDeterministic(t *testing.T) {
	x := []float64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
	mean := func(idx []int) float64 {
		var s float64
		for _, i := range idx {
			s += x[i]
		}
		return s / float64(len(idx))
	}
	lo1, hi1 := BootstrapCI(len(x), 2000, 0.95, 7, mean)
	lo2, hi2 := BootstrapCI(len(x), 2000, 0.95, 7, mean)
	if lo1 != lo2 || hi1 != hi2 || !(lo1 < 5.5 && hi1 > 5.5) {
		t.Fatalf("CI [%v,%v] / [%v,%v]", lo1, hi1, lo2, hi2)
	}
}
