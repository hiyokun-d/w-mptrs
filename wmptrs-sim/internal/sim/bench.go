package sim

import (
	"context"

	"wmptrs-sim/internal/model"
	"wmptrs-sim/internal/stats"
)

// BenchVariant holds routing-call timings for one variant.
type BenchVariant struct {
	Name     string    `json:"name"`
	MedianUs float64   `json:"median_us"`
	P95Us    float64   `json:"p95_us"`
	Samples  []float64 `json:"-"` // microseconds, in call order
}

// BenchResult is the output of Bench.
type BenchResult struct {
	Calls    int            `json:"calls_per_variant"`
	Nodes    int            `json:"nodes"`
	Edges    int            `json:"edges"`
	Variants []BenchVariant `json:"variants"`
}

// Bench times routing calls (edge pricing + both shortest-path searches) on a
// single goroutine to avoid contention noise.
func Bench(ctx context.Context, p Params, journeys, reps int) (*BenchResult, error) {
	net := NewNetwork(p.Seed)
	setups := GenSetups(journeys, p.Seed, p.Sigma, p.Shift)
	ev := &evaluator{net: net, cfgs: VariantConfigs(p.Model()), r0: p.R0, sh: p.Shelter}
	res := &BenchResult{Nodes: net.NumNodes, Edges: net.NumEdges()}
	samples := make([][]float64, model.NumVariants)
	for r := 0; r < reps; r++ {
		js, err := ev.run(ctx, setups, 1, nil)
		if err != nil {
			return nil, err
		}
		for i := range js {
			for v := range samples {
				samples[v] = append(samples[v], float64(js[i].Out[v].RouteNS)/1e3)
			}
		}
	}
	for v, s := range samples {
		res.Variants = append(res.Variants, BenchVariant{
			Name:     model.Variant(v).String(),
			MedianUs: round(stats.Median(s), 2),
			P95Us:    round(stats.Quantile(s, 0.95), 2),
			Samples:  s,
		})
	}
	res.Calls = len(samples[0])
	return res, nil
}
