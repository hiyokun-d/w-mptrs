package ui

import (
	"fmt"
	"math"
	"slices"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"

	"wmptrs-sim/internal/model"
	"wmptrs-sim/internal/sim"
)

// alertScenario is a journey with a moving storm, used to show routing on
// the rain you will meet (not the rain right now) and the raincoat alert.
type alertScenario struct {
	name   string
	setup  sim.Setup
	motion sim.Motion
	story  string
}

func alertScenarios() []alertScenario {
	return []alertScenario{
		{"Rain is coming", mkSetup(3, 3, 27, 13, 0, 0, sim.Cell{X: 2, Y: 15, Peak: 25, Radius: 3}),
			sim.Motion{VX: 0.2, VY: -0.1},
			"«Dry right now.» A 25 mm/h storm in the north-west is drifting south-east at about 13 km/h.\n\n" +
				"• ‹A0› rides straight into it.\n" +
				"• ‹DP-now› prices edges on the rain «at departure». The route is dry now, so it sees nothing and rides into it too.\n" +
				"• ‹DP-ahead› prices each edge with the rain forecast «for the minute you get there», and avoids the storm.\n\n" +
				"Pick A0 with ‹v› to see the ‹raincoat alert›. It fires 15 min ahead, like a navigation app's \"rain ahead\" warning, and says where to pull over."},
		{"Storm moving away", mkSetup(2, 4, 27, 11, 0, 0, sim.Cell{X: 14, Y: 8, Peak: 30, Radius: 3.5}),
			sim.Motion{VX: 0, VY: -0.35},
			"«Raining hard on the route right now», but the storm is moving south at 21 km/h.\n\n" +
				"• ‹DP-now› detours around where the storm «is». That is exactly where it is «going», so it ends up «slower and wetter».\n" +
				"• ‹DP-ahead› knows the storm will have moved on by the time you get there. It keeps the fast route and stays dry.\n\n" +
				"⟦A static rain snapshot can be worse than no rain information at all.⟧ Using motion is what makes it safe."},
		{"Rain you can't avoid", mkSetup(5, 2, 17, 13, 0, 0, sim.Cell{X: 11, Y: 13, Peak: 20, Radius: 2.5}),
			sim.Motion{VX: 0.12, VY: 0},
			"A storm is moving east over the «destination». Every reasonable route meets it near the end of the trip.\n\n" +
				"Routing alone cannot keep you dry, so the system «warns you» instead.\n\n" +
				"• About 15 min before the rain reaches you: «\"Rain ahead of you\"».\n" +
				"• It points to where to «pull over and put on a raincoat», shown as ‹▲› on the map, «before» you get wet, not after.\n\n" +
				"This is the second half of weather-aware routing: «pick the driest route, then prepare the traveller for what is left».",
		},
		{"Under cover", mkSetup(5, 2, 22, 10, 0, 0, sim.Cell{X: 16, Y: 10, Peak: 20, Radius: 2.5}),
			sim.Motion{VX: 0.12, VY: 0},
			"Heavy rain crosses the route, but you are «inside the train» when it does.\n\n" +
				"The alert still informs you («\"rain passes while you are inside, no action needed\"»), but it does «not» tell you to stop or change. " +
				"Alerts use the same exposure model ‹E› as routing, so they only nag when you would actually get wet.\n\n" +
				"Fewer false alarms means users keep notifications on."},
	}
}

const (
	routeA0 = iota
	routeNow
	routeAhead
	numAlertRoutes
)

var alertRouteNames = [numAlertRoutes]string{"A0 time-only", "DP-now", "DP-ahead"}
var alertRouteCols = [numAlertRoutes]uint8{cMagenta, cAmber, cRain}

const (
	alertHorizon = 15.0 // nowcast lead time, minutes
	tripSpeed    = 4.0  // trip minutes per real second
)

type alertScreen struct {
	m      cityMap
	net    *sim.Network
	scs    []alertScenario
	sel    int
	route  int
	ch     [numAlertRoutes]sim.Choice
	alerts [numAlertRoutes][]sim.Alert
	forP   model.Params
	dirty  bool

	clock   float64 // trip minute
	playing bool
	banner  Spring
	shown   int // index of the alert currently in the banner, -1 none
	info    int
	story   scrollText
	k       struct{ pick, route, play, scrub, info, restart, scroll key.Binding }
}

func newAlert() *alertScreen {
	s := &alertScreen{scs: alertScenarios(), route: routeAhead, playing: true, dirty: true, shown: -1, banner: newSpring(7, 0.6)}
	s.k.pick = key.NewBinding(key.WithKeys("1", "2", "3", "4", "n", "b"), key.WithHelp("1-4", "scenario"))
	s.k.route = key.NewBinding(key.WithKeys("v"), key.WithHelp("v", "route"))
	s.k.play = key.NewBinding(key.WithKeys(" "), key.WithHelp("space", "pause"))
	s.k.scrub = key.NewBinding(key.WithKeys("left", "right"), key.WithHelp("←→", "scrub time"))
	s.k.info = key.NewBinding(key.WithKeys("i"), key.WithHelp("i", "panel"))
	s.k.restart = key.NewBinding(key.WithKeys("0"), key.WithHelp("0", "restart"))
	s.k.scroll = key.NewBinding(key.WithKeys("pgdown", "pgup"), key.WithHelp("pgdn/up", "scroll"))
	return s
}

func (s *alertScreen) title() string  { return "Rain alert" }
func (s *alertScreen) captures() bool { return false }
func (s *alertScreen) keys() []key.Binding {
	return []key.Binding{s.k.pick, s.k.route, s.k.play, s.k.scrub, s.k.info, s.k.restart, s.k.scroll}
}

func (s *alertScreen) enter(a *App) tea.Cmd {
	if s.net == nil {
		s.net = sim.NewNetwork(caseSeed)
	}
	return nil
}

func (s *alertScreen) load(i int) {
	s.sel = (i + len(s.scs)) % len(s.scs)
	s.dirty, s.clock, s.playing, s.shown = true, 0, true, -1
	s.banner.Jump(0)
	s.story.off = 0
}

func (s *alertScreen) recompute(a *App) {
	if s.net == nil {
		s.net = sim.NewNetwork(caseSeed)
	}
	mp := a.params.Model()
	if !s.dirty && mp == s.forP {
		return
	}
	sc := s.scs[s.sel]
	zero := make([]float64, s.net.NumEdges())
	s.ch[routeA0] = sim.Choose(s.net, sc.setup, model.A0, mp, zero, sc.motion)
	s.ch[routeNow] = sim.Choose(s.net, sc.setup, model.A3, mp, sim.FieldNow(s.net, sc.setup), sc.motion)
	s.ch[routeAhead] = sim.Choose(s.net, sc.setup, model.A3, mp, sim.FieldAhead(s.net, sc.setup, sc.motion), sc.motion)
	for r := range s.ch {
		s.alerts[r] = sim.PlanAlerts(s.net, s.ch[r], alertHorizon)
	}
	s.dirty, s.forP = false, mp
}

func (s *alertScreen) update(a *App, msg tea.KeyMsg) tea.Cmd {
	ks := msg.String()
	if s.info == 0 && s.story.key(ks) && ks != " " {
		return nil
	}
	switch ks {
	case "1", "2", "3", "4":
		s.load(int(ks[0] - '1'))
	case "n":
		s.load(s.sel + 1)
	case "b":
		s.load(s.sel - 1)
	case "v":
		s.route = (s.route + 1) % numAlertRoutes
		s.shown = -1
		s.banner.Jump(0)
	case " ":
		s.playing = !s.playing
	case "left":
		s.clock = math.Max(0, s.clock-2)
		s.playing = false
	case "right":
		s.clock += 2
		s.playing = false
	case "0":
		s.clock, s.playing, s.shown = 0, true, -1
		s.banner.Jump(0)
	case "i":
		s.info = (s.info + 1) % 2
	}
	return nil
}

func (s *alertScreen) tripEnd() float64 {
	end := 0.0
	for _, c := range s.ch {
		end = math.Max(end, c.T)
	}
	return end
}

// active returns the alert to show at the current clock, or -1.
func (s *alertScreen) active() int {
	for i, al := range s.alerts[s.route] {
		if s.clock >= al.IssueAt && s.clock < al.Until {
			return i
		}
	}
	return -1
}

func (s *alertScreen) tick(a *App, steps int) bool {
	s.recompute(a)
	if s.playing {
		s.clock += tripSpeed * float64(steps) / 60
		if s.clock > s.tripEnd()+6 {
			s.clock = 0 // loop the demo
			s.shown = -1
			s.banner.Jump(0)
		}
	}
	s.clock = math.Min(s.clock, s.tripEnd()+6)
	if act := s.active(); act != s.shown {
		s.shown = act
		if act >= 0 {
			s.banner.Pos, s.banner.Vel = 0, 0
		}
	}
	s.banner.Target = 0
	if s.shown >= 0 {
		s.banner.Target = 1
	}
	return s.banner.Step(steps) || s.playing
}

func (s *alertScreen) draw(a *App, c *Canvas, w, h int) {
	s.recompute(a)
	sc := s.scs[s.sel]
	rw := min(46, max(36, w*2/5))
	mw := w - rw
	done := c.Box(0, 0, mw, h, cBorder, fmt.Sprintf("Scenario %d/%d · %s · minute %.0f", s.sel+1, len(s.scs), sc.name, s.clock))

	// storm drifted to the current trip minute
	cells := slices.Clone(sc.setup.Cells)
	for i := range cells {
		cells[i].X += sc.motion.VX * s.clock
		cells[i].Y += sc.motion.VY * s.clock
	}
	j := &sim.Journey{Setup: sc.setup}
	j.Cells = cells
	for _, ch := range s.ch {
		j.Out = append(j.Out, sim.Outcome{Path: ch.Path})
	}
	mv := mapView{j: j, net: s.net, base: routeA0, cmp: s.route, frac: 1, t: a.t, noBase: s.route == routeA0}
	cur := s.ch[s.route]
	tx, ty := cur.Position(s.net, math.Min(s.clock, cur.T))
	mv.marks = append(mv.marks, mapMark{tx, ty, '●', cWhite})
	for _, al := range s.alerts[s.route] {
		if !al.Covered && s.clock >= al.IssueAt {
			mv.marks = append(mv.marks, mapMark{al.PrepX, al.PrepY, '▲', cGold})
		}
	}
	// storm motion arrow at the main cell
	if len(cells) > 0 {
		mv.marks = append(mv.marks, mapMark{cells[0].X + sc.motion.VX*8, cells[0].Y + sc.motion.VY*8, arrowFor(sc.motion), cWhite})
	}
	mapH := h - 3
	r := c.Sub(-1, 0, mw-2, mapH)
	s.m.draw(a, c, mw-2, mapH, mv)
	r()

	// notification banner sliding down from the top of the map
	if s.shown >= 0 && s.banner.Pos > 0.02 {
		al := s.alerts[s.route][s.shown]
		bw := min(mw-6, 64)
		bh := 4
		by := int(math.Round((s.banner.Pos - 1) * float64(bh+1)))
		border := cAmber
		head := liveHeadline(al, s.clock)
		if al.Covered {
			border = cRain
		}
		bd := c.Box(max(0, (mw-4-bw)/2), by, bw, bh, border, "")
		c.TextA(0, 0, trunc(L("RAIN ALERT · ", "PERINGATAN HUJAN · ")+head, bw-4), border, attrBold)
		rich(c, 0, 1, bw-4, 2, liveAdvice(al, s.clock), cText)
		bd()
	}
	y := h - 3
	x := 0
	for i, n := range alertRouteNames {
		col := cDim
		if i == s.route {
			col = alertRouteCols[i]
		}
		x += c.TextA(x, y, "━"+n, col, map[bool]attr{true: attrBold, false: 0}[i == s.route]) + 2
	}
	if x+30 < mw-4 {
		c.Text(x, y, L("● you  ▲ raincoat stop", "● Anda  ▲ titik jas hujan"), cDim)
	}
	done()

	// right panel
	title := "Story · i: numbers"
	if s.info == 1 {
		title = "Numbers · i: story"
	}
	done = c.Box(mw, 0, rw, h, cBorderHi, title)
	iw, ih := rw-4, h-2
	yy := 0
	for i := range s.scs {
		col, ch := cFaint, '○'
		if i == s.sel {
			col, ch = cRain, '●'
		}
		c.Put(i*2, yy, ch, col)
	}
	state := "playing · space"
	if !s.playing {
		state = "paused · space"
	}
	c.TextR(iw, yy, state, cDim)
	yy += 2
	// trip timeline for the selected route
	yy = s.drawTimeline(c, yy, iw)
	yy++
	rr := c.Sub(0, yy, iw, ih-yy)
	if s.info == 0 {
		s.story.draw(c, iw, ih-yy, sc.story)
	} else {
		s.drawNumbers(c, iw, ih-yy)
	}
	rr()
	done()
}

func arrowFor(m sim.Motion) rune {
	ang := math.Atan2(m.VY, m.VX) * 180 / math.Pi
	switch {
	case ang > -22.5 && ang <= 22.5:
		return '→'
	case ang > 22.5 && ang <= 67.5:
		return '↗'
	case ang > 67.5 && ang <= 112.5:
		return '↑'
	case ang > 112.5 && ang <= 157.5:
		return '↖'
	case ang > -67.5 && ang <= -22.5:
		return '↘'
	case ang > -112.5 && ang <= -67.5:
		return '↓'
	case ang > -157.5 && ang <= -112.5:
		return '↙'
	}
	return '←'
}

// liveHeadline counts the minutes down as the traveller approaches the rain.
func liveHeadline(al sim.Alert, now float64) string {
	in := al.MeetAt - now
	var word string
	switch {
	case al.Peak >= 20:
		word = L("very heavy rain", "hujan sangat lebat")
	case al.Peak >= 10:
		word = L("heavy rain", "hujan lebat")
	case al.Peak >= 5:
		word = L("moderate rain", "hujan sedang")
	default:
		word = L("light rain", "hujan ringan")
	}
	if al.Covered {
		if in >= 1 {
			return fmt.Sprintf(L("%s on your route in %.0f min, you'll be under cover", "%s di rute Anda dalam %.0f menit, Anda akan terlindung"), word, in)
		}
		return word + L(" outside, you're under cover", " di luar, Anda terlindung")
	}
	if in >= 1 {
		return fmt.Sprintf(L("%s ahead of you in %.0f min (%.0f mm/h)", "%s di depan Anda dalam %.0f menit (%.0f mm/jam)"), word, in, al.Peak)
	}
	return fmt.Sprintf(L("you are in %s (%.0f mm/h)", "Anda berada dalam %s (%.0f mm/jam)"), word, al.Peak)
}

// liveAdvice is the alert's instruction relative to the current minute.
func liveAdvice(al sim.Alert, now float64) string {
	if al.Covered {
		return L("You will be inside when it rains. «No action needed.»", "Anda akan berada di dalam saat hujan. «Tidak perlu tindakan.»")
	}
	prep := al.PrepAt - now
	left := al.Until - math.Max(now, al.MeetAt)
	switch {
	case now >= al.MeetAt:
		return fmt.Sprintf(L("Raincoat on. About ‹%.0f min› more in the rain.", "Jas hujan dipakai. Sekitar ‹%.0f menit› lagi di bawah hujan."), math.Max(left, 1))
	case prep < 1:
		if al.Kind == model.Moto {
			return L("«Pull over now» and put on your raincoat before continuing.", "«Menepilah sekarang» dan pakai jas hujan sebelum melanjutkan.")
		}
		return L("«Put on your raincoat now», before you step out.", "«Pakai jas hujan sekarang», sebelum Anda keluar.")
	case al.Kind == model.Moto:
		return fmt.Sprintf(L("Pull over in about ‹%.0f min› (▲) and put on your raincoat before continuing.", "Menepilah dalam sekitar ‹%.0f menit› (▲) dan pakai jas hujan sebelum melanjutkan."), prep)
	case al.Kind == model.WaitBRT:
		return fmt.Sprintf(L("Your halte is only partly covered. Raincoat on before the stop, in ‹%.0f min›.", "Halte Anda hanya sebagian beratap. Pakai jas hujan sebelum sampai halte, dalam ‹%.0f menit›."), prep)
	}
	return fmt.Sprintf(L("Put on your raincoat before leaving the stop (▲), in ‹%.0f min›.", "Pakai jas hujan sebelum meninggalkan halte (▲), dalam ‹%.0f menit›."), prep)
}

// drawTimeline draws the trip as a strip: mode on top, rain met below, with
// the clock, alert and raincoat-stop markers.
func (s *alertScreen) drawTimeline(c *Canvas, y, w int) int {
	cur := s.ch[s.route]
	if cur.T <= 0 {
		return y
	}
	c.TextA(0, y, alertRouteNames[s.route], alertRouteCols[s.route], attrBold)
	c.TextR(w, y, fmt.Sprintf("%.0f min · %.2f mm rain", cur.T, cur.Dose), cText)
	y++
	scale := float64(w) / cur.T
	for _, smp := range cur.Timeline {
		x0 := int(smp.T0 * scale)
		x1 := max(x0+1, int(smp.T1*scale))
		if smp.T1 == smp.T0 {
			continue
		}
		for x := x0; x < min(x1, w); x++ {
			c.Put(x, y, '▀', kindColor[smp.Kind])
			if lv := rainLevel(smp.Rain); lv != 0 && smp.Kind.Exposure() > 0 {
				c.SetBG(x, y+1, lv)
			} else if lv != 0 {
				c.Put(x, y+1, '·', cRainDim)
			}
		}
	}
	for _, al := range s.alerts[s.route] {
		if al.Covered {
			continue
		}
		if x := int(al.IssueAt * scale); x < w {
			c.Put(x, y+2, '!', cAmber)
		}
		if x := int(al.PrepAt * scale); x < w {
			c.Put(x, y+2, '▲', cGold)
		}
	}
	if x := int(math.Min(s.clock, cur.T) * scale); x < w {
		c.Put(x, y+2, '●', cWhite)
	}
	c.Text(0, y+3, "▀ mode  ░ rain  ! alert  ▲ coat  ● now", cDim)
	return y + 4
}

func (s *alertScreen) drawNumbers(c *Canvas, w, h int) {
	c.Text(0, 0, "route         mode    time   dose  alerts", cDim)
	for i, ch := range s.ch {
		mode := "transit"
		if ch.Moto {
			mode = "moto"
		}
		n := 0
		for _, al := range s.alerts[i] {
			if !al.Covered {
				n++
			}
		}
		mark := " "
		if i == s.route {
			mark = "›"
		}
		c.Text(0, 1+i, fmt.Sprintf("%s%-12s %-7s %4.0fm %5.2f  %d", mark, alertRouteNames[i], mode, ch.T, ch.Dose, n), alertRouteCols[i])
	}
	y := 5
	y += rich(c, 0, y, w, h-y, "«DP-ahead» uses the same Discomfort Penalty, but looks up the rain at the minute you will «reach» each edge, using the storm's motion. "+
		"Arrival times come from a time-only search, so the router stays a plain Dijkstra.\n\n"+
		fmt.Sprintf("«Alerts» fire ‹%.0f min› ahead (nowcast lead time) for rain ≥ ‹%.0f mm/h› met on an «exposed» edge, and name the last safe point to put on a raincoat.", alertHorizon, sim.AlertThreshold), cText)
	_ = y
}
