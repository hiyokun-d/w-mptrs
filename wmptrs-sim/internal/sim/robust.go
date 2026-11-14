package sim

import (
	"context"
	"math"
	"runtime"
	"sync"

	"wmptrs-sim/internal/model"
	"wmptrs-sim/internal/stats"
)

// parallel runs f(i) for i in [0, n) on all CPUs and reports progress.
// Results must be written by index so the output stays deterministic.
func parallel(ctx context.Context, n int, onDone func(done, total int), f func(i int)) error {
	jobs := make(chan int)
	var wg sync.WaitGroup
	var mu sync.Mutex
	done := 0
	for w := 0; w < runtime.NumCPU(); w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				f(i)
				if onDone != nil {
					mu.Lock()
					done++
					onDone(done, n)
					mu.Unlock()
				}
			}
		}()
	}
	var err error
feed:
	for i := 0; i < n; i++ {
		select {
		case jobs <- i:
		case <-ctx.Done():
			err = ctx.Err()
			break feed
		}
	}
	close(jobs)
	wg.Wait()
	return err
}

// quick routes the five variants (no oracle, no paths) and returns the
// per-journey outcomes.
func quick(ctx context.Context, p Params) ([]Journey, error) {
	net := NewNetwork(p.Seed)
	setups := GenSetups(p.Journeys, p.Seed, p.Sigma, p.Shift)
	ev := &evaluator{net: net, cfgs: VariantConfigs(p.Model()), r0: p.R0, sh: p.Shelter}
	return ev.run(ctx, setups, 1, nil)
}

// headline returns total dose reduction and time increase (%) per variant
// relative to A0.
func headline(js []Journey) (red, inc [model.NumVariants]float64) {
	var d, t [model.NumVariants]float64
	for i := range js {
		for v := range js[i].Out {
			d[v] += js[i].Out[v].Dose
			t[v] += js[i].Out[v].T
		}
	}
	for v := range d {
		if d[0] > 0 {
			red[v] = round(100*(1-d[v]/d[0]), 3)
		}
		if t[0] > 0 {
			inc[v] = round(100*(t[v]/t[0]-1), 3)
		}
	}
	return red, inc
}

// SeedRow is the headline of one independent seed.
type SeedRow struct {
	Seed       uint64                     `json:"seed"`
	DoseRedPct [model.NumVariants]float64 `json:"dose_reduction_pct"`
	TimeIncPct [model.NumVariants]float64 `json:"time_increase_pct"`
}

// Contest counts in how many seeds A3 reduced dose more than a rival.
type Contest struct {
	Vs     string  `json:"vs"`
	A3Wins int     `json:"a3_wins"`
	Ties   int     `json:"ties"`
	Seeds  int     `json:"seeds"`
	SignP  float64 `json:"sign_test_p"`
	MeanD  float64 `json:"mean_diff_pts"` // mean (A3 − rival) dose-reduction points
}

// SeedStudy repeats the experiment over independent seeds (new city link
// times, journeys, storms and forecast errors each time).
type SeedStudy struct {
	Rows      []SeedRow                  `json:"rows"`
	MeanRed   [model.NumVariants]float64 `json:"mean_dose_reduction_pct"`
	SDRed     [model.NumVariants]float64 `json:"sd_dose_reduction_pct"`
	MeanInc   [model.NumVariants]float64 `json:"mean_time_increase_pct"`
	SDInc     [model.NumVariants]float64 `json:"sd_time_increase_pct"`
	Contests  []Contest                  `json:"a3_vs"`
	Journeys  int                        `json:"journeys_per_seed"`
	FirstSeed uint64                     `json:"first_seed"`
}

// Seeds runs the experiment for n consecutive seeds starting at p.Seed.
func Seeds(ctx context.Context, p Params, n int, onDone func(done, total int)) (*SeedStudy, error) {
	st := &SeedStudy{Rows: make([]SeedRow, n), Journeys: p.Journeys, FirstSeed: p.Seed}
	var firstErr error
	var mu sync.Mutex
	err := parallel(ctx, n, onDone, func(i int) {
		q := p
		q.Seed = p.Seed + uint64(i)
		js, err := quick(ctx, q)
		if err != nil {
			mu.Lock()
			firstErr = err
			mu.Unlock()
			return
		}
		red, inc := headline(js)
		st.Rows[i] = SeedRow{Seed: q.Seed, DoseRedPct: red, TimeIncPct: inc}
	})
	if err == nil {
		err = firstErr
	}
	if err != nil {
		return nil, err
	}
	for v := 0; v < int(model.NumVariants); v++ {
		var r, t []float64
		for _, row := range st.Rows {
			r = append(r, row.DoseRedPct[v])
			t = append(t, row.TimeIncPct[v])
		}
		st.MeanRed[v], st.SDRed[v] = meanSD(r)
		st.MeanInc[v], st.SDInc[v] = meanSD(t)
	}
	for _, rv := range []model.Variant{model.A1, model.A2, model.A4} {
		c := Contest{Vs: rv.String(), Seeds: n}
		var diff float64
		for _, row := range st.Rows {
			d := row.DoseRedPct[model.A3] - row.DoseRedPct[rv]
			diff += d
			switch {
			case math.Abs(d) < 1e-9:
				c.Ties++
			case d > 0:
				c.A3Wins++
			}
		}
		c.MeanD = round(diff/float64(max(n, 1)), 3)
		c.SignP = signTest(c.A3Wins, n-c.Ties-c.A3Wins)
		st.Contests = append(st.Contests, c)
	}
	return st, nil
}

func meanSD(x []float64) (float64, float64) {
	if len(x) == 0 {
		return 0, 0
	}
	var m float64
	for _, v := range x {
		m += v
	}
	m /= float64(len(x))
	var s float64
	for _, v := range x {
		s += (v - m) * (v - m)
	}
	if len(x) > 1 {
		s = math.Sqrt(s / float64(len(x)-1))
	}
	return round(m, 3), round(s, 3)
}

// signTest is the exact two-sided binomial sign test for wins vs losses.
func signTest(wins, losses int) float64 {
	n := wins + losses
	if n == 0 {
		return 1
	}
	k := min(wins, losses)
	var tail float64
	for i := 0; i <= k; i++ {
		tail += math.Exp(lchoose(n, i) - float64(n)*math.Ln2)
	}
	return math.Min(1, 2*tail)
}

func lchoose(n, k int) float64 {
	a, _ := math.Lgamma(float64(n + 1))
	b, _ := math.Lgamma(float64(k + 1))
	c, _ := math.Lgamma(float64(n - k + 1))
	return a - b - c
}

// SensRow is the experiment re-run with one assumed constant changed.
type SensRow struct {
	Param      string                     `json:"param"`
	Value      float64                    `json:"value"`
	IsDefault  bool                       `json:"is_default"`
	DoseRedPct [model.NumVariants]float64 `json:"dose_reduction_pct"`
	TimeIncPct [model.NumVariants]float64 `json:"time_increase_pct"`
	// Holm-adjusted Wilcoxon p, A3 vs A1, A2, A4 on per-journey dose.
	PHolm [3]float64 `json:"p_holm_a3_vs_a1_a2_a4"`
}

// SensitivityGrid lists the one-at-a-time changes. E and w_m change in
// both routing and scoring: it is the world that changes, not just the
// router's belief.
var SensitivityGrid = []struct {
	Param  string
	Values []float64
}{
	{"E_brt_wait", []float64{0.2, 0.4, 0.6, 0.8, 1.0}},
	{"E_rail_wait", []float64{0, 0.1, 0.3, 0.5}},
	{"w_walk_wait", []float64{1.0, 1.5, 2.0, 2.5}},
}

// Sensitivity runs every grid point on the same seed and journeys.
func Sensitivity(ctx context.Context, p Params, onDone func(done, total int)) ([]SensRow, error) {
	type job struct {
		param string
		val   float64
	}
	var jobs []job
	for _, g := range SensitivityGrid {
		for _, v := range g.Values {
			jobs = append(jobs, job{g.Param, v})
		}
	}
	rows := make([]SensRow, len(jobs))
	var firstErr error
	var mu sync.Mutex
	err := parallel(ctx, len(jobs), onDone, func(i int) {
		jb := jobs[i]
		sh := model.DefaultShelter()
		def := model.DefaultShelter()
		var isDef bool
		switch jb.param {
		case "E_brt_wait":
			sh.EBRT, isDef = jb.val, jb.val == def.EBRT
		case "E_rail_wait":
			sh.ERail, isDef = jb.val, jb.val == def.ERail
		case "w_walk_wait":
			sh.WOut, isDef = jb.val, jb.val == def.WOut
		}
		q := p
		q.Shelter = sh
		js, err := quick(ctx, q)
		if err != nil {
			mu.Lock()
			firstErr = err
			mu.Unlock()
			return
		}
		red, inc := headline(js)
		row := SensRow{Param: jb.param, Value: jb.val, IsDefault: isDef, DoseRedPct: red, TimeIncPct: inc}
		dose := func(v model.Variant) []float64 {
			d := make([]float64, len(js))
			for k := range js {
				d[k] = js[k].Out[v].Dose
			}
			return d
		}
		var ps []float64
		for _, rv := range []model.Variant{model.A1, model.A2, model.A4} {
			ps = append(ps, stats.Wilcoxon(dose(model.A3), dose(rv)).P)
		}
		copy(row.PHolm[:], stats.Holm(ps))
		rows[i] = row
	})
	if err == nil {
		err = firstErr
	}
	return rows, err
}
