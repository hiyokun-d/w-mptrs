package stats

import (
	"math"
	"math/rand/v2"
	"slices"
)

// WilcoxonResult is a two-sided Wilcoxon signed-rank test on paired samples.
type WilcoxonResult struct {
	N     int     `json:"n"` // non-zero differences
	WPlus float64 `json:"w_plus"`
	Z     float64 `json:"z"`
	P     float64 `json:"p"`
	Exact bool    `json:"exact"`
}

// Wilcoxon tests whether the paired differences x-y are centred on zero.
// Zero differences are dropped; ties get average ranks. The exact null
// distribution is used for n <= 25 without ties, else the tie-corrected
// normal approximation.
func Wilcoxon(x, y []float64) WilcoxonResult {
	var d []float64
	for i := range x {
		if diff := x[i] - y[i]; diff != 0 {
			d = append(d, diff)
		}
	}
	n := len(d)
	if n == 0 {
		return WilcoxonResult{P: 1}
	}
	abs := make([]float64, n)
	for i, v := range d {
		abs[i] = math.Abs(v)
	}
	r, ties := Rank(abs)
	var wp float64
	for i, v := range d {
		if v > 0 {
			wp += r[i]
		}
	}
	fn := float64(n)
	mean := fn * (fn + 1) / 4
	res := WilcoxonResult{N: n, WPlus: wp}
	v := fn*(fn+1)*(2*fn+1)/24 - ties/48
	if v <= 0 {
		res.P = 1
		return res
	}
	res.Z = (wp - mean) / math.Sqrt(v)
	if n <= 25 && ties == 0 {
		res.Exact = true
		res.P = exactSignedRankP(n, wp)
	} else {
		res.P = math.Min(1, 2*NormalSF(math.Abs(res.Z)))
	}
	return res
}

// exactSignedRankP returns the two-sided exact p for statistic W+ = w with
// integer ranks 1..n.
func exactSignedRankP(n int, w float64) float64 {
	max := n * (n + 1) / 2
	count := make([]float64, max+1)
	count[0] = 1
	for k := 1; k <= n; k++ {
		for s := max; s >= k; s-- {
			count[s] += count[s-k]
		}
	}
	total := math.Ldexp(1, n)
	t := int(math.Round(math.Min(w, float64(max)-w)))
	var tail float64
	for s := 0; s <= t; s++ {
		tail += count[s]
	}
	return math.Min(1, 2*tail/total)
}

// FriedmanResult is the Friedman rank test across k related samples.
type FriedmanResult struct {
	Chi2 float64 `json:"chi2"`
	DF   int     `json:"df"`
	P    float64 `json:"p"`
	N    int     `json:"n"`
}

// Friedman takes rows = subjects (journeys), columns = treatments (variants).
func Friedman(rows [][]float64) FriedmanResult {
	n := len(rows)
	if n == 0 {
		return FriedmanResult{P: 1}
	}
	k := len(rows[0])
	R := make([]float64, k)
	var ties float64
	for _, row := range rows {
		r, t := Rank(row)
		ties += t
		for j := range r {
			R[j] += r[j]
		}
	}
	fn, fk := float64(n), float64(k)
	var ssum float64
	for _, v := range R {
		ssum += v * v
	}
	chi := 12/(fn*fk*(fk+1))*ssum - 3*fn*(fk+1)
	c := 1 - ties/(fn*fk*(fk*fk-1))
	res := FriedmanResult{DF: k - 1, N: n}
	if c <= 1e-12 {
		res.P = 1
		return res
	}
	res.Chi2 = chi / c
	res.P = ChiSqSF(res.Chi2, k-1)
	return res
}

// Holm returns Holm–Bonferroni step-down adjusted p-values in input order.
func Holm(p []float64) []float64 {
	m := len(p)
	idx := make([]int, m)
	for i := range idx {
		idx[i] = i
	}
	slices.SortStableFunc(idx, func(a, b int) int {
		switch {
		case p[a] < p[b]:
			return -1
		case p[a] > p[b]:
			return 1
		}
		return 0
	})
	adj := make([]float64, m)
	running := 0.0
	for rank, i := range idx {
		v := math.Min(1, float64(m-rank)*p[i])
		running = math.Max(running, v)
		adj[i] = running
	}
	return adj
}

// BootstrapCI returns the percentile interval of stat over B resamples (with
// replacement) of n indices. Deterministic for a given seed.
func BootstrapCI(n, B int, level float64, seed uint64, stat func(idx []int) float64) (lo, hi float64) {
	if n == 0 {
		return 0, 0
	}
	rng := rand.New(rand.NewPCG(seed, 0xb007))
	idx := make([]int, n)
	vals := make([]float64, B)
	for b := range vals {
		for i := range idx {
			idx[i] = rng.IntN(n)
		}
		vals[b] = stat(idx)
	}
	a := (1 - level) / 2
	return Quantile(vals, a), Quantile(vals, 1-a)
}

// PRF computes precision, recall and F1 from confusion counts (0 when undefined).
func PRF(tp, fp, fn int) (p, r, f1 float64) {
	if tp+fp > 0 {
		p = float64(tp) / float64(tp+fp)
	}
	if tp+fn > 0 {
		r = float64(tp) / float64(tp+fn)
	}
	if p+r > 0 {
		f1 = 2 * p * r / (p + r)
	}
	return
}
