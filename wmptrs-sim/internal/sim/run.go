package sim

import (
	"context"
	"runtime"
	"slices"
	"sync"
	"time"

	"wmptrs-sim/internal/model"
)

// Params are the experiment settings.
type Params struct {
	Beta     float64 `json:"beta"`
	R0       float64 `json:"r0"`
	K        float64 `json:"k"`
	Sigma    float64 `json:"forecast_sigma"`
	Shift    float64 `json:"location_shift_km"`
	Journeys int     `json:"journeys"`
	Seed     uint64  `json:"seed"`
	// Shelter overrides E and w_m for routing and scoring (sensitivity runs).
	Shelter model.Shelter `json:"-"`
}

// Model returns the DP model parameters.
func (p Params) Model() model.Params {
	return model.Params{Beta: p.Beta, R0: p.R0, K: p.K, AlphaScale: 1, Shelter: p.Shelter}
}

// Preset is a named parameter set.
type Preset struct {
	Name   string
	Params Params
}

// Presets offered in the UI and via --preset.
func Presets() []Preset {
	def := Params{Beta: 1, R0: 5, K: 0.74, Sigma: 0.3, Shift: 1.5, Journeys: 400, Seed: 2026}
	perfect, high, averse := def, def, def
	perfect.Sigma, perfect.Shift = 0, 0
	high.Sigma, high.Shift = 0.8, 4
	averse.Beta = 4
	return []Preset{
		{"Paper default", def},
		{"Perfect forecast", perfect},
		{"High error", high},
		{"Rain-averse (beta 4)", averse},
	}
}

// Config is one routing cost function to evaluate.
type Config struct {
	V model.Variant
	P model.Params
}

// Outcome of routing one journey under one config, scored on the true rain.
type Outcome struct {
	T        float64 // minutes
	Dose     float64 // mm: (1/60) sum tau*E*r_true
	Exposed  float64 // minutes on exposed edges with r_true >= r0
	Moto     bool
	Rerouted bool    // path differs from config 0 (A0)
	RouteNS  int64   // pricing + both shortest-path calls
	Path     []int32 // edge ids, kept only when requested
}

// Journey is a setup plus its outcomes per config.
type Journey struct {
	Index int
	Setup
	Out    []Outcome
	Oracle Outcome // A3 routed on the true field
}

// Progress is streamed while a run executes. The final message has Result set.
type Progress struct {
	Done, Total int
	Journey     *Journey
	Result      *Result
}

// evaluator routes journeys under a fixed list of configs.
type evaluator struct {
	net       *Network
	cfgs      []Config
	oracle    bool
	keepPaths bool
	r0        float64
	sh        model.Shelter // exposure used to score outcomes
}

func (ev *evaluator) journey(rt *router, idx int, s Setup, rtrue, rhat []float64, scratch []int32) Journey {
	n := ev.net
	fc := NewForecast(s.Cells, s.ShiftX, s.ShiftY, &s.Noise)
	for e := range rtrue {
		rtrue[e] = RainAt(s.Cells, n.MidX[e], n.MidY[e], 0, 0)
		rhat[e] = fc.At(n.MidX[e], n.MidY[e])
	}
	j := Journey{Index: idx, Setup: s, Out: make([]Outcome, len(ev.cfgs))}
	var base []int32
	route := func(c Config, field []float64) Outcome {
		t0 := time.Now()
		for e := range rt.cost {
			rt.cost[e] = c.V.Cost(n.Tau[e], n.Kind[e], field[e], c.P)
		}
		var cm, ct float64
		cm, scratch = rt.shortest(MotoNode(s.OX, s.OY), MotoNode(s.DX, s.DY), scratch[:0])
		split := len(scratch)
		ct, scratch = rt.shortest(WalkNode(s.OX, s.OY), WalkNode(s.DX, s.DY), scratch)
		o := Outcome{RouteNS: time.Since(t0).Nanoseconds()}
		path := scratch[split:]
		if cm <= ct {
			o.Moto, path = true, scratch[:split]
		}
		for _, e := range path {
			tau, ex := n.Tau[e], ev.sh.E(n.Kind[e])
			o.T += tau
			o.Dose += tau * ex * rtrue[e] / 60
			if ex > 0 && rtrue[e] >= ev.r0 {
				o.Exposed += tau
			}
		}
		if base == nil {
			base = slices.Clone(path)
		} else {
			o.Rerouted = !slices.Equal(base, path)
		}
		if ev.keepPaths {
			o.Path = slices.Clone(path)
		}
		return o
	}
	for i, c := range ev.cfgs {
		j.Out[i] = route(c, rhat)
	}
	if ev.oracle {
		j.Oracle = route(Config{model.A3, ev.cfgs[model.A3].P}, rtrue)
	}
	return j
}

// run evaluates all setups in parallel. Results are placed by index, so the
// output is deterministic regardless of scheduling. onDone may be nil.
func (ev *evaluator) run(ctx context.Context, setups []Setup, workers int, onDone func(done int, j *Journey)) ([]Journey, error) {
	if workers <= 0 {
		workers = runtime.NumCPU()
	}
	out := make([]Journey, len(setups))
	jobs := make(chan int)
	var wg sync.WaitGroup
	var mu sync.Mutex
	done := 0
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rt := newRouter(ev.net)
			m := ev.net.NumEdges()
			rtrue, rhat := make([]float64, m), make([]float64, m)
			scratch := make([]int32, 0, 256)
			for i := range jobs {
				out[i] = ev.journey(rt, i, setups[i], rtrue, rhat, scratch)
				if onDone != nil {
					mu.Lock()
					done++
					onDone(done, &out[i])
					mu.Unlock()
				}
			}
		}()
	}
	var err error
feed:
	for i := range setups {
		select {
		case jobs <- i:
		case <-ctx.Done():
			err = ctx.Err()
			break feed
		}
	}
	close(jobs)
	wg.Wait()
	return out, err
}

// Result of a full five-variant run.
type Result struct {
	Params   Params
	Net      *Network
	Journeys []Journey
	Summary  Summary
	Elapsed  time.Duration
}

// VariantConfigs returns A0..A4 with the given model parameters.
func VariantConfigs(mp model.Params) []Config {
	cfgs := make([]Config, model.NumVariants)
	for v := range cfgs {
		cfgs[v] = Config{model.Variant(v), mp}
	}
	return cfgs
}

// Run executes the main experiment. If progress is non-nil it receives one
// message per journey and a final message carrying the Result; it is closed
// at the end.
func Run(ctx context.Context, p Params, progress chan<- Progress) (*Result, error) {
	start := time.Now()
	if progress != nil {
		defer close(progress)
	}
	net := NewNetwork(p.Seed)
	setups := GenSetups(p.Journeys, p.Seed, p.Sigma, p.Shift)
	ev := &evaluator{net: net, cfgs: VariantConfigs(p.Model()), oracle: true, keepPaths: true, r0: p.R0, sh: p.Shelter}
	var notify func(int, *Journey)
	if progress != nil {
		notify = func(done int, j *Journey) {
			select {
			case progress <- Progress{Done: done, Total: len(setups), Journey: j}:
			case <-ctx.Done():
			}
		}
	}
	js, err := ev.run(ctx, setups, 0, notify)
	if err != nil {
		return nil, err
	}
	res := &Result{Params: p, Net: net, Journeys: js}
	res.Summary = Summarize(p, js)
	res.Elapsed = time.Since(start)
	if progress != nil {
		select {
		case progress <- Progress{Done: len(js), Total: len(js), Result: res}:
		case <-ctx.Done():
		}
	}
	return res, nil
}
