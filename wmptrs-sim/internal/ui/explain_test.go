package ui

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	tea "github.com/charmbracelet/bubbletea"

	"wmptrs-sim/internal/sim"
)

// TestExplainerPages renders every slide, case (with search animation and
// heatmap), symbol card, data page and Q&A answer at three sizes and checks
// each frame is exactly w x h. WMPTRS_DUMP=dir writes the frames.
func TestExplainerPages(t *testing.T) {
	p := sim.Presets()[0].Params
	p.Journeys = 80
	ctx := context.Background()
	res, err := sim.Run(ctx, p, nil)
	if err != nil {
		t.Fatal(err)
	}
	sweep, _ := sim.Sweep(ctx, p, nil)
	bench, _ := sim.Bench(ctx, p, 20, 1)
	dump := os.Getenv("WMPTRS_DUMP")
	var robust *robustDoneMsg
	for _, size := range [][2]int{{80, 24}, {120, 34}, {160, 45}} {
		a := newApp(p)
		a.result, a.net, a.resultVer = res, res.Net, 1
		a.sweep, a.sweepFor, a.bench = sweep, p, bench
		a.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		now := time.Now()
		frame := func(name string, ticks int) {
			for f := 0; f < ticks; f++ {
				now = now.Add(fastTick)
				a.Update(tickMsg(now))
			}
			out := ansiRE.ReplaceAllString(a.View(), "")
			lines := strings.Split(out, "\n")
			if len(lines) != size[1] {
				t.Fatalf("%s %v: %d lines", name, size, len(lines))
			}
			for n, l := range lines {
				if utf8.RuneCountInString(l) != size[0] {
					t.Fatalf("%s %v: line %d has %d cells", name, size, n, utf8.RuneCountInString(l))
				}
			}
			if dump != "" {
				_ = os.WriteFile(fmt.Sprintf("%s/%s_%d.txt", dump, name, size[0]), []byte(out), 0o644)
			}
		}
		key := func(s string) {
			var m tea.KeyMsg
			switch s {
			case "right":
				m = tea.KeyMsg{Type: tea.KeyRight}
			case "down":
				m = tea.KeyMsg{Type: tea.KeyDown}
			default:
				m = tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(s)}
			}
			a.Update(m)
		}
		a.switchTo(scrMenu, 1)
		frame("menu", 120)
		a.switchTo(scrIntro, 1)
		frame("intro", 300)
		a.switchTo(scrGuide, 1)
		g := a.screens[scrGuide].(*guideScreen)
		for i := range g.slides {
			frame(fmt.Sprintf("guide%02d", i+1), 300)
			key("right")
		}
		a.switchTo(scrCases, 1)
		for i := range caseLib {
			key(fmt.Sprint(i + 1))
			frame(fmt.Sprintf("case%d", i+1), 120)
			key("i")
			frame(fmt.Sprintf("case%d_numbers", i+1), 10)
			key("i")
			frame(fmt.Sprintf("case%d_maths", i+1), 10)
			key("i")
		}
		key("2")
		key("s")
		frame("case2_search", 100)
		key("s")
		key("h")
		frame("case2_heat", 30)
		key("h")
		key("h")
		a.switchTo(scrAlert, 1)
		al := a.screens[scrAlert].(*alertScreen)
		for i := range al.scs {
			key(fmt.Sprint(i + 1))
			frame(fmt.Sprintf("alert%d_start", i+1), 5)
			for r := 0; r < numAlertRoutes; r++ {
				al.route = r
				al.recompute(a)
				if len(al.alerts[r]) > 0 {
					al.clock, al.playing = al.alerts[r][0].IssueAt+3, false
				} else {
					al.clock, al.playing = al.ch[r].T/2, false
				}
				frame(fmt.Sprintf("alert%d_r%d", i+1, r), 60)
				key("i")
				frame(fmt.Sprintf("alert%d_r%d_numbers", i+1, r), 5)
				key("i")
			}
		}
		a.switchTo(scrSymbols, 1)
		for i := range symbolCards {
			frame(fmt.Sprintf("symbol%02d", i+1), 60)
			key("down")
		}
		a.switchTo(scrData, 1)
		for i := range dataPages {
			frame(fmt.Sprintf("data%d", i+1), 30)
			key("right")
		}
		rb := a.screens[scrRobust].(*robustScreen)
		if robust == nil {
			m := rb.start(a)().(robustDoneMsg)
			if m.err != nil {
				t.Fatal(m.err)
			}
			robust = &m
		}
		r := *robust
		r.id = rb.id
		rb.receive(r)
		rb.forP = a.params
		a.switchTo(scrRobust, 1)
		for i := range robustPages {
			frame(fmt.Sprintf("robust%d", i+1), 60)
			key("right")
		}
		a.switchTo(scrQA, 1)
		for i := range qaItems {
			frame(fmt.Sprintf("qa%02d", i+1), 30)
			key("down")
		}
	}
}
