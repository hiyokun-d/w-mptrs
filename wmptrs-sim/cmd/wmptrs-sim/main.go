// Command wmptrs-sim is an interactive terminal simulator for the Discomfort
// Penalty routing model. With --no-tui it prints a JSON summary instead.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"wmptrs-sim/internal/sim"
	"wmptrs-sim/internal/ui"
)

const honesty = "Interactive model demo — results vary by seed; not the original paper run."

func main() {
	p := sim.Presets()[0].Params
	preset := flag.String("preset", "", `start from a preset: "default", "perfect", "high", "averse"`)
	noTUI := flag.Bool("no-tui", false, "run headless and print a JSON summary")
	sweep := flag.Bool("sweep", false, "with --no-tui: include the beta trade-off sweep")
	bench := flag.Bool("bench", false, "with --no-tui: include routing-call timings (not deterministic)")
	beta := flag.Float64("beta", p.Beta, "DP weight beta")
	r0 := flag.Float64("r0", p.R0, "sigmoid midpoint r0 (mm/h)")
	k := flag.Float64("k", p.K, "sigmoid steepness k")
	sigma := flag.Float64("sigma", p.Sigma, "forecast lognormal sigma")
	shift := flag.Float64("shift", p.Shift, "forecast location shift SD (km)")
	journeys := flag.Int("journeys", p.Journeys, "number of journeys (50-1000)")
	seed := flag.Uint64("seed", p.Seed, "random seed")
	flag.Parse()

	if *preset != "" {
		found := false
		for _, pr := range sim.Presets() {
			if strings.Contains(strings.ToLower(pr.Name), strings.ToLower(*preset)) {
				p, found = pr.Params, true
				break
			}
		}
		if !found {
			fmt.Fprintf(os.Stderr, "unknown preset %q\n", *preset)
			os.Exit(2)
		}
	}
	// explicit flags override the preset
	flag.Visit(func(f *flag.Flag) {
		switch f.Name {
		case "beta":
			p.Beta = *beta
		case "r0":
			p.R0 = *r0
		case "k":
			p.K = *k
		case "sigma":
			p.Sigma = *sigma
		case "shift":
			p.Shift = *shift
		case "journeys":
			p.Journeys = *journeys
		case "seed":
			p.Seed = *seed
		}
	})
	p.Journeys = min(max(p.Journeys, 50), 1000)

	if !*noTUI {
		if err := ui.Run(p); err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}
		return
	}

	ctx := context.Background()
	start := time.Now()
	res, err := sim.Run(ctx, p, nil)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	out := struct {
		Note    string           `json:"note"`
		Summary sim.Summary      `json:"summary"`
		Sweep   []sim.SweepPoint `json:"sweep,omitempty"`
		Bench   *sim.BenchResult `json:"bench,omitempty"`
	}{Note: honesty, Summary: res.Summary}
	if *sweep {
		if out.Sweep, err = sim.Sweep(ctx, p, nil); err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}
	}
	if *bench {
		if out.Bench, err = sim.Bench(ctx, p, min(p.Journeys, 200), 3); err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(out)
	fmt.Fprintf(os.Stderr, "done in %v (%d journeys x 5 variants)\n", time.Since(start).Round(time.Millisecond), p.Journeys)
}
