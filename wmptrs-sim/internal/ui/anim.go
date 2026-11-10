package ui

import (
	"math"

	"github.com/charmbracelet/harmonica"
)

// Spring animates Pos toward Target with harmonica physics at a fixed 60 Hz
// step; Step is called with the number of 60 Hz steps elapsed.
type Spring struct {
	Pos, Vel, Target float64
	s                harmonica.Spring
}

func newSpring(freq, damping float64) Spring {
	return Spring{s: harmonica.NewSpring(harmonica.FPS(60), freq, damping)}
}

// Step advances the spring and reports whether it is still moving.
func (s *Spring) Step(n int) bool {
	if s.Pos == s.Target && s.Vel == 0 {
		return false
	}
	for i := 0; i < n; i++ {
		s.Pos, s.Vel = s.s.Update(s.Pos, s.Vel, s.Target)
	}
	scale := math.Max(1e-3, math.Abs(s.Target)*1e-4)
	if math.Abs(s.Pos-s.Target) < scale && math.Abs(s.Vel) < scale {
		s.Pos, s.Vel = s.Target, 0
		return false
	}
	return true
}

// Jump sets position and target without animation.
func (s *Spring) Jump(v float64) { s.Pos, s.Target, s.Vel = v, v, 0 }
