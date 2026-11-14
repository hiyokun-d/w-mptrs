package sim

import (
	"math"

	"wmptrs-sim/internal/model"
)

// RouteSetup routes one hand-made journey under A0..A4 plus the oracle and
// keeps the paths. Used by the case studies and the guide.
func RouteSetup(net *Network, s Setup, p Params) Journey {
	ev := &evaluator{net: net, cfgs: VariantConfigs(p.Model()), oracle: true, keepPaths: true, r0: p.R0, sh: p.Shelter}
	m := net.NumEdges()
	return ev.journey(newRouter(net), 0, s, make([]float64, m), make([]float64, m), nil)
}

// EdgeRain returns the true and forecast rain (mm/h) at every edge midpoint.
func EdgeRain(net *Network, s Setup) (truth, fc []float64) {
	f := NewForecast(s.Cells, s.ShiftX, s.ShiftY, &s.Noise)
	m := net.NumEdges()
	truth, fc = make([]float64, m), make([]float64, m)
	for e := 0; e < m; e++ {
		truth[e] = RainAt(s.Cells, net.MidX[e], net.MidY[e], 0, 0)
		fc[e] = f.At(net.MidX[e], net.MidY[e])
	}
	return truth, fc
}

// Trace is a recorded Dijkstra search, for animating how the router explores.
type Trace struct {
	Settled []int32 // nodes in the order they were settled
	Path    []int32 // edge ids of the chosen path
	Cost    float64
}

// TraceShortest prices every edge under v on field and runs Dijkstra from
// src to dst, recording the settle order.
func TraceShortest(net *Network, v model.Variant, mp model.Params, field []float64, src, dst int) Trace {
	rt := newRouter(net)
	for e := range rt.cost {
		rt.cost[e] = v.Cost(net.Tau[e], net.Kind[e], field[e], mp)
	}
	var tr Trace
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
		tr.Settled = append(tr.Settled, int32(u))
		if u == dst {
			break
		}
		for e := net.Off[u]; e < net.Off[u+1]; e++ {
			w := net.To[e]
			if nd := it.d + rt.cost[e]; nd < rt.dist[w] {
				rt.dist[w] = nd
				rt.prevE[w] = e
				rt.push(heapItem{nd, w})
			}
		}
	}
	tr.Cost = rt.dist[dst]
	if math.IsInf(tr.Cost, 1) {
		return tr
	}
	for w := dst; w != src; w = int(net.From[rt.prevE[w]]) {
		tr.Path = append(tr.Path, rt.prevE[w])
	}
	for i, j := 0, len(tr.Path)-1; i < j; i, j = i+1, j-1 {
		tr.Path[i], tr.Path[j] = tr.Path[j], tr.Path[i]
	}
	return tr
}
