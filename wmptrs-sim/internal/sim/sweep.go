package sim

import (
	"context"

	"wmptrs-sim/internal/model"
)

// SweepBetas are the beta values of the trade-off sweep.
var SweepBetas = []float64{0, 0.25, 0.5, 1, 2, 4, 8}

// SweepPoint is one (family, beta) point of the trade-off curve.
type SweepPoint struct {
	Family     string  `json:"family"`
	Beta       float64 `json:"beta"` // for A2: alpha scale factor
	TimeIncPct float64 `json:"time_increase_pct"`
	DoseRedPct float64 `json:"dose_reduction_pct"`
	MotoShare  float64 `json:"moto_share"`
}

// SweepFamilies are the curves on the trade-off plot.
var SweepFamilies = []model.Variant{model.A3, model.A1, model.A2}

// Sweep re-routes the same journeys for every beta and family. onDone, if
// non-nil, is called after each journey.
func Sweep(ctx context.Context, p Params, onDone func(done, total int)) ([]SweepPoint, error) {
	net := NewNetwork(p.Seed)
	setups := GenSetups(p.Journeys, p.Seed, p.Sigma, p.Shift)
	cfgs := []Config{{model.A0, p.Model()}}
	for _, fam := range SweepFamilies {
		for _, b := range SweepBetas {
			mp := p.Model()
			if fam == model.A2 {
				mp.AlphaScale = b
			} else {
				mp.Beta = b
			}
			cfgs = append(cfgs, Config{fam, mp})
		}
	}
	ev := &evaluator{net: net, cfgs: cfgs, r0: p.R0, sh: p.Shelter}
	var cb func(int, *Journey)
	if onDone != nil {
		cb = func(d int, _ *Journey) { onDone(d, len(setups)) }
	}
	js, err := ev.run(ctx, setups, 0, cb)
	if err != nil {
		return nil, err
	}
	var t0, d0 float64
	for i := range js {
		t0 += js[i].Out[0].T
		d0 += js[i].Out[0].Dose
	}
	var pts []SweepPoint
	for c := 1; c < len(cfgs); c++ {
		var t, d float64
		var moto int
		for i := range js {
			t += js[i].Out[c].T
			d += js[i].Out[c].Dose
			if js[i].Out[c].Moto {
				moto++
			}
		}
		pt := SweepPoint{Family: cfgs[c].V.String(), Beta: SweepBetas[(c-1)%len(SweepBetas)]}
		if t0 > 0 {
			pt.TimeIncPct = round(100*(t/t0-1), 3)
		}
		if d0 > 0 {
			pt.DoseRedPct = round(100*(1-d/d0), 3)
		}
		pt.MotoShare = round(float64(moto)/float64(max(len(js), 1)), 4)
		pts = append(pts, pt)
	}
	return pts, nil
}
