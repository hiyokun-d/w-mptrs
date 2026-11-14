package sim

import (
	"context"
	"reflect"
	"testing"

	"wmptrs-sim/internal/model"
)

func testParams() Params {
	p := Presets()[0].Params
	p.Journeys = 60
	return p
}

func TestRunDeterministic(t *testing.T) {
	a, err := Run(context.Background(), testParams(), nil)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := Run(context.Background(), testParams(), nil)
	if !reflect.DeepEqual(a.Summary, b.Summary) {
		t.Fatal("same seed produced different summaries")
	}
	p := testParams()
	p.Seed++
	c, _ := Run(context.Background(), p, nil)
	if reflect.DeepEqual(a.Summary.Variants, c.Summary.Variants) {
		t.Fatal("different seed produced identical results")
	}
}

func TestBetaZeroMatchesTimeOnly(t *testing.T) {
	p := testParams()
	p.Beta = 0
	res, err := Run(context.Background(), p, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, j := range res.Journeys {
		for _, v := range []model.Variant{model.A3, model.A4} {
			if j.Out[v].Rerouted || j.Out[v].Dose != j.Out[model.A0].Dose {
				t.Fatalf("journey %d: %v differs from A0 at beta=0", j.Index, v)
			}
		}
	}
}

func TestOutcomesSane(t *testing.T) {
	res, err := Run(context.Background(), testParams(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, j := range res.Journeys {
		for v, o := range j.Out {
			if o.T <= 0 || o.Dose < 0 || o.Exposed < 0 || o.Exposed > o.T+1e-9 {
				t.Fatalf("journey %d variant %d: bad outcome %+v", j.Index, v, o)
			}
			// A0 minimises generalised time cost, so nothing can be faster
			// by more than the walking/waiting weight allows
			if o.T < j.Out[model.A0].T/1.5-1e-9 {
				t.Fatalf("journey %d variant %d faster than A0 bound", j.Index, v)
			}
		}
	}
	s := res.Summary
	if s.Variants[model.A0].DoseRedPct != 0 || s.Variants[model.A0].TimeIncPct != 0 {
		t.Fatal("A0 must be the zero reference")
	}
	if len(s.Wilcoxon) != 4 {
		t.Fatalf("expected 4 comparisons, got %d", len(s.Wilcoxon))
	}
}

func TestNetworkShape(t *testing.T) {
	n := NewNetwork(1)
	if len(n.Lines) != 13 {
		t.Fatalf("expected 11 BRT + 2 rail lines, got %d", len(n.Lines))
	}
	rail := 0
	for _, l := range n.Lines {
		if l.Rail {
			rail++
		}
	}
	if rail != 2 {
		t.Fatalf("expected 2 rail lines, got %d", rail)
	}
	for u := 0; u < n.NumNodes; u++ {
		if n.Off[u] > n.Off[u+1] {
			t.Fatal("CSR offsets not monotone")
		}
	}
}

func TestSweepMonotoneAtExtremes(t *testing.T) {
	pts, err := Sweep(context.Background(), testParams(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range pts {
		if p.Beta == 0 && (p.DoseRedPct != 0 || p.TimeIncPct != 0) {
			t.Fatalf("%s at beta 0 should equal A0: %+v", p.Family, p)
		}
	}
}

func TestRouteSetupMatchesRun(t *testing.T) {
	p := testParams()
	res, err := Run(context.Background(), p, nil)
	if err != nil {
		t.Fatal(err)
	}
	j := RouteSetup(res.Net, res.Journeys[3].Setup, p)
	for v := range j.Out {
		if j.Out[v].Dose != res.Journeys[3].Out[v].Dose || j.Out[v].T != res.Journeys[3].Out[v].T {
			t.Fatalf("variant %d differs from Run", v)
		}
	}
	_, fc := EdgeRain(res.Net, j.Setup)
	s := j.Setup
	tr := TraceShortest(res.Net, model.A3, p.Model(), fc, WalkNode(s.OX, s.OY), WalkNode(s.DX, s.DY))
	if len(tr.Path) == 0 || len(tr.Settled) == 0 {
		t.Fatal("trace found no path")
	}
}

func TestRainAheadAlerts(t *testing.T) {
	net := NewNetwork(2026)
	mp := Presets()[0].Params.Model()
	s := Setup{OX: 3, OY: 3, DX: 27, DY: 13, Cells: []Cell{{X: 2, Y: 15, Peak: 25, Radius: 3}}}
	m := Motion{VX: 0.2, VY: -0.1}
	zero := make([]float64, net.NumEdges())
	a0 := Choose(net, s, model.A0, mp, zero, m)
	ahead := Choose(net, s, model.A3, mp, FieldAhead(net, s, m), m)
	if ahead.Dose >= a0.Dose/2 {
		t.Fatalf("motion-aware DP should avoid the incoming storm: %.2f vs %.2f", ahead.Dose, a0.Dose)
	}
	al := PlanAlerts(net, a0, 15)
	if len(al) == 0 || al[0].Covered || al[0].IssueAt > al[0].MeetAt || al[0].PrepAt > al[0].MeetAt {
		t.Fatalf("expected a raincoat alert ahead of the rain, got %+v", al)
	}
	// a dry trip gets no alert
	dry := Choose(net, Setup{OX: 3, OY: 3, DX: 27, DY: 13}, model.A0, mp, zero, m)
	if len(PlanAlerts(net, dry, 15)) != 0 {
		t.Fatal("dry trip produced an alert")
	}
}
