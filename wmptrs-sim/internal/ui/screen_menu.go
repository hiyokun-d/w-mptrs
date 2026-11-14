package ui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
)

const fullName = "Weather-Aware Multimodal Public Transportation Routing System"

// Screen indices, in suggested presentation order.
const (
	scrIntro = iota
	scrMenu
	scrGuide
	scrSymbols
	scrCases
	scrAlert
	scrParams
	scrRun
	scrResults
	scrTradeoff
	scrPhi
	scrData
	scrRobust
	scrQA
	scrBench
	numScreens
)

// menuEntry describes a screen for the menu and the header breadcrumb.
type menuEntry struct {
	screen  int
	hotkey  string
	section string
	purpose string // one line: what you get here
	detail  string // rich text: when to use it
}

var menuSections = []struct {
	name, blurb string
	col         uint8
}{
	{"LEARN", "what the model is and why", cRain},
	{"DEMO", "see it work on a map", cGreen},
	{"EXPERIMENT", "run it on hundreds of journeys", cAmber},
	{"EVIDENCE", "data, statistics and reviewer answers", cMagenta},
}

var menuEntries = []menuEntry{
	{scrGuide, "g", "LEARN", "16 illustrated slides: problem → idea → maths → impact",
		"«Start here.» Each slide pairs an animated picture with a short explanation. ‹←→› to move, ‹p› to autoplay while you present."},
	{scrSymbols, "y", "LEARN", "every symbol (β, φ, E, r0, k, σ …) with meaning and effect",
		"A reference card per variable: what it means, its unit and default, «why the model needs it», and what happens when you raise or lower it."},
	{scrCases, "c", "DEMO", "8 hand-built journeys on the city map, fully interactive",
		"Concrete stories: modal shift, detour, drizzle, the threshold cliff, a wrong forecast. Move the storm with the arrow keys and watch the route change. ‹s› animates Dijkstra, ‹h› shows the penalty heatmap."},
	{scrAlert, "n", "DEMO", "moving storms: route on the rain you'll meet + raincoat alerts",
		"Storms drift like a real nowcast. Compares A0, DP on the rain «now», and DP on the rain «you will meet». A notification warns you before rain reaches you and says where to «put on your raincoat». ‹space› play/pause, ‹←→› scrub time, ‹v› route."},
	{scrParams, "a", "EXPERIMENT", "set β, r0, k, forecast error, journeys, seed",
		"Sliders for every parameter, plus 4 presets. ‹enter› starts a run with these settings."},
	{scrRun, "u", "EXPERIMENT", "watch the five variants route every journey live",
		"Journeys stream in. The map draws the A3 route over the dim A0 route. Browse finished journeys with ‹←→›."},
	{scrResults, "e", "EXPERIMENT", "rain-dose reduction, CIs, significance tests",
		"Headline result: total dose reduction per variant with bootstrap 95 % CIs, Friedman and Holm-adjusted Wilcoxon tests, and the outcome table."},
	{scrTradeoff, "t", "EXPERIMENT", "time cost vs rain saved as β grows",
		"Re-routes the same journeys for β from 0 to 8, for A1, A2 and A3. Shows the whole trade-off curve, not just one setting."},
	{scrPhi, "f", "EXPERIMENT", "shape the φ curve with r0, k and β",
		"Interactive cost-multiplier curves per exposure class, with A1 and A2 overlays. Changes carry into the next run."},
	{scrData, "d", "EVIDENCE", "where every number comes from: network, rain, forecast error",
		"Distributions from the current run, plus the source of every constant (assumption, BMKG category, or design choice)."},
	{scrRobust, "o", "EVIDENCE", "20 seeds, E / w_m sensitivity, moving storms, alert POD/FAR",
		"Re-runs everything many times: «20 independent seeds», one-at-a-time changes of the assumed «E and w_m», the «moving-storm» experiment (DP-now vs DP-ahead, with motion-forecast error) and «raincoat alert» verification scores. About 5 s to compute."},
	{scrQA, "w", "EVIDENCE", "answers to questions a reviewer is likely to ask",
		"Why this algorithm, why a sigmoid, why these tests, why apps should adopt it, and its limits. Some answers quote live numbers from your run."},
	{scrBench, "x", "EVIDENCE", "microseconds per routing call, per variant",
		"Shows the weather-aware cost adds little or no routing overhead."},
}

func entryFor(screen int) (menuEntry, bool) {
	for _, e := range menuEntries {
		if e.screen == screen {
			return e, true
		}
	}
	return menuEntry{}, false
}

type menuScreen struct {
	sel  int
	glow Spring
	k    struct{ nav, open, hot key.Binding }
}

func newMenu() *menuScreen {
	m := &menuScreen{glow: newSpring(8, 0.8)}
	m.k.nav = key.NewBinding(key.WithKeys("up", "down", "k", "j"), key.WithHelp("↑↓", "choose"))
	m.k.open = key.NewBinding(key.WithKeys("enter", "right"), key.WithHelp("enter", "open"))
	m.k.hot = key.NewBinding(key.WithKeys("g"), key.WithHelp("letter", "jump"))
	return m
}

func (m *menuScreen) title() string       { return "Menu" }
func (m *menuScreen) captures() bool      { return false }
func (m *menuScreen) keys() []key.Binding { return []key.Binding{m.k.nav, m.k.open, m.k.hot} }
func (m *menuScreen) enter(a *App) tea.Cmd {
	// highlight the screen we came from, so "back to menu" keeps your place
	for i, e := range menuEntries {
		if e.screen == a.prev {
			m.sel = i
		}
	}
	return nil
}

func (m *menuScreen) update(a *App, msg tea.KeyMsg) tea.Cmd {
	ks := msg.String()
	switch ks {
	case "up", "k":
		m.sel = (m.sel + len(menuEntries) - 1) % len(menuEntries)
		return nil
	case "down", "j":
		m.sel = (m.sel + 1) % len(menuEntries)
		return nil
	case "enter", "right", "l":
		return a.switchTo(menuEntries[m.sel].screen, 1)
	}
	for i, e := range menuEntries {
		if ks == e.hotkey {
			m.sel = i
			return a.switchTo(e.screen, 1)
		}
	}
	return nil
}

func (m *menuScreen) tick(a *App, steps int) bool {
	m.glow.Target = float64(m.sel)
	return m.glow.Step(steps)
}

func (m *menuScreen) draw(a *App, c *Canvas, w, h int) {
	lw := w
	showDetail := w >= 100
	if showDetail {
		lw = w * 62 / 100
	}
	done := c.Box(0, 0, lw, h, cBorderHi, L("Menu · where do you want to go?", "Menu · mau ke mana?"))
	iw, ih := lw-4, h-2
	// rows: section headers + entries; compress when short
	rows := len(menuEntries) + len(menuSections)
	gap := 0
	if ih >= rows+len(menuSections)+2 {
		gap = 1
	}
	y := 0
	if ih >= rows+len(menuSections)*gap+3 {
		c.Text(0, y, fmt.Sprintf(L("First time? Go down the list 1 → %d, or press a [letter] to jump.", "Pertama kali? Ikuti daftar 1 → %d, atau tekan [huruf] untuk lompat."), len(menuEntries)), cDim)
		y += 2
	}
	glowY := -1
	num := 0
	for si, sec := range menuSections {
		if si > 0 {
			y += gap
		}
		c.TextA(0, y, sec.name, sec.col, attrBold)
		if iw > 40 {
			c.Text(runeLen(sec.name)+1, y, "· "+sectionBlurb(sec.blurb), cFaint)
		}
		y++
		for i, e := range menuEntries {
			if e.section != sec.name {
				continue
			}
			num++
			if y >= ih {
				break
			}
			sel := i == m.sel
			if sel {
				glowY = y
			}
			name := a.screens[e.screen].title()
			badge := fmt.Sprintf("%2d", num)
			col := cText
			if sel {
				col = cWhite
			}
			c.Text(0, y, badge, sec.col)
			c.TextA(3, y, fmt.Sprintf("%-11s", name), col, map[bool]attr{true: a.hl(), false: 0}[sel])
			c.TextA(15, y, "["+e.hotkey+"]", cRain, attrBold)
			purpose := entryPurpose(e)
			if pw := iw - 20; runeLen(purpose) > pw && pw > 3 {
				purpose = string([]rune(purpose)[:pw-1]) + "…"
			}
			c.Text(19, y, purpose, map[bool]uint8{true: cText, false: cDim}[sel])
			y++
		}
	}
	// animated selection bar under the highlighted row
	if glowY >= 0 && !a.th.mono {
		for x := -1; x < iw+1; x++ {
			c.SetBG(x, glowY, cR1)
		}
		c.Put(-1, glowY, '▌', cRain)
	}
	done()

	sel := menuEntries[m.sel]
	if showDetail {
		done = c.Box(lw, 0, w-lw, h, cBorder, a.screens[sel.screen].title())
		dw := w - lw - 4
		yy := rich(c, 0, 0, dw, h-2, entryDetail(sel), cText)
		yy++
		if yy < h-6 {
			c.Text(0, yy, "keys on that screen:", cDim)
			yy++
			for _, b := range a.screens[sel.screen].keys() {
				if yy >= h-4 {
					break
				}
				c.TextA(1, yy, b.Help().Key, cRain, attrBold)
				c.Text(12, yy, b.Help().Desc, cText)
				yy++
			}
		}
		lines := []string{"Anywhere: ‹m› menu · ‹tab› next screen · ‹r› run · ‹?› help"}
		for i, l := range lines {
			rich(c, 0, h-3-len(lines)+1+i, dw, 1, l, cDim)
		}
		done()
	} else if h > 3 {
		// narrow: show the selected entry's detail on the bottom border line
		d := strings.ReplaceAll(strings.ReplaceAll(entryPurpose(sel), "«", ""), "»", "")
		c.TextR(w-2, h-1, " "+d+" ", cDim)
	}
}
