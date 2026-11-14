package ui

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	tea "github.com/charmbracelet/bubbletea"

	"wmptrs-sim/internal/sim"
)

// Every Guide slide and Menu entry must have an Indonesian version, and the
// Indonesian frames must still fit the terminal exactly.
func TestIndonesian(t *testing.T) {
	for _, sl := range guideSlides() {
		if _, ok := idSlides[sl.title]; !ok {
			t.Errorf("slide %q has no Indonesian text", sl.title)
		}
	}
	for _, e := range menuEntries {
		if _, ok := idMenu[e.screen]; !ok {
			t.Errorf("menu entry %d has no Indonesian text", e.screen)
		}
	}
	for _, s := range menuSections {
		if _, ok := idSections[s.blurb]; !ok {
			t.Errorf("section %q has no Indonesian blurb", s.name)
		}
	}

	p := sim.Presets()[0].Params
	a := newApp(p)
	a.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	a.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("L")})
	defer SetIndonesian(false)
	if !langID {
		t.Fatal("L did not switch language")
	}
	now := time.Now()
	check := func(name, want string) {
		for f := 0; f < 300; f++ {
			now = now.Add(fastTick)
			a.Update(tickMsg(now))
		}
		out := ansiRE.ReplaceAllString(a.View(), "")
		for n, l := range strings.Split(out, "\n") {
			if utf8.RuneCountInString(l) != 80 {
				t.Fatalf("%s: line %d has %d cells", name, n, utf8.RuneCountInString(l))
			}
		}
		if !strings.Contains(out, want) {
			t.Errorf("%s: %q not on screen", name, want)
		}
	}
	a.switchTo(scrMenu, 1)
	check("menu", "mau ke mana")
	a.switchTo(scrGuide, 1)
	check("guide", "Hujan mengubah")
}
