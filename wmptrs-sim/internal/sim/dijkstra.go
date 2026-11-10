package sim

import "math"

type heapItem struct {
	d float64
	u int32
}

// router holds per-worker scratch buffers so routing allocates nothing.
type router struct {
	net   *Network
	dist  []float64
	prevE []int32
	heap  []heapItem
	cost  []float64
}

func newRouter(n *Network) *router {
	return &router{
		net:   n,
		dist:  make([]float64, n.NumNodes),
		prevE: make([]int32, n.NumNodes),
		heap:  make([]heapItem, 0, 256),
		cost:  make([]float64, n.NumEdges()),
	}
}

func (r *router) push(it heapItem) {
	h := append(r.heap, it)
	i := len(h) - 1
	for i > 0 {
		p := (i - 1) / 2
		if h[p].d <= h[i].d {
			break
		}
		h[p], h[i] = h[i], h[p]
		i = p
	}
	r.heap = h
}

func (r *router) pop() heapItem {
	h := r.heap
	top := h[0]
	last := len(h) - 1
	h[0] = h[last]
	h = h[:last]
	i := 0
	for {
		l, m := 2*i+1, i
		if l < len(h) && h[l].d < h[m].d {
			m = l
		}
		if l+1 < len(h) && h[l+1].d < h[m].d {
			m = l + 1
		}
		if m == i {
			break
		}
		h[i], h[m] = h[m], h[i]
		i = m
	}
	r.heap = h
	return top
}

// shortest runs Dijkstra on r.cost from src to dst and appends the edge path
// (in travel order) to buf. Returns +Inf if unreachable.
func (r *router) shortest(src, dst int, buf []int32) (float64, []int32) {
	n := r.net
	for i := range r.dist {
		r.dist[i] = math.Inf(1)
		r.prevE[i] = -1
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
		if u == dst {
			break
		}
		for e := n.Off[u]; e < n.Off[u+1]; e++ {
			v := n.To[e]
			nd := it.d + r.cost[e]
			if nd < r.dist[v] {
				r.dist[v] = nd
				r.prevE[v] = e
				r.push(heapItem{nd, v})
			}
		}
	}
	if math.IsInf(r.dist[dst], 1) {
		return r.dist[dst], buf
	}
	start := len(buf)
	for v := dst; v != src; v = int(n.From[r.prevE[v]]) {
		buf = append(buf, r.prevE[v])
	}
	p := buf[start:]
	for i, j := 0, len(p)-1; i < j; i, j = i+1, j-1 {
		p[i], p[j] = p[j], p[i]
	}
	return r.dist[dst], buf
}
