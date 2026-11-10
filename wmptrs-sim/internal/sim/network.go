// Package sim builds the synthetic multimodal city, generates rain and
// forecast fields, and routes journeys under each cost variant.
package sim

import (
	"math"
	"math/rand/v2"
	"slices"

	"wmptrs-sim/internal/model"
)

// City extent in km; nodes sit on a 1 km lattice.
const (
	GridW = 30
	GridH = 16
	NX    = GridW + 1
	NY    = GridH + 1

	walkKmh  = 5.0
	motoKmh  = 22.0
	brtKmh   = 20.0
	railKmh  = 40.0
	brtWait  = 4.0 // half of the 8-min headway
	railWait = 6.0 // includes station access

	sigmaRoad = 0.15
	sigmaWalk = 0.10
)

// Line is a transit line, kept for drawing.
type Line struct {
	Name  string
	Rail  bool
	Stops [][2]float64
}

// Network is a directed graph in CSR form. Walk and motorcycle layers are
// disjoint: transit stops connect only to the walk layer.
type Network struct {
	NumNodes     int
	NodeX, NodeY []float64
	Off          []int32 // edges of node u are Off[u]..Off[u+1]
	From, To     []int32
	Tau          []float64 // minutes
	Kind         []model.Kind
	MidX, MidY   []float64
	Lines        []Line
}

// WalkNode is the walk-layer node at lattice point (x, y).
func WalkNode(x, y int) int { return y*NX + x }

// MotoNode is the motorcycle-layer node at lattice point (x, y).
func MotoNode(x, y int) int { return NX*NY + y*NX + x }

// BRT and rail layout.
var (
	brtRows = []int{2, 5, 8, 11, 14}
	brtCols = []int{3, 8, 13, 18, 23, 28}
)

type rawEdge struct {
	from, to int
	kind     model.Kind
	tau      float64
}

// NewNetwork builds the city. Link-time factors are drawn once from seed.
func NewNetwork(seed uint64) *Network {
	rng := rand.New(rand.NewPCG(seed, 0x6e6574))
	lognorm := func(s float64) float64 { return math.Exp(s * rng.NormFloat64()) }

	n := &Network{}
	addNode := func(x, y float64) int {
		n.NodeX = append(n.NodeX, x)
		n.NodeY = append(n.NodeY, y)
		return len(n.NodeX) - 1
	}
	for layer := 0; layer < 2; layer++ {
		for y := 0; y < NY; y++ {
			for x := 0; x < NX; x++ {
				addNode(float64(x), float64(y))
			}
		}
	}

	var edges []rawEdge
	both := func(a, b int, k model.Kind, tau float64) {
		edges = append(edges, rawEdge{a, b, k, tau}, rawEdge{b, a, k, tau})
	}
	for y := 0; y < NY; y++ {
		for x := 0; x < NX; x++ {
			for _, d := range [][2]int{{1, 0}, {0, 1}} {
				x2, y2 := x+d[0], y+d[1]
				if x2 >= NX || y2 >= NY {
					continue
				}
				both(WalkNode(x, y), WalkNode(x2, y2), model.Walk, 60/walkKmh*lognorm(sigmaWalk))
				both(MotoNode(x, y), MotoNode(x2, y2), model.Moto, 60/motoKmh*lognorm(sigmaRoad))
			}
		}
	}

	addLine := func(name string, rail bool, pts [][2]int) {
		wait, kmh, ride, waitKind := brtWait, brtKmh, model.RideBus, model.WaitBRT
		if rail {
			wait, kmh, ride, waitKind = railWait, railKmh, model.RideRail, model.WaitRail
		}
		ln := Line{Name: name, Rail: rail}
		prev := -1
		for i, p := range pts {
			s := addNode(float64(p[0]), float64(p[1]))
			ln.Stops = append(ln.Stops, [2]float64{float64(p[0]), float64(p[1])})
			street := WalkNode(p[0], p[1])
			edges = append(edges, rawEdge{street, s, waitKind, wait}, rawEdge{s, street, model.Alight, 0})
			if prev >= 0 {
				dist := math.Hypot(float64(p[0]-pts[i-1][0]), float64(p[1]-pts[i-1][1]))
				f := 1.0
				if !rail {
					f = lognorm(sigmaRoad)
				}
				both(prev, s, ride, dist/kmh*60*f)
			}
			prev = s
		}
		n.Lines = append(n.Lines, ln)
	}
	for i, y := range brtRows {
		var pts [][2]int
		for x := 0; x < NX; x++ {
			pts = append(pts, [2]int{x, y})
		}
		addLine("BRT H"+string(rune('1'+i)), false, pts)
	}
	for i, x := range brtCols {
		var pts [][2]int
		for y := 0; y < NY; y++ {
			pts = append(pts, [2]int{x, y})
		}
		addLine("BRT V"+string(rune('1'+i)), false, pts)
	}
	var r1, r2 [][2]int
	for i := 0; i <= 12; i++ {
		r1 = append(r1, [2]int{4 + 2*i, 1 + i})
	}
	for x := 0; x <= GridW; x += 3 {
		r2 = append(r2, [2]int{x, 12})
	}
	addLine("Rail R1", true, r1)
	addLine("Rail R2", true, r2)

	n.NumNodes = len(n.NodeX)
	slices.SortStableFunc(edges, func(a, b rawEdge) int { return a.from - b.from })
	m := len(edges)
	n.Off = make([]int32, n.NumNodes+1)
	n.From = make([]int32, m)
	n.To = make([]int32, m)
	n.Tau = make([]float64, m)
	n.Kind = make([]model.Kind, m)
	n.MidX = make([]float64, m)
	n.MidY = make([]float64, m)
	for i, e := range edges {
		n.Off[e.from+1]++
		n.From[i], n.To[i] = int32(e.from), int32(e.to)
		n.Tau[i], n.Kind[i] = e.tau, e.kind
		n.MidX[i] = (n.NodeX[e.from] + n.NodeX[e.to]) / 2
		n.MidY[i] = (n.NodeY[e.from] + n.NodeY[e.to]) / 2
	}
	for u := 0; u < n.NumNodes; u++ {
		n.Off[u+1] += n.Off[u]
	}
	return n
}

// NumEdges is the number of directed edges.
func (n *Network) NumEdges() int { return len(n.To) }
