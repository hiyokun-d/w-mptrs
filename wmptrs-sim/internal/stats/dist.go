// Package stats provides the non-parametric tests used to compare routing
// variants: Friedman, Wilcoxon signed-rank, Holm correction and bootstrap CIs.
package stats

import (
	"math"
	"slices"
)

// NormalSF is the upper tail P(Z > z) of the standard normal.
func NormalSF(z float64) float64 { return 0.5 * math.Erfc(z/math.Sqrt2) }

// ChiSqSF is the upper tail P(X > x) of a chi-square with df degrees of freedom.
func ChiSqSF(x float64, df int) float64 {
	if x <= 0 {
		return 1
	}
	return gammaQ(float64(df)/2, x/2)
}

// gammaQ is the regularised upper incomplete gamma function Q(a, x).
func gammaQ(a, x float64) float64 {
	lg, _ := math.Lgamma(a)
	if x < a+1 {
		// series for P(a, x)
		sum, del, ap := 1/a, 1/a, a
		for i := 0; i < 500; i++ {
			ap++
			del *= x / ap
			sum += del
			if math.Abs(del) < math.Abs(sum)*1e-15 {
				break
			}
		}
		return 1 - sum*math.Exp(-x+a*math.Log(x)-lg)
	}
	// Lentz continued fraction for Q(a, x)
	const tiny = 1e-300
	b := x + 1 - a
	c := 1 / tiny
	d := 1 / b
	h := d
	for i := 1; i < 500; i++ {
		an := -float64(i) * (float64(i) - a)
		b += 2
		d = an*d + b
		if math.Abs(d) < tiny {
			d = tiny
		}
		c = b + an/c
		if math.Abs(c) < tiny {
			c = tiny
		}
		d = 1 / d
		del := d * c
		h *= del
		if math.Abs(del-1) < 1e-15 {
			break
		}
	}
	return math.Exp(-x+a*math.Log(x)-lg) * h
}

// Rank returns average ranks (1-based) of x and the tie term sum(t^3 - t).
func Rank(x []float64) (ranks []float64, ties float64) {
	n := len(x)
	idx := make([]int, n)
	for i := range idx {
		idx[i] = i
	}
	slices.SortStableFunc(idx, func(a, b int) int {
		switch {
		case x[a] < x[b]:
			return -1
		case x[a] > x[b]:
			return 1
		}
		return 0
	})
	ranks = make([]float64, n)
	for i := 0; i < n; {
		j := i
		for j+1 < n && x[idx[j+1]] == x[idx[i]] {
			j++
		}
		avg := float64(i+j)/2 + 1
		for m := i; m <= j; m++ {
			ranks[idx[m]] = avg
		}
		if t := float64(j - i + 1); t > 1 {
			ties += t*t*t - t
		}
		i = j + 1
	}
	return ranks, ties
}

// Median of x (does not modify x).
func Median(x []float64) float64 { return Quantile(x, 0.5) }

// Quantile with linear interpolation (type 7). Does not modify x.
func Quantile(x []float64, q float64) float64 {
	if len(x) == 0 {
		return 0
	}
	s := slices.Clone(x)
	slices.Sort(s)
	pos := q * float64(len(s)-1)
	lo := int(math.Floor(pos))
	hi := int(math.Ceil(pos))
	return s[lo] + (s[hi]-s[lo])*(pos-float64(lo))
}
