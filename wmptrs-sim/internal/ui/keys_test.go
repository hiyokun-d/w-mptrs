package ui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"wmptrs-sim/internal/sim"
)

func TestTabCyclesScreens(t *testing.T) {
	a := newApp(sim.Presets()[0].Params)
	a.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	for want := 1; want <= len(a.screens); want++ {
		a.Update(tea.KeyMsg{Type: tea.KeyTab})
		if a.cur != want%len(a.screens) {
			t.Fatalf("after %d tabs cur = %d", want, a.cur)
		}
	}
	a.Update(tea.KeyMsg{Type: tea.KeyShiftTab})
	if a.cur != len(a.screens)-1 {
		t.Fatalf("shift+tab: cur = %d", a.cur)
	}
}
