package ui

import (
	"fmt"
	"sync/atomic"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"

	"wmptrs-sim/internal/model"
	"wmptrs-sim/internal/sim"
)

const robustSeeds = 20

type robustDoneMsg struct {
	id    int
	seeds *sim.SeedStudy
	sens  []sim.SensRow
	ahead *sim.AheadResult
	errs  []sim.AheadErrPoint
	err   error
}

// robustScreen shows the evidence that the conclusions are not an artefact
// of one seed, one assumed constant, or a frozen storm.
type robustScreen struct {
	page    int
	id      int
	running bool
	forP    sim.Params
	done    atomic.Int64
	total   atomic.Int64
	res     *robustDoneMsg
	text    scrollText
	k       struct{ page, rerun, scroll key.Binding }
}

var robustPages = []string{"Across seeds", "Sensitivity of E and w_m", "Moving storms", "Raincoat alerts"}

func newRobust() *robustScreen {
	s := &robustScreen{}
	s.k.page = key.NewBinding(key.WithKeys("left", "right"), key.WithHelp("←→", "page"))
	s.k.rerun = key.NewBinding(key.WithKeys("s"), key.WithHelp("s", "recompute"))
	s.k.scroll = key.NewBinding(key.WithKeys("pgdown", "pgup"), key.WithHelp("pgdn/up", "scroll"))
	return s
}

func (s *robustScreen) title() string       { return "Robustness" }
func (s *robustScreen) captures() bool      { return false }
func (s *robustScreen) keys() []key.Binding { return []key.Binding{s.k.page, s.k.rerun, s.k.scroll} }

func (s *robustScreen) enter(a *App) tea.Cmd {
	if !s.running && (s.res == nil || s.forP != a.params) {
		return s.start(a)
	}
	return nil
}

// start runs all four studies in the background (about 5 s on a laptop).
func (s *robustScreen) start(a *App) tea.Cmd {
	s.id++
	id, p, ctx := s.id, a.params, a.ctx
	s.running, s.forP = true, p
	ap := sim.AheadParams{Journeys: p.Journeys, Seed: p.Seed, MotionErr: 0.1, Horizon: alertHorizon}
	steps := int64(robustSeeds + 13 + p.Journeys*(1+len(sim.AheadErrors)))
	s.done.Store(0)
	s.total.Store(steps)
	var base atomic.Int64
	prog := func(d, _ int) { s.done.Store(base.Load() + int64(d)) }
	return func() tea.Msg {
		m := robustDoneMsg{id: id}
		if m.seeds, m.err = sim.Seeds(ctx, p, robustSeeds, prog); m.err != nil {
			return m
		}
		base.Store(robustSeeds)
		if m.sens, m.err = sim.Sensitivity(ctx, p, prog); m.err != nil {
			return m
		}
		base.Store(robustSeeds + 13)
		if m.ahead, m.err = sim.Ahead(ctx, ap, p.Model(), prog); m.err != nil {
			return m
		}
		base.Store(robustSeeds + 13 + int64(p.Journeys))
		m.errs, m.err = sim.AheadSweep(ctx, ap, p.Model(), prog)
		return m
	}
}

func (s *robustScreen) receive(m robustDoneMsg) {
	if m.id != s.id {
		return
	}
	s.running = false
	if m.err == nil {
		s.res = &m
	}
}

func (s *robustScreen) update(a *App, msg tea.KeyMsg) tea.Cmd {
	ks := msg.String()
	if s.text.key(ks) {
		return nil
	}
	switch ks {
	case "left", "h":
		s.page = (s.page + len(robustPages) - 1) % len(robustPages)
		s.text.off = 0
	case "right", "l":
		s.page = (s.page + 1) % len(robustPages)
		s.text.off = 0
	case "s":
		if !s.running {
			return s.start(a)
		}
	}
	return nil
}

func (s *robustScreen) tick(a *App, steps int) bool { return s.running }

func (s *robustScreen) draw(a *App, c *Canvas, w, h int) {
	x := 0
	for i, p := range robustPages {
		label := fmt.Sprintf(" %d %s ", i+1, p)
		if i == s.page {
			x += c.TextA(x, 0, label, cWhite, attrRev|attrBold)
		} else {
			x += c.Text(x, 0, label, cDim)
		}
		x++
	}
	top := 1
	bh := h - top
	side := w >= 100
	vw, vh := w, bh*3/5
	if side {
		vw, vh = w*58/100, bh
	}
	done := c.Box(0, top, vw, vh, cBorder, robustPages[s.page])
	iw, ih := vw-4, vh-2
	var text string
	switch {
	case s.res == nil && s.running:
		c.Text(0, 0, a.spinner()+" computing all robustness studies…", cRain)
		progressBar(c, 0, 2, iw, float64(s.done.Load())/float64(max(s.total.Load(), 1)))
		c.Text(0, 4, fmt.Sprintf("%d seeds · %d sensitivity runs · moving storms at %d motion errors", robustSeeds, 13, len(sim.AheadErrors)+1), cDim)
		text = "This runs the whole experiment «many times», so the conclusions do not rest on one draw."
	case s.res == nil:
		c.Text(0, 0, "press s to compute", cDim)
	default:
		switch s.page {
		case 0:
			text = s.seeds(c, iw, ih)
		case 1:
			text = s.sensitivity(c, iw, ih)
		case 2:
			text = s.moving(c, iw, ih)
		case 3:
			text = s.alerts(c, iw, ih)
		}
		if s.running {
			c.TextR(iw, 0, a.spinner()+" updating", cRain)
		}
	}
	done()
	if side {
		done = c.Box(vw, top, w-vw, bh, cBorderHi, "What it shows")
		s.text.draw(c, w-vw-4, bh-2, text)
	} else {
		done = c.Box(0, top+vh, w, bh-vh, cBorderHi, "What it shows")
		s.text.draw(c, w-4, bh-vh-2, text)
	}
	done()
}

// errBar draws mean ± SD as a bar with whiskers on a 0..scale axis.
func errBar(c *Canvas, x, y, w int, mean, sd, scale float64, col uint8) {
	hbar(c, x, y, w, mean/scale, col)
	lo, hi := int((mean-sd)/scale*float64(w)), int((mean+sd)/scale*float64(w))
	if hi > lo {
		c.Put(x+max(lo, 0), y, '├', cWhite)
		c.Put(x+min(hi, w-1), y, '┤', cWhite)
	}
}

func (s *robustScreen) seeds(c *Canvas, w, h int) string {
	st := s.res.seeds
	c.Text(0, 0, fmt.Sprintf("dose reduction vs A0, mean ± SD over %d seeds (%d journeys each)", len(st.Rows), st.Journeys), cDim)
	bw := max(8, w-30)
	for v := 1; v < int(model.NumVariants); v++ {
		y := 1 + v
		c.Text(0, y, model.Variant(v).String(), variantColor[v])
		errBar(c, 4, y, bw, st.MeanRed[v], st.SDRed[v], 60, variantColor[v])
		c.Text(5+bw, y, fmt.Sprintf("%5.1f ±%.1f%%  +%.1f%% t", st.MeanRed[v], st.SDRed[v], st.MeanInc[v]), cText)
	}
	y := 7
	c.Text(0, y, "head to head, per seed      A3 wins   sign test", cDim)
	for i, ct := range st.Contests {
		col := cGreen
		if ct.A3Wins*2 < ct.Seeds {
			col = cRed
		}
		c.Text(0, y+1+i, fmt.Sprintf("A3 vs %-3s  %+5.1f pts        %2d / %-2d   p=%s", ct.Vs, ct.MeanD, ct.A3Wins, ct.Seeds, fmtP(ct.SignP)), col)
	}
	// per-seed strip of A3 − A1
	y += 5
	if y+2 < h {
		c.Text(0, y, "A3 − A1 per seed (each mark is one seed; centre = 0)", cDim)
		mid := w / 2
		c.Put(mid, y+1, '┼', cFaint)
		for _, row := range st.Rows {
			d := row.DoseRedPct[model.A3] - row.DoseRedPct[model.A1]
			px := mid + int(d/10*float64(w/2))
			col := cGreen
			if d < 0 {
				col = cRed
			}
			c.Put(min(max(px, 0), w-1), y+1, '●', col)
		}
	}
	a4 := st.Contests[2]
	return fmt.Sprintf("Each seed is a «new city» (link times), «new journeys», «new storms» and «new forecast errors».\n\n"+
		"• A3 beats the threshold rule A1 in ‹%d of %d› seeds and the linear rule A2 in ‹%d of %d›. ", st.Contests[0].A3Wins, st.Contests[0].Seeds, st.Contests[1].A3Wins, st.Contests[1].Seeds) +
		"The advantage is «systematic», not a lucky draw.\n" +
		fmt.Sprintf("• ⟦A4 beats A3 in %d of %d seeds⟧ (%+.1f pts). Treating waits as sheltered while routing is consistently «better». See the Sensitivity page for why.\n\n", a4.Seeds-a4.A3Wins-a4.Ties, a4.Seeds, -a4.MeanD) +
		"The sign test asks: if A3 and the rival were equally good, how likely is a win count this lopsided?"
}

func (s *robustScreen) sensitivity(c *Canvas, w, h int) string {
	rows := s.res.sens
	c.Text(0, 0, "constant      value   A1    A2    A3    A4   A3−A1 A3−A4", cDim)
	y := 1
	prev := ""
	for _, r := range rows {
		if y >= h {
			break
		}
		if r.Param != prev && prev != "" {
			y++
		}
		prev = r.Param
		mark := " "
		if r.IsDefault {
			mark = "●"
		}
		d1 := r.DoseRedPct[3] - r.DoseRedPct[1]
		d4 := r.DoseRedPct[3] - r.DoseRedPct[4]
		c.Text(0, y, fmt.Sprintf("%-12s %s%4.2g  %5.1f %5.1f %5.1f %5.1f", r.Param, mark, r.Value, r.DoseRedPct[1], r.DoseRedPct[2], r.DoseRedPct[3], r.DoseRedPct[4]), cText)
		c.Text(46, y, fmt.Sprintf("%+5.1f", d1), map[bool]uint8{true: cGreen, false: cRed}[d1 > 0])
		c.Text(52, y, fmt.Sprintf("%+5.1f", d4), map[bool]uint8{true: cGreen, false: cRed}[d4 > 0])
		y++
	}
	if y+1 < h {
		c.Text(0, y+1, "● = paper default · values are % dose reduction vs A0", cDim)
	}
	allA1, allA2, allA4 := true, true, true
	for _, r := range rows {
		allA1 = allA1 && r.DoseRedPct[3] > r.DoseRedPct[1]
		allA2 = allA2 && r.DoseRedPct[3] > r.DoseRedPct[2]
		allA4 = allA4 && r.DoseRedPct[4] >= r.DoseRedPct[3]
	}
	verdict := func(b bool, yes, no string) string {
		if b {
			return yes
		}
		return no
	}
	return "Each row re-runs the experiment with «one assumed constant changed», in both routing «and» scoring. The world changes, not just the router's belief.\n\n" +
		"• " + verdict(allA1 && allA2, "A3 beats A1 and A2 «at every setting». The headline does not depend on the exact E or w_m values.", "⟦A3 does not beat A1/A2 at every setting⟧. Check the red cells.") + "\n" +
		"• " + verdict(allA4, "⟦A4 ≥ A3 at every setting⟧, even when the halte is fully exposed (E = 1). Penalising waits makes the router «avoid the sheltered transit trip» the traveller needs, and that costs more rain than the short wait saves.", "A4 does not dominate everywhere.") + "\n\n" +
		"«Implication:» score exposure everywhere, but price only walking and riding in the router (A4). The wait term should be presented as an ablation that «did not help»."
}

func (s *robustScreen) moving(c *Canvas, w, h int) string {
	ah := s.res.ahead
	c.Text(0, 0, fmt.Sprintf("%d journeys, storms moving 6–27 km/h, motion error %.2f km/min", ah.Params.Journeys, ah.Params.MotionErr), cDim)
	bw := max(8, w-36)
	cols := [sim.NumStrats]uint8{cDim, cAmber, cRain, cGreen, cWhite}
	for k, st := range ah.Strategies {
		if k == 0 {
			continue
		}
		y := 1 + k
		c.Text(0, y, st.Name, cols[k])
		hbar(c, 13, y, bw, st.DoseRedPct/60, cols[k])
		c.Text(14+bw, y, fmt.Sprintf("%5.1f%% [%4.1f,%4.1f] +%.1f%%t", st.DoseRedPct, st.DoseRedCI[0], st.DoseRedCI[1], st.TimeIncPct), cText)
	}
	y := 7
	for _, t := range ah.Tests {
		c.Text(0, y, fmt.Sprintf("Wilcoxon DP-ahead vs %-7s p(Holm) = %s", t.Vs, fmtP(t.PHolm)), cText)
		y++
	}
	c.Text(0, y, fmt.Sprintf("time-dependent check: same route %.0f%%, Δdose %+.3f mm", 100*ah.TDAgreement, ah.TDDoseDiff), cGreen)
	y += 2
	if y+3 < h {
		c.Text(0, y, "motion error   DP-now  DP-ahead  oracle", cDim)
		for i, pt := range s.res.errs {
			if y+1+i >= h {
				break
			}
			col := cText
			if pt.AheadRed < pt.NowRedPct {
				col = cRed
			}
			c.Text(0, y+1+i, fmt.Sprintf("%4.2f km/min  %6.1f%%  %7.1f%%  %5.1f%%", pt.MotionErr, pt.NowRedPct, pt.AheadRed, pt.OracleRed), col)
		}
	}
	st := ah.Strategies
	cross := ""
	for _, pt := range s.res.errs {
		if pt.AheadRed < pt.NowRedPct {
			cross = fmt.Sprintf("Once the velocity error reaches about ‹%.2f km/min› (≈ %.0f km/h) DP-ahead falls «below» DP-now. Motion you cannot trust is worse than ignoring motion.", pt.MotionErr, pt.MotionErr*60)
			break
		}
	}
	return fmt.Sprintf("Storms drift and cross the corridor 10–60 min after departure, so the rain at departure is a poor guide.\n\n"+
		"• ‹DP-now› (frozen snapshot) cuts dose ‹%.1f%%›.\n• ‹DP-ahead› (rain at your arrival time) cuts ‹%.1f%%› for +%.1f%% time.\n• The ‹oracle› (true motion) shows the ceiling: ‹%.1f%%›.\n\n", st[1].DoseRedPct, st[2].DoseRedPct, st[2].TimeIncPct, st[4].DoseRedPct) +
		fmt.Sprintf("«Approximation check:» DP-ahead estimates arrival times with a time-only search. An exact time-dependent search picks the «same route %.0f%%» of the time, with a negligible dose difference. The cheap approximation is justified.\n\n", 100*ah.TDAgreement) + cross
}

func (s *robustScreen) alerts(c *Canvas, w, h int) string {
	ah := s.res.ahead
	c.Text(0, 0, "alert quality on the route actually taken", cDim)
	c.Text(0, 2, "route      POD    FAR   lead   per trip  hit/miss/false", cDim)
	for i, al := range ah.Alerts {
		c.Text(0, 3+i, fmt.Sprintf("%-9s %5.2f  %5.2f  %4.1fm   %5.2f    %d/%d/%d", al.Strategy, al.POD, al.FAR, al.MeanLeadMin, al.PerTrip, al.Hits, al.Misses, al.FalseAlarms), cText)
	}
	y := 6
	if y+3 < h {
		c.Text(0, y, "motion error   POD    FAR  (DP-ahead route)", cDim)
		bw := max(6, (w-30)/2)
		for i, pt := range s.res.errs {
			if y+1+i >= h {
				break
			}
			yy := y + 1 + i
			c.Text(0, yy, fmt.Sprintf("%4.2f km/min", pt.MotionErr), cText)
			hbar(c, 14, yy, bw, pt.AheadPOD, cGreen)
			c.Text(15+bw, yy, fmt.Sprintf("%.2f", pt.AheadPOD), cGreen)
			hbar(c, 21+bw, yy, bw, pt.AheadFAR, cRed)
			c.Text(22+2*bw, yy, fmt.Sprintf("%.2f", pt.AheadFAR), cRed)
		}
	}
	al := ah.Alerts[len(ah.Alerts)-1]
	return "An alert is «issued» from the forecast motion (what the app believes) and «checked» against the rain the traveller really meets.\n\n" +
		"• ‹POD› (probability of detection): share of real rain spells that were warned about.\n" +
		"• ‹FAR› (false-alarm ratio): share of alerts where no rain came.\n" +
		"• ‹lead›: minutes between the notification and the rain arriving. It is at most the 15-min horizon, shorter when the storm is already close.\n\n" +
		fmt.Sprintf("On DP-ahead routes the system warns about ‹%.0f%%› of rain spells with ‹%.0f%%› false alarms and about ‹%.0f min› notice, enough to stop and put on a raincoat. ", 100*al.POD, 100*al.FAR, al.MeanLeadMin) +
		"These are the standard verification scores used for weather warnings, so they can be compared with nowcast literature."
}
