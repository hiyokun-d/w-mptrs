package main

import (
	"context"
	"encoding/csv"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"

	"wmptrs-sim/internal/model"
	"wmptrs-sim/internal/sim"
)

func f(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

func writeCSV(dir, name string, header []string, rows [][]string) error {
	fh, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		return err
	}
	w := csv.NewWriter(fh)
	_ = w.Write(header)
	_ = w.WriteAll(rows)
	w.Flush()
	if err := w.Error(); err != nil {
		fh.Close()
		return err
	}
	fmt.Fprintln(os.Stderr, "wrote", filepath.Join(dir, name), len(rows), "rows")
	return fh.Close()
}

// exportAll runs every experiment and writes one CSV per figure/table.
func exportAll(dir string, p sim.Params, nSeeds int, motionErr float64) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	ctx := context.Background()
	res, err := sim.Run(ctx, p, nil)
	if err != nil {
		return err
	}
	vars := [][]string{}
	for _, v := range res.Summary.Variants {
		vars = append(vars, []string{v.Name, v.Description, f(v.MeanTime), f(v.TimeIncPct), f(v.MeanDose), f(v.DoseRedPct),
			f(v.DoseRedCI[0]), f(v.DoseRedCI[1]), f(v.MedianRedPct), f(v.MedianRedCI[0]), f(v.MedianRedCI[1]),
			f(v.MeanExposed), f(v.MotoShare), f(v.RerouteShare), f(v.Precision), f(v.Recall), f(v.F1)})
	}
	if err := writeCSV(dir, "variants.csv", []string{"variant", "description", "mean_time_min", "time_increase_pct", "mean_dose_mm",
		"dose_reduction_pct", "dose_red_ci_lo", "dose_red_ci_hi", "median_red_pct", "median_red_ci_lo", "median_red_ci_hi",
		"mean_exposed_min", "moto_share", "reroute_share", "precision", "recall", "f1"}, vars); err != nil {
		return err
	}
	tests := [][]string{{"friedman", "all", f(res.Summary.Friedman.Chi2), f(res.Summary.Friedman.P), ""}}
	for _, w := range res.Summary.Wilcoxon {
		tests = append(tests, []string{"wilcoxon", "A3 vs " + w.Vs, f(w.Z), f(w.P), f(w.PHolm)})
	}
	if err := writeCSV(dir, "tests.csv", []string{"test", "comparison", "statistic", "p", "p_holm"}, tests); err != nil {
		return err
	}
	var jr [][]string
	for _, j := range res.Journeys {
		for v, o := range j.Out {
			jr = append(jr, []string{strconv.Itoa(j.Index), model.Variant(v).String(), f(math.Hypot(float64(j.DX-j.OX), float64(j.DY-j.OY))),
				strconv.Itoa(len(j.Cells)), f(o.T), f(o.Dose), f(o.Exposed), strconv.FormatBool(o.Moto), strconv.FormatBool(o.Rerouted)})
		}
	}
	if err := writeCSV(dir, "journeys.csv", []string{"journey", "variant", "od_km", "cells", "time_min", "dose_mm", "exposed_min", "moto", "rerouted"}, jr); err != nil {
		return err
	}
	sw, err := sim.Sweep(ctx, p, nil)
	if err != nil {
		return err
	}
	var swr [][]string
	for _, s := range sw {
		swr = append(swr, []string{s.Family, f(s.Beta), f(s.TimeIncPct), f(s.DoseRedPct), f(s.MotoShare)})
	}
	if err := writeCSV(dir, "beta_sweep.csv", []string{"family", "beta_or_alpha_scale", "time_increase_pct", "dose_reduction_pct", "moto_share"}, swr); err != nil {
		return err
	}
	var phi [][]string
	mp := p.Model()
	for r := 0.0; r <= 30.0001; r += 0.25 {
		a1 := 1.0
		if r >= mp.R0 {
			a1 = 1 + mp.Beta
		}
		phi = append(phi, []string{f(r), f(model.Phi(r, mp)), f(a1), f(1 + 0.060*math.Max(0, r-mp.R0)), f(1 + mp.Beta*model.Phi(r, mp))})
	}
	if err := writeCSV(dir, "phi_curves.csv", []string{"rain_mmh", "phi", "a1_walk_mult", "a2_walk_mult", "a3_walk_mult"}, phi); err != nil {
		return err
	}
	st, err := sim.Seeds(ctx, p, nSeeds, nil)
	if err != nil {
		return err
	}
	var sr [][]string
	for _, row := range st.Rows {
		for v := range row.DoseRedPct {
			sr = append(sr, []string{strconv.FormatUint(row.Seed, 10), model.Variant(v).String(), f(row.DoseRedPct[v]), f(row.TimeIncPct[v])})
		}
	}
	if err := writeCSV(dir, "seeds.csv", []string{"seed", "variant", "dose_reduction_pct", "time_increase_pct"}, sr); err != nil {
		return err
	}
	var cr [][]string
	for _, c := range st.Contests {
		cr = append(cr, []string{c.Vs, strconv.Itoa(c.A3Wins), strconv.Itoa(c.Ties), strconv.Itoa(c.Seeds), f(c.MeanD), f(c.SignP)})
	}
	if err := writeCSV(dir, "seed_contests.csv", []string{"a3_vs", "a3_wins", "ties", "seeds", "mean_diff_pts", "sign_test_p"}, cr); err != nil {
		return err
	}
	sens, err := sim.Sensitivity(ctx, p, nil)
	if err != nil {
		return err
	}
	var sn [][]string
	for _, s := range sens {
		for v := range s.DoseRedPct {
			sn = append(sn, []string{s.Param, f(s.Value), strconv.FormatBool(s.IsDefault), model.Variant(v).String(), f(s.DoseRedPct[v]), f(s.TimeIncPct[v])})
		}
	}
	if err := writeCSV(dir, "sensitivity.csv", []string{"param", "value", "is_default", "variant", "dose_reduction_pct", "time_increase_pct"}, sn); err != nil {
		return err
	}
	ap := sim.AheadParams{Journeys: p.Journeys, Seed: p.Seed, MotionErr: motionErr, Horizon: 15}
	ah, err := sim.Ahead(ctx, ap, p.Model(), nil)
	if err != nil {
		return err
	}
	var ar [][]string
	for _, s := range ah.Strategies {
		ar = append(ar, []string{s.Name, f(s.MeanTime), f(s.TimeIncPct), f(s.MeanDose), f(s.DoseRedPct), f(s.DoseRedCI[0]), f(s.DoseRedCI[1]), f(s.MotoShare)})
	}
	if err := writeCSV(dir, "moving_strategies.csv", []string{"strategy", "mean_time_min", "time_increase_pct", "mean_dose_mm", "dose_reduction_pct", "ci_lo", "ci_hi", "moto_share"}, ar); err != nil {
		return err
	}
	var al [][]string
	for _, a := range ah.Alerts {
		al = append(al, []string{a.Strategy, f(a.POD), f(a.FAR), f(a.MeanLeadMin), f(a.PerTrip), strconv.Itoa(a.Hits), strconv.Itoa(a.Misses), strconv.Itoa(a.FalseAlarms)})
	}
	if err := writeCSV(dir, "moving_alerts.csv", []string{"strategy", "pod", "far", "mean_lead_min", "alerts_per_trip", "hits", "misses", "false_alarms"}, al); err != nil {
		return err
	}
	pts, err := sim.AheadSweep(ctx, ap, p.Model(), nil)
	if err != nil {
		return err
	}
	var pr [][]string
	for _, q := range pts {
		pr = append(pr, []string{f(q.MotionErr), f(q.NowRedPct), f(q.AheadRed), f(q.OracleRed), f(q.AheadPOD), f(q.AheadFAR), f(q.AheadTimeP)})
	}
	return writeCSV(dir, "moving_motion_error.csv", []string{"motion_error_kmpmin", "dp_now_red_pct", "dp_ahead_red_pct", "oracle_red_pct", "ahead_pod", "ahead_far", "ahead_time_inc_pct"}, pr)
}
