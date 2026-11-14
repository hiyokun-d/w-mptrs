package sim

import (
	"context"
	"math"
	"math/rand/v2"
	"slices"

	"wmptrs-sim/internal/model"
	"wmptrs-sim/internal/stats"
)

// Routing strategies compared on moving storms.
const (
	StratA0      = iota // time only
	StratNow            // DP on the rain at departure (static snapshot)
	StratAhead          // DP on the rain at each edge's arrival time, forecast motion
	StratAheadTD        // as Ahead, but the clock follows the search's own best path
	StratOracle         // as Ahead, with the true motion
	NumStrats
)

// StratNames are short labels for the strategies.
var StratNames = [NumStrats]string{"A0", "DP-now", "DP-ahead", "DP-ahead-TD", "oracle"}

// AheadParams configure the moving-storm experiment.
type AheadParams struct {
	Journeys  int     `json:"journeys"`
	Seed      uint64  `json:"seed"`
	MotionErr float64 `json:"motion_error_kmpmin"` // SD of the forecast velocity error per axis
	Horizon   float64 `json:"alert_horizon_min"`
}

// MovingSetup is a journey whose storms drift.
type MovingSetup struct {
	Setup
	True, Fc Motion
}

// GenMoving draws journeys like GenSetups, but every storm moves at
// 6–27 km/h in a random direction and is placed so that it crosses the
// OD corridor 10–60 min after departure. The forecast motion is the true
// motion plus N(0, motionErr) per axis.
func GenMoving(n int, seed uint64, motionErr float64) []MovingSetup {
	rng := rand.New(rand.NewPCG(seed, 0x6d6f7665))
	out := make([]MovingSetup, n)
	for i := range out {
		s := &out[i]
		for {
			s.OX, s.OY = rng.IntN(NX), rng.IntN(NY)
			s.DX, s.DY = rng.IntN(NX), rng.IntN(NY)
			if math.Hypot(float64(s.DX-s.OX), float64(s.DY-s.OY)) >= 8 {
				break
			}
		}
		speed := 0.1 + 0.35*rng.Float64() // km/min
		dir := 2 * math.Pi * rng.Float64()
		s.True = Motion{speed * math.Cos(dir), speed * math.Sin(dir)}
		s.Fc = Motion{s.True.VX + motionErr*rng.NormFloat64(), s.True.VY + motionErr*rng.NormFloat64()}
		nc := 1 + rng.IntN(2)
		for c := 0; c < nc; c++ {
			f := 0.15 + 0.7*rng.Float64()
			meet := 10 + 50*rng.Float64()
			cx := float64(s.OX) + f*float64(s.DX-s.OX) - s.True.VX*meet + 1.5*rng.NormFloat64()
			cy := float64(s.OY) + f*float64(s.DY-s.OY) - s.True.VY*meet + 1.5*rng.NormFloat64()
			s.Cells = append(s.Cells, Cell{X: cx, Y: cy, Peak: 10 + 30*rng.Float64(), Radius: 1.5 + 2.5*rng.Float64()})
		}
		for k := range s.Noise {
			s.Noise[k] = 1
		}
	}
	return out
}

// ChooseTD routes with a time-dependent Dijkstra: each label carries the
// clock time of its own best (generalised-cost) path, and an edge is priced
// with the rain forecast for that clock. This is the exact-clock reference
// for the arrival-time approximation used by DP-ahead.
func ChooseTD(net *Network, s Setup, mp model.Params, fc, truth Motion) Choice {
	best := func(src, dst int) ([]int32, float64) {
		rt := newRouter(net)
		clock := make([]float64, net.NumNodes)
		for i := range rt.dist {
			rt.dist[i] = math.Inf(1)
			rt.prevE[i] = -1
		}
		rt.dist[src] = 0
		rt.push(heapItem{0, int32(src)})
		for len(rt.heap) > 0 {
			it := rt.pop()
			u := int(it.u)
			if it.d > rt.dist[u] {
				continue
			}
			if u == dst {
				break
			}
			for e := net.Off[u]; e < net.Off[u+1]; e++ {
				tau := net.Tau[e]
				r := RainMoving(s.Cells, net.MidX[e], net.MidY[e], clock[u]+tau/2, fc)
				w := net.To[e]
				if nd := it.d + model.A3.Cost(tau, net.Kind[e], r, mp); nd < rt.dist[w] {
					rt.dist[w], rt.prevE[w], clock[w] = nd, e, clock[u]+tau
					rt.push(heapItem{nd, w})
				}
			}
		}
		if math.IsInf(rt.dist[dst], 1) {
			return nil, math.Inf(1)
		}
		var path []int32
		for v := dst; v != src; v = int(net.From[rt.prevE[v]]) {
			path = append(path, rt.prevE[v])
		}
		slices.Reverse(path)
		return path, rt.dist[dst]
	}
	pm, cm := best(MotoNode(s.OX, s.OY), MotoNode(s.DX, s.DY))
	pt, ct := best(WalkNode(s.OX, s.OY), WalkNode(s.DX, s.DY))
	if cm <= ct {
		return Replay(net, s, pm, true, mp, truth)
	}
	return Replay(net, s, pt, false, mp, truth)
}

// AlertScore compares the alerts an app would issue (forecast motion) with
// the rain the traveller really meets (true motion) on one route.
type AlertScore struct {
	Hits, Misses, FalseAlarms int
	LeadSum                   float64 // minutes between issue and the true rain, over hits
	Issued                    int
}

func overlap(a0, a1, b0, b1 float64) bool { return a0 < b1 && b0 < a1 }

func scoreAlerts(net *Network, s Setup, c Choice, mp model.Params, fc Motion, horizon float64) AlertScore {
	pred := PlanAlerts(net, Replay(net, s, c.Path, c.Moto, mp, fc), horizon)
	real := PlanAlerts(net, c, horizon)
	var sc AlertScore
	used := make([]bool, len(real))
	for _, p := range pred {
		if p.Covered {
			continue
		}
		sc.Issued++
		hit := false
		for k, r := range real {
			if !r.Covered && overlap(p.MeetAt, p.Until, r.MeetAt, r.Until) {
				if !used[k] {
					used[k] = true
					sc.LeadSum += r.MeetAt - p.IssueAt
				}
				hit = true
			}
		}
		if hit {
			sc.Hits++
		} else {
			sc.FalseAlarms++
		}
	}
	for k, r := range real {
		if !r.Covered && !used[k] {
			sc.Misses++
		}
	}
	return sc
}

// StratSummary aggregates one strategy over the moving-storm journeys.
type StratSummary struct {
	Name       string     `json:"name"`
	MeanTime   float64    `json:"mean_time_min"`
	TimeIncPct float64    `json:"time_increase_pct"`
	MeanDose   float64    `json:"mean_dose_mm"`
	DoseRedPct float64    `json:"dose_reduction_pct"`
	DoseRedCI  [2]float64 `json:"dose_reduction_ci95"`
	MotoShare  float64    `json:"moto_share"`
}

// AlertSummary is the quality of raincoat alerts on one strategy's routes.
type AlertSummary struct {
	Strategy    string  `json:"strategy"`
	POD         float64 `json:"probability_of_detection"`
	FAR         float64 `json:"false_alarm_ratio"`
	MeanLeadMin float64 `json:"mean_lead_min"`
	PerTrip     float64 `json:"alerts_per_trip"`
	Hits        int     `json:"hits"`
	Misses      int     `json:"misses"`
	FalseAlarms int     `json:"false_alarms"`
}

// AheadResult is the full moving-storm experiment at one motion error.
type AheadResult struct {
	Params     AheadParams    `json:"params"`
	Strategies []StratSummary `json:"strategies"`
	// Holm-adjusted Wilcoxon on per-journey dose: DP-ahead vs A0, DP-now, oracle.
	Tests       []Comparison   `json:"wilcoxon_ahead_vs"`
	TDAgreement float64        `json:"td_same_route_share"`
	TDDoseDiff  float64        `json:"td_minus_ahead_dose_mm"`
	Alerts      []AlertSummary `json:"alerts"`
}

// AheadErrPoint is one point of the motion-error sweep.
type AheadErrPoint struct {
	MotionErr  float64 `json:"motion_error_kmpmin"`
	NowRedPct  float64 `json:"dp_now_dose_reduction_pct"`
	AheadRed   float64 `json:"dp_ahead_dose_reduction_pct"`
	OracleRed  float64 `json:"oracle_dose_reduction_pct"`
	AheadPOD   float64 `json:"dp_ahead_alert_pod"`
	AheadFAR   float64 `json:"dp_ahead_alert_far"`
	AheadTimeP float64 `json:"dp_ahead_time_increase_pct"`
}

// AheadErrors is the motion-error sweep.
var AheadErrors = []float64{0, 0.05, 0.1, 0.2, 0.3}

type aheadJourney struct {
	out    [NumStrats]Choice
	alerts [NumStrats]AlertScore
}

func runAhead(ctx context.Context, ap AheadParams, mp model.Params, onDone func(int, int)) ([]aheadJourney, error) {
	net := NewNetwork(ap.Seed)
	setups := GenMoving(ap.Journeys, ap.Seed, ap.MotionErr)
	js := make([]aheadJourney, len(setups))
	zero := make([]float64, net.NumEdges())
	err := parallel(ctx, len(setups), onDone, func(i int) {
		ms := setups[i]
		j := &js[i]
		j.out[StratA0] = Choose(net, ms.Setup, model.A0, mp, zero, ms.True)
		j.out[StratNow] = Choose(net, ms.Setup, model.A3, mp, FieldNow(net, ms.Setup), ms.True)
		j.out[StratAhead] = Choose(net, ms.Setup, model.A3, mp, FieldAhead(net, ms.Setup, ms.Fc), ms.True)
		j.out[StratAheadTD] = ChooseTD(net, ms.Setup, mp, ms.Fc, ms.True)
		j.out[StratOracle] = Choose(net, ms.Setup, model.A3, mp, FieldAhead(net, ms.Setup, ms.True), ms.True)
		for k := range j.out {
			j.alerts[k] = scoreAlerts(net, ms.Setup, j.out[k], mp, ms.Fc, ap.Horizon)
		}
	})
	return js, err
}

func summarizeAlerts(name string, js []aheadJourney, k int) AlertSummary {
	var a AlertScore
	for i := range js {
		s := js[i].alerts[k]
		a.Hits += s.Hits
		a.Misses += s.Misses
		a.FalseAlarms += s.FalseAlarms
		a.LeadSum += s.LeadSum
		a.Issued += s.Issued
	}
	out := AlertSummary{Strategy: name, Hits: a.Hits, Misses: a.Misses, FalseAlarms: a.FalseAlarms}
	if a.Hits+a.Misses > 0 {
		out.POD = round(float64(a.Hits)/float64(a.Hits+a.Misses), 4)
	}
	if a.Hits+a.FalseAlarms > 0 {
		out.FAR = round(float64(a.FalseAlarms)/float64(a.Hits+a.FalseAlarms), 4)
	}
	if a.Hits > 0 {
		out.MeanLeadMin = round(a.LeadSum/float64(a.Hits), 2)
	}
	out.PerTrip = round(float64(a.Issued)/float64(max(len(js), 1)), 3)
	return out
}

// Ahead runs the moving-storm experiment.
func Ahead(ctx context.Context, ap AheadParams, mp model.Params, onDone func(int, int)) (*AheadResult, error) {
	js, err := runAhead(ctx, ap, mp, onDone)
	if err != nil {
		return nil, err
	}
	n := len(js)
	res := &AheadResult{Params: ap}
	sum := func(k int, idx []int, f func(Choice) float64) float64 {
		var t float64
		for _, i := range idx {
			t += f(js[i].out[k])
		}
		return t
	}
	all := make([]int, n)
	for i := range all {
		all[i] = i
	}
	dose := func(c Choice) float64 { return c.Dose }
	tim := func(c Choice) float64 { return c.T }
	red := func(k int, idx []int) float64 {
		d0 := sum(StratA0, idx, dose)
		if d0 == 0 {
			return 0
		}
		return 100 * (1 - sum(k, idx, dose)/d0)
	}
	t0 := sum(StratA0, all, tim)
	for k := 0; k < NumStrats; k++ {
		ss := StratSummary{Name: StratNames[k]}
		ss.MeanTime = round(sum(k, all, tim)/float64(max(n, 1)), 3)
		ss.MeanDose = round(sum(k, all, dose)/float64(max(n, 1)), 4)
		if t0 > 0 {
			ss.TimeIncPct = round(100*(sum(k, all, tim)/t0-1), 3)
		}
		ss.DoseRedPct = round(red(k, all), 3)
		if k > 0 {
			lo, hi := stats.BootstrapCI(n, 2000, 0.95, ap.Seed*17+uint64(k), func(idx []int) float64 { return red(k, idx) })
			ss.DoseRedCI = [2]float64{round(lo, 3), round(hi, 3)}
		}
		moto := 0
		for i := range js {
			if js[i].out[k].Moto {
				moto++
			}
		}
		ss.MotoShare = round(float64(moto)/float64(max(n, 1)), 4)
		res.Strategies = append(res.Strategies, ss)
	}
	col := func(k int) []float64 {
		d := make([]float64, n)
		for i := range js {
			d[i] = js[i].out[k].Dose
		}
		return d
	}
	var ps []float64
	for _, k := range []int{StratA0, StratNow, StratOracle} {
		w := stats.Wilcoxon(col(StratAhead), col(k))
		res.Tests = append(res.Tests, Comparison{Vs: StratNames[k], WilcoxonResult: w})
		ps = append(ps, w.P)
	}
	for i, p := range stats.Holm(ps) {
		res.Tests[i].PHolm = p
	}
	same := 0
	var dd float64
	for i := range js {
		if slices.Equal(js[i].out[StratAhead].Path, js[i].out[StratAheadTD].Path) {
			same++
		}
		dd += js[i].out[StratAheadTD].Dose - js[i].out[StratAhead].Dose
	}
	res.TDAgreement = round(float64(same)/float64(max(n, 1)), 4)
	res.TDDoseDiff = round(dd/float64(max(n, 1)), 4)
	for _, k := range []int{StratA0, StratAhead} {
		res.Alerts = append(res.Alerts, summarizeAlerts(StratNames[k], js, k))
	}
	return res, nil
}

// AheadSweep repeats the experiment (without bootstrap) for every motion
// error in AheadErrors.
func AheadSweep(ctx context.Context, ap AheadParams, mp model.Params, onDone func(int, int)) ([]AheadErrPoint, error) {
	var pts []AheadErrPoint
	total := len(AheadErrors) * ap.Journeys
	for ei, me := range AheadErrors {
		q := ap
		q.MotionErr = me
		base := ei * ap.Journeys
		var cb func(int, int)
		if onDone != nil {
			cb = func(d, _ int) { onDone(base+d, total) }
		}
		js, err := runAhead(ctx, q, mp, cb)
		if err != nil {
			return nil, err
		}
		var d, t [NumStrats]float64
		for i := range js {
			for k := range d {
				d[k] += js[i].out[k].Dose
				t[k] += js[i].out[k].T
			}
		}
		pct := func(k int) float64 {
			if d[0] == 0 {
				return 0
			}
			return round(100*(1-d[k]/d[0]), 3)
		}
		al := summarizeAlerts("", js, StratAhead)
		pts = append(pts, AheadErrPoint{MotionErr: me, NowRedPct: pct(StratNow), AheadRed: pct(StratAhead), OracleRed: pct(StratOracle),
			AheadPOD: al.POD, AheadFAR: al.FAR, AheadTimeP: round(100*(t[StratAhead]/math.Max(t[0], 1e-9)-1), 3)})
	}
	return pts, nil
}
