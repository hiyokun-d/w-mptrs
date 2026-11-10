package ui

import (
	"context"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	tea "github.com/charmbracelet/bubbletea"

	"wmptrs-sim/internal/sim"
)

var ansiRE = regexp.MustCompile(`\x1b\[[0-9;]*m`)

// TestRenderAllScreens drives every screen headlessly at the minimum and a
// large terminal size and checks that each frame has exactly w x h cells.
// Set WMPTRS_DUMP=dir to write plain-text frames for inspection.
func TestRenderAllScreens(t *testing.T) {
	p := sim.Presets()[0].Params
	p.Journeys = 120
	ctx := context.Background()
	res, err := sim.Run(ctx, p, nil)
	if err != nil {
		t.Fatal(err)
	}
	sweep, err := sim.Sweep(ctx, p, nil)
	if err != nil {
		t.Fatal(err)
	}
	bench, err := sim.Bench(ctx, p, 20, 1)
	if err != nil {
		t.Fatal(err)
	}
	dump := os.Getenv("WMPTRS_DUMP")
	for _, size := range [][2]int{{80, 24}, {140, 40}} {
		a := newApp(p)
		a.result, a.net, a.resultVer = res, res.Net, 1
		for i := range res.Journeys {
			a.arrived = append(a.arrived, &res.Journeys[i])
		}
		a.runDone, a.runTotal = len(res.Journeys), len(res.Journeys)
		a.sweep, a.sweepFor, a.sweepVer = sweep, p, 1
		a.bench, a.benchFor, a.benchVer = bench, p, 1
		a.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		now := time.Now()
		for i := range a.screens {
			a.switchTo(i, 1)
			for f := 0; f < 400; f++ {
				now = now.Add(fastTick)
				a.Update(tickMsg(now))
			}
			frame := ansiRE.ReplaceAllString(a.View(), "")
			lines := strings.Split(frame, "\n")
			if len(lines) != size[1] {
				t.Fatalf("%s %v: %d lines", a.screens[i].title(), size, len(lines))
			}
			for n, l := range lines {
				if utf8.RuneCountInString(l) != size[0] {
					t.Fatalf("%s %v: line %d has %d cells", a.screens[i].title(), size, n, utf8.RuneCountInString(l))
				}
			}
			if !strings.Contains(frame, honesty) {
				t.Fatalf("%s %v: honesty footer missing", a.screens[i].title(), size)
			}
			if dump != "" {
				name := dump + "/" + strings.ReplaceAll(a.screens[i].title(), " ", "_") + "_" + strconv.Itoa(size[0]) + ".txt"
				_ = os.WriteFile(name, []byte(frame), 0o644)
			}
		}
		a.help = true
		frame := ansiRE.ReplaceAllString(a.View(), "")
		if dump != "" {
			_ = os.WriteFile(dump+"/help_"+strconv.Itoa(size[0])+".txt", []byte(frame), 0o644)
		}
	}
}
