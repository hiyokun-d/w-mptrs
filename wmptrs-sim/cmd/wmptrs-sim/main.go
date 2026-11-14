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
	seeds := flag.Int("seeds", 0, "with --no-tui: repeat over N consecutive seeds (robustness)")
	sens := flag.Bool("sensitivity", false, "with --no-tui: one-at-a-time sensitivity of E and w_m")
	ahead := flag.Bool("ahead", false, "with --no-tui: moving-storm experiment (DP-now vs DP-ahead, raincoat alerts)")
	motionErr := flag.Float64("motion-err", 0.1, "moving-storm forecast velocity error SD (km/min)")
	lang := flag.String("lang", "en", `TUI language for Menu, Guide and alerts: "en" or "id" (Bahasa Indonesia)`)
	export := flag.String("export", "", "write CSV files for paper figures into this directory (implies --no-tui and all experiments)")
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

	if *export != "" {
		if err := exportAll(*export, p, max(*seeds, 20), *motionErr); err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}
		return
	}
	if !*noTUI {
		ui.SetIndonesian(*lang == "id")
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
		Note    string              `json:"note"`
		Summary sim.Summary         `json:"summary"`
		Sweep   []sim.SweepPoint    `json:"sweep,omitempty"`
		Bench   *sim.BenchResult    `json:"bench,omitempty"`
		Seeds   *sim.SeedStudy      `json:"seeds,omitempty"`
		Sens    []sim.SensRow       `json:"sensitivity,omitempty"`
		Ahead   *sim.AheadResult    `json:"moving_storms,omitempty"`
		AheadE  []sim.AheadErrPoint `json:"moving_storms_motion_error_sweep,omitempty"`
	}{Note: honesty, Summary: res.Summary}
	fail := func(err error) {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	if *seeds > 0 {
		if out.Seeds, err = sim.Seeds(ctx, p, *seeds, nil); err != nil {
			fail(err)
		}
	}
	if *sens {
		if out.Sens, err = sim.Sensitivity(ctx, p, nil); err != nil {
			fail(err)
		}
	}
	if *ahead {
		ap := sim.AheadParams{Journeys: p.Journeys, Seed: p.Seed, MotionErr: *motionErr, Horizon: 15}
		if out.Ahead, err = sim.Ahead(ctx, ap, p.Model(), nil); err != nil {
			fail(err)
		}
		if out.AheadE, err = sim.AheadSweep(ctx, ap, p.Model(), nil); err != nil {
			fail(err)
		}
	}
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
