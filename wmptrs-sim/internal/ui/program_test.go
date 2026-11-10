package ui

import (
	"bytes"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"wmptrs-sim/internal/sim"
)

// TestProgramFlow runs the real Bubble Tea loop: start a run, then tab
// through every screen while the simulation streams in.
func TestProgramFlow(t *testing.T) {
	a := newApp(sim.Presets()[0].Params)
	var out bytes.Buffer
	p := tea.NewProgram(a, tea.WithInput(nil), tea.WithOutput(&out), tea.WithoutSignals())
	done := make(chan error)
	go func() { _, err := p.Run(); done <- err }()
	p.Send(tea.WindowSizeMsg{Width: 80, Height: 24})
	time.Sleep(200 * time.Millisecond)
	p.Send(tea.KeyMsg{Type: tea.KeyEnter})
	time.Sleep(200 * time.Millisecond)
	p.Send(tea.KeyMsg{Type: tea.KeyEnter})
	time.Sleep(300 * time.Millisecond)
	for i := 0; i < 4; i++ {
		p.Send(tea.KeyMsg{Type: tea.KeyTab})
		time.Sleep(300 * time.Millisecond)
	}
	p.Quit()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if a.cur != 6 {
		t.Fatalf("expected Bench (6) after 4 tabs from Run, got %d", a.cur)
	}
	if a.result == nil {
		t.Fatal("run did not finish")
	}
}
