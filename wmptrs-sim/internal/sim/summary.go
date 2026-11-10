package sim

import (
	"math"

	"wmptrs-sim/internal/model"
	"wmptrs-sim/internal/stats"
)

// VariantSummary aggregates one variant over all journeys.
type VariantSummary struct {
	Name          string     `json:"name"`
	Description   string     `json:"description"`
	MeanTime      float64    `json:"mean_time_min"`
	TimeIncPct    float64    `json:"time_increase_pct"`
	MeanDose      float64    `json:"mean_dose_mm"`
	DoseRedPct    float64    `json:"dose_reduction_pct"`
	DoseRedCI     [2]float64 `json:"dose_reduction_ci95"`
	MedianRedPct  float64    `json:"median_journey_reduction_pct"`
	MedianRedCI   [2]float64 `json:"median_journey_reduction_ci95"`
	MeanExposed   float64    `json:"mean_exposed_min"`
	MotoShare     float64    `json:"moto_share"`
	RerouteShare  float64    `json:"reroute_share"`
	Precision     float64    `json:"precision"`
	Recall        float64    `json:"recall"`
	F1            float64    `json:"f1"`
	PredPositives int        `json:"predicted_positives"`
}

// Comparison is A3 against one other variant on per-journey dose.
type Comparison struct {
	Vs string `json:"vs"`
	stats.WilcoxonResult
	PHolm float64 `json:"p_holm"`
}

// Summary is the full headline output of a run.
type Summary struct {
	Params          Params               `json:"params"`
	Journeys        int                  `json:"journeys"`
	ExposedJourneys int                  `json:"exposed_journeys"`
	OraclePositives int                  `json:"oracle_positives"`
	Variants        []VariantSummary     `json:"variants"`
	Friedman        stats.FriedmanResult `json:"friedman_dose"`
	Wilcoxon        []Comparison         `json:"wilcoxon_a3_vs"`
}

// exposedThreshold is the A0 dose (mm) above which a journey counts as
// rain-exposed for the per-journey median.
const exposedThreshold = 0.01

func round(x float64, d int) float64 {
	p := math.Pow(10, float64(d))
	return math.Round(x*p) / p
}

// Summarize computes all statistics for the five-variant journeys.
func Summarize(p Params, js []Journey) Summary {
	n := len(js)
	s := Summary{Params: p, Journeys: n}
	nv := int(model.NumVariants)
	dose := make([][]float64, nv)
	for v := range dose {
		dose[v] = make([]float64, n)
		for i := range js {
			dose[v][i] = js[i].Out[v].Dose
		}
	}
	var exposed []int
	positive := make([]bool, n)
	for i := range js {
		if js[i].Out[0].Dose > exposedThreshold {
			exposed = append(exposed, i)
		}
		o := js[i].Oracle
		positive[i] = o.Rerouted && o.Dose < js[i].Out[0].Dose-1e-9
		if positive[i] {
			s.OraclePositives++
		}
	}
	s.ExposedJourneys = len(exposed)

	sumOver := func(v int, idx []int, f func(Outcome) float64) float64 {
		var t float64
		for _, i := range idx {
			t += f(js[i].Out[v])
		}
		return t
	}
	all := make([]int, n)
	for i := range all {
		all[i] = i
	}
	doseOf := func(o Outcome) float64 { return o.Dose }
	redPct := func(v int, idx []int) float64 {
		d0 := sumOver(0, idx, doseOf)
		if d0 == 0 {
			return 0
		}
		return 100 * (1 - sumOver(v, idx, doseOf)/d0)
	}
	medRed := func(v int, idx []int) float64 {
		r := make([]float64, len(idx))
		for k, i := range idx {
			r[k] = 100 * (1 - js[i].Out[v].Dose/js[i].Out[0].Dose)
		}
		return stats.Median(r)
	}
	t0 := sumOver(0, all, func(o Outcome) float64 { return o.T })
	for v := 0; v < nv; v++ {
		vs := VariantSummary{Name: model.Variant(v).String(), Description: model.Variant(v).Describe()}
		tv := sumOver(v, all, func(o Outcome) float64 { return o.T })
		var moto, rer, tp, fp, fn int
		var exp float64
		for i := range js {
			o := js[i].Out[v]
			exp += o.Exposed
			if o.Moto {
				moto++
			}
			if o.Rerouted {
				rer++
			}
			switch {
			case o.Rerouted && positive[i]:
				tp++
			case o.Rerouted:
				fp++
			case positive[i]:
				fn++
			}
		}
		fnum := float64(max(n, 1))
		vs.MeanTime = round(tv/fnum, 3)
		if t0 > 0 {
			vs.TimeIncPct = round(100*(tv/t0-1), 3)
		}
		vs.MeanDose = round(sumOver(v, all, doseOf)/fnum, 4)
		vs.DoseRedPct = round(redPct(v, all), 3)
		seed := p.Seed*31 + uint64(v)
		if v > 0 {
			lo, hi := stats.BootstrapCI(n, 2000, 0.95, seed, func(idx []int) float64 { return redPct(v, idx) })
			vs.DoseRedCI = [2]float64{round(lo, 3), round(hi, 3)}
			if len(exposed) > 0 {
				vs.MedianRedPct = round(medRed(v, exposed), 3)
				lo, hi = stats.BootstrapCI(len(exposed), 2000, 0.95, seed+7, func(idx []int) float64 {
					sub := make([]int, len(idx))
					for k, i := range idx {
						sub[k] = exposed[i]
					}
					return medRed(v, sub)
				})
				vs.MedianRedCI = [2]float64{round(lo, 3), round(hi, 3)}
			}
		}
		vs.MeanExposed = round(exp/fnum, 3)
		vs.MotoShare = round(float64(moto)/fnum, 4)
		vs.RerouteShare = round(float64(rer)/fnum, 4)
		pr, rc, f1 := stats.PRF(tp, fp, fn)
		vs.Precision, vs.Recall, vs.F1 = round(pr, 4), round(rc, 4), round(f1, 4)
		vs.PredPositives = tp + fp
		s.Variants = append(s.Variants, vs)
	}

	rows := make([][]float64, n)
	for i := range rows {
		rows[i] = make([]float64, nv)
		for v := 0; v < nv; v++ {
			rows[i][v] = dose[v][i]
		}
	}
	s.Friedman = stats.Friedman(rows)
	var ps []float64
	for _, v := range []model.Variant{model.A0, model.A1, model.A2, model.A4} {
		w := stats.Wilcoxon(dose[model.A3], dose[v])
		s.Wilcoxon = append(s.Wilcoxon, Comparison{Vs: v.String(), WilcoxonResult: w})
		ps = append(ps, w.P)
	}
	for i, ph := range stats.Holm(ps) {
		s.Wilcoxon[i].PHolm = ph
	}
	return s
}
