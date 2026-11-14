package sim

import (
	"fmt"
	"math"

	"wmptrs-sim/internal/model"
)

// Motion is the drift of a storm field in km per minute, as a nowcast with
// motion vectors would predict it.
type Motion struct{ VX, VY float64 }

// RainMoving is the rain at (x, y) at trip minute t when every cell drifts
// with m.
func RainMoving(cells []Cell, x, y, t float64, m Motion) float64 {
	return RainAt(cells, x, y, m.VX*t, m.VY*t)
}

// all runs a full Dijkstra on r.cost from src and returns the distances.
func (r *router) all(src int) []float64 {
	n := r.net
	for i := range r.dist {
		r.dist[i] = math.Inf(1)
	}
	r.heap = r.heap[:0]
	r.dist[src] = 0
	r.push(heapItem{0, int32(src)})
	for len(r.heap) > 0 {
		it := r.pop()
		u := int(it.u)
		if it.d > r.dist[u] {
			continue
		}
		for e := n.Off[u]; e < n.Off[u+1]; e++ {
			if nd := it.d + r.cost[e]; nd < r.dist[n.To[e]] {
				r.dist[n.To[e]] = nd
				r.push(heapItem{nd, n.To[e]})
			}
		}
	}
	return append([]float64(nil), r.dist...)
}

// ArrivalTimes are the earliest clock arrival times (minutes) at every node
// from the journey origin, over both the motorcycle and walk/transit layers.
func ArrivalTimes(net *Network, s Setup) []float64 {
	rt := newRouter(net)
	copy(rt.cost, net.Tau)
	a := rt.all(WalkNode(s.OX, s.OY))
	b := rt.all(MotoNode(s.OX, s.OY))
	for i := range a {
		a[i] = math.Min(a[i], b[i])
	}
	return a
}

// FieldNow is the rain on every edge at departure: what a router that
// ignores storm motion would use.
func FieldNow(net *Network, s Setup) []float64 {
	f := make([]float64, net.NumEdges())
	for e := range f {
		f[e] = RainAt(s.Cells, net.MidX[e], net.MidY[e], 0, 0)
	}
	return f
}

// FieldAhead is the rain on every edge at the time the traveller would reach
// it. Arrival times come from a time-only search, a standard approximation
// that keeps the search a plain (static) Dijkstra.
func FieldAhead(net *Network, s Setup, m Motion) []float64 {
	arr := ArrivalTimes(net, s)
	f := make([]float64, net.NumEdges())
	for e := range f {
		t := arr[net.From[e]]
		if math.IsInf(t, 1) {
			t = 0
		}
		f[e] = RainMoving(s.Cells, net.MidX[e], net.MidY[e], t+net.Tau[e]/2, m)
	}
	return f
}

// Sample is one edge of a travelled route with the rain met on it.
type Sample struct {
	Edge   int32
	T0, T1 float64 // trip minutes
	Kind   model.Kind
	Rain   float64 // true rain at the edge midpoint at mid-time, mm/h
}

// Choice is a routed journey replayed against moving rain.
type Choice struct {
	Path     []int32
	Moto     bool
	T, Dose  float64
	Exposed  float64 // minutes exposed with rain >= r0
	Timeline []Sample
}

// Choose routes the journey under v on field (moto vs walk+transit, the
// cheaper wins), then replays the path in clock time against the moving
// storm to score it.
func Choose(net *Network, s Setup, v model.Variant, mp model.Params, field []float64, m Motion) Choice {
	tm := TraceShortest(net, v, mp, field, MotoNode(s.OX, s.OY), MotoNode(s.DX, s.DY))
	tt := TraceShortest(net, v, mp, field, WalkNode(s.OX, s.OY), WalkNode(s.DX, s.DY))
	path, moto := tt.Path, false
	if tm.Cost <= tt.Cost {
		path, moto = tm.Path, true
	}
	return Replay(net, s, path, moto, mp, m)
}

// Replay walks a fixed path in clock time against the storm drifting with m,
// recording the rain met on every edge and the resulting dose.
func Replay(net *Network, s Setup, path []int32, moto bool, mp model.Params, m Motion) Choice {
	c := Choice{Path: path, Moto: moto}
	t := 0.0
	for _, e := range c.Path {
		tau, k := net.Tau[e], net.Kind[e]
		r := RainMoving(s.Cells, net.MidX[e], net.MidY[e], t+tau/2, m)
		c.Timeline = append(c.Timeline, Sample{Edge: e, T0: t, T1: t + tau, Kind: k, Rain: r})
		c.Dose += tau * mp.Shelter.E(k) * r / 60
		if mp.Shelter.E(k) > 0 && r >= mp.R0 {
			c.Exposed += tau
		}
		t += tau
	}
	c.T = t
	return c
}

// Alert is a "rain is coming to you" notification for one rain spell met on
// the route.
type Alert struct {
	IssueAt  float64 // trip minute the notification fires
	MeetAt   float64 // trip minute the traveller meets the rain
	PrepAt   float64 // trip minute to stop and put on a raincoat
	PrepX    float64 // where, km
	PrepY    float64
	Until    float64 // trip minute the spell ends
	Peak     float64 // mm/h
	Kind     model.Kind
	Covered  bool // met only while sheltered (E = 0): informational
	Headline string
	Advice   string
}

// AlertThreshold is the rain (mm/h) worth a notification: the top of the
// BMKG "very light" band.
const AlertThreshold = 1.0

// PlanAlerts scans a replayed route for rain spells and turns each into a
// notification issued up to horizon minutes ahead (the nowcast lead time).
func PlanAlerts(net *Network, c Choice, horizon float64) []Alert {
	var out []Alert
	tl := c.Timeline
	for i := 0; i < len(tl); i++ {
		if tl[i].Rain < AlertThreshold || tl[i].T1-tl[i].T0 <= 0 {
			continue
		}
		// a spell: consecutive edges with rain
		j := i
		a := Alert{MeetAt: tl[i].T0, Kind: tl[i].Kind, Covered: true}
		for ; j < len(tl) && (tl[j].Rain >= AlertThreshold || tl[j].T1-tl[j].T0 == 0); j++ {
			if tl[j].Kind.Exposure() > 0 && tl[j].T1 > tl[j].T0 {
				if a.Covered {
					a.Kind, a.MeetAt = tl[j].Kind, tl[j].T0
				}
				a.Covered = false
				a.Peak = math.Max(a.Peak, tl[j].Rain)
			}
			a.Until = tl[j].T1
		}
		if a.Covered {
			for k := i; k < j; k++ {
				a.Peak = math.Max(a.Peak, tl[k].Rain)
			}
		}
		i = j - 1
		a.IssueAt = math.Max(0, a.MeetAt-horizon)
		// where to prepare: the last sheltered or stoppable point before the rain
		a.PrepAt = math.Max(0, a.MeetAt-1)
		prepEdge := -1
		for k := 0; k < len(tl) && tl[k].T0 <= a.MeetAt; k++ {
			if tl[k].Kind == model.Alight || tl[k].Kind.Exposure() == 0 || tl[k].Kind == model.WaitRail {
				prepEdge = k
			}
		}
		if prepEdge >= 0 && a.Kind == model.Walk && a.MeetAt-tl[prepEdge].T1 < 3 {
			a.PrepAt = tl[prepEdge].T1
			e := tl[prepEdge].Edge
			a.PrepX, a.PrepY = net.NodeX[net.To[e]], net.NodeY[net.To[e]]
		} else {
			x, y := positionAt(net, tl, a.PrepAt)
			a.PrepX, a.PrepY = x, y
		}
		a.Headline, a.Advice = advice(a)
		out = append(out, a)
	}
	return out
}

// positionAt interpolates the traveller's position at trip minute t.
func positionAt(net *Network, tl []Sample, t float64) (float64, float64) {
	for _, s := range tl {
		if t <= s.T1 && s.T1 > s.T0 {
			f := math.Min(1, math.Max(0, (t-s.T0)/(s.T1-s.T0)))
			fx, fy := net.NodeX[net.From[s.Edge]], net.NodeY[net.From[s.Edge]]
			tx, ty := net.NodeX[net.To[s.Edge]], net.NodeY[net.To[s.Edge]]
			return fx + (tx-fx)*f, fy + (ty-fy)*f
		}
	}
	if len(tl) > 0 {
		e := tl[len(tl)-1].Edge
		return net.NodeX[net.To[e]], net.NodeY[net.To[e]]
	}
	return 0, 0
}

// Position is the traveller's location at trip minute t along c.
func (c Choice) Position(net *Network, t float64) (float64, float64) {
	return positionAt(net, c.Timeline, t)
}

func intensityWord(r float64) string {
	switch {
	case r < 5:
		return "light"
	case r < 10:
		return "moderate"
	case r < 20:
		return "heavy"
	}
	return "very heavy"
}

func advice(a Alert) (string, string) {
	in := a.MeetAt - a.IssueAt
	dur := a.Until - a.MeetAt
	word := intensityWord(a.Peak)
	if a.Covered {
		return fmt.Sprintf("Rain on your route in %.0f min, but you will be under cover", in),
			fmt.Sprintf("%s rain (%.0f mm/h) passes while you are inside. No action needed.", word, a.Peak)
	}
	head := fmt.Sprintf("Rain ahead of you in %.0f min · %s, %.0f mm/h", in, word, a.Peak)
	if in < 1 {
		head = fmt.Sprintf("Rain at your location now · %s, %.0f mm/h", word, a.Peak)
	}
	switch a.Kind {
	case model.Moto:
		return head, fmt.Sprintf("Pull over in about %.0f min and put on your raincoat before continuing. About %.0f min of riding in rain.", a.PrepAt-a.IssueAt, dur)
	case model.WaitBRT:
		return head, "Your halte is only partly covered. Put your raincoat on before you reach the stop."
	case model.Walk:
		if a.PrepAt > a.IssueAt+0.5 && a.PrepAt < a.MeetAt {
			return head, fmt.Sprintf("Put on your raincoat or open your umbrella before leaving the stop (in %.0f min). About %.0f min of walking in rain.", a.PrepAt-a.IssueAt, dur)
		}
		return head, fmt.Sprintf("Put on your raincoat now. About %.0f min of walking in rain.", dur)
	}
	return head, "Get your raincoat ready."
}
