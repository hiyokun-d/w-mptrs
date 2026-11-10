// Package ui is the Bubble Tea front end of the simulator.
package ui

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"

	"wmptrs-sim/internal/sim"
)

const honesty = "Interactive model demo — results vary by seed; not the original paper run."

const (
	minW = 80
	minH = 24

	fastTick = time.Second / 60
	idleTick = time.Second / 12
)

// screen is one tab of the app. Screens draw into a w x h content area.
type screen interface {
	title() string
	enter(a *App) tea.Cmd
	update(a *App, msg tea.KeyMsg) tea.Cmd
	tick(a *App, steps int) bool // reports whether still animating
	draw(a *App, c *Canvas, w, h int)
	keys() []key.Binding
	captures() bool // true while the screen wants every key (text editing)
}

type tickMsg time.Time

type progressMsg struct {
	id int
	ps []sim.Progress
	ok bool
	ch <-chan sim.Progress
}

type sweepDoneMsg struct {
	id  int
	pts []sim.SweepPoint
	err error
}

type benchDoneMsg struct {
	id  int
	res *sim.BenchResult
	err error
}

var globalKeys = struct {
	next, prev, help, quit, run key.Binding
}{
	next: key.NewBinding(key.WithKeys("tab"), key.WithHelp("tab", "next")),
	prev: key.NewBinding(key.WithKeys("shift+tab"), key.WithHelp("⇧tab", "prev")),
	help: key.NewBinding(key.WithKeys("?"), key.WithHelp("?", "help")),
	quit: key.NewBinding(key.WithKeys("q", "ctrl+c"), key.WithHelp("q", "quit")),
	run:  key.NewBinding(key.WithKeys("r"), key.WithHelp("r", "run")),
}

// App is the root Bubble Tea model and the state shared by all screens.
type App struct {
	w, h   int
	th     *theme
	canvas Canvas
	ctx    context.Context
	stop   context.CancelFunc

	params sim.Params
	net    *sim.Network

	screens   []screen
	cur, prev int
	trans     Spring
	transDir  int
	tabX      Spring
	tabW      Spring
	tabPos    []int
	help      bool

	t        float64
	last     time.Time
	steps    int
	bg       *rainField
	spinIdx  int
	spinTime float64

	// main run
	running   bool
	runID     int
	runCancel context.CancelFunc
	runStart  time.Time
	runDone   int
	runTotal  int
	arrived   []*sim.Journey
	result    *sim.Result
	resultVer int
	runErr    error

	// sweep and bench
	sweep        []sim.SweepPoint
	sweepFor     sim.Params
	sweepID      int
	sweepRunning bool
	sweepVer     int
	sweepDone    atomic.Int64
	sweepTotal   atomic.Int64
	bench        *sim.BenchResult
	benchFor     sim.Params
	benchID      int
	benchRunning bool
	benchVer     int
	errMsg       string
}

// Run starts the TUI.
func Run(p sim.Params) error {
	a := newApp(p)
	_, err := tea.NewProgram(a, tea.WithAltScreen()).Run()
	a.stop()
	return err
}

func newApp(p sim.Params) *App {
	ctx, stop := context.WithCancel(context.Background())
	a := &App{
		th:     newTheme(),
		ctx:    ctx,
		stop:   stop,
		params: p,
		net:    sim.NewNetwork(p.Seed),
		trans:  newSpring(7, 0.8),
		tabX:   newSpring(9, 0.7),
		tabW:   newSpring(9, 0.7),
		bg:     newRainField(0.012, 6, 8, 7),
		last:   time.Now(),
	}
	a.trans.Jump(1)
	a.screens = []screen{
		newSplash(), newParams(), newRunScreen(), newResults(), newTradeoff(), newPhi(), newBenchScreen(),
	}
	return a
}

func tick(d time.Duration) tea.Cmd {
	return tea.Tick(d, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func (a *App) Init() tea.Cmd {
	return tea.Batch(tick(fastTick), tea.SetWindowTitle("wmptrs-sim"), a.screens[0].enter(a))
}

func (a *App) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		a.w, a.h = msg.Width, msg.Height
		return a, nil

	case tickMsg:
		now := time.Time(msg)
		dt := now.Sub(a.last).Seconds()
		a.last = now
		dt = min(max(dt, 0), 0.1)
		a.t += dt
		a.steps = min(max(int(dt*60+0.5), 1), 6)
		animating := a.advance(dt)
		if animating {
			return a, tick(fastTick)
		}
		return a, tick(idleTick)

	case tea.KeyMsg:
		return a, a.handleKey(msg)

	case progressMsg:
		if msg.id != a.runID {
			return a, nil
		}
		for _, p := range msg.ps {
			a.runDone, a.runTotal = p.Done, p.Total
			if p.Journey != nil {
				a.arrived = append(a.arrived, p.Journey)
			}
			if p.Result != nil {
				a.result = p.Result
				a.resultVer++
			}
		}
		if !msg.ok {
			a.running = false
			return a, nil
		}
		return a, waitProgress(msg.id, msg.ch)

	case sweepDoneMsg:
		if msg.id == a.sweepID {
			a.sweepRunning = false
			if msg.err == nil {
				a.sweep = msg.pts
				a.sweepVer++
			}
		}
		return a, nil

	case benchDoneMsg:
		if msg.id == a.benchID {
			a.benchRunning = false
			if msg.err == nil {
				a.bench = msg.res
				a.benchVer++
			}
		}
		return a, nil
	}
	return a, nil
}

func (a *App) handleKey(msg tea.KeyMsg) tea.Cmd {
	if msg.String() == "ctrl+c" {
		return tea.Quit
	}
	if a.help {
		switch msg.String() {
		case "?", "esc", "q", "enter":
			a.help = false
		}
		return nil
	}
	s := a.screens[a.cur]
	if s.captures() {
		return s.update(a, msg)
	}
	switch {
	case key.Matches(msg, globalKeys.quit):
		return tea.Quit
	case key.Matches(msg, globalKeys.help):
		a.help = true
		return nil
	case key.Matches(msg, globalKeys.next):
		return a.switchTo((a.cur+1)%len(a.screens), 1)
	case key.Matches(msg, globalKeys.prev):
		return a.switchTo((a.cur+len(a.screens)-1)%len(a.screens), -1)
	case key.Matches(msg, globalKeys.run) && a.cur != 0:
		return a.startRunAndShow()
	}
	return s.update(a, msg)
}

// switchTo starts a spring slide from the current screen to screen i.
func (a *App) switchTo(i, dir int) tea.Cmd {
	if i == a.cur {
		return nil
	}
	a.prev, a.cur, a.transDir = a.cur, i, dir
	a.trans.Pos, a.trans.Vel, a.trans.Target = 0, 0, 1
	return a.screens[i].enter(a)
}

// startRunAndShow launches a run and slides to the live-run screen.
func (a *App) startRunAndShow() tea.Cmd {
	cmd := a.startRun()
	if a.cur != 2 {
		return tea.Batch(cmd, a.switchTo(2, sign(2-a.cur)))
	}
	return cmd
}

func sign(x int) int {
	if x < 0 {
		return -1
	}
	return 1
}

func (a *App) startRun() tea.Cmd {
	if a.runCancel != nil {
		a.runCancel()
	}
	a.runID++
	ctx, cancel := context.WithCancel(a.ctx)
	a.runCancel = cancel
	p := a.params
	if a.net == nil || a.result == nil || a.result.Params.Seed != p.Seed {
		a.net = sim.NewNetwork(p.Seed)
	}
	a.running, a.runStart, a.runDone, a.runTotal = true, time.Now(), 0, p.Journeys
	a.arrived = a.arrived[:0]
	a.result = nil
	a.resultVer++
	ch := make(chan sim.Progress, 512)
	go func() { _, _ = sim.Run(ctx, p, ch) }()
	return waitProgress(a.runID, ch)
}

// waitProgress blocks for one progress message, then drains whatever else is
// queued so the UI redraws once per batch rather than once per journey.
func waitProgress(id int, ch <-chan sim.Progress) tea.Cmd {
	return func() tea.Msg {
		p, ok := <-ch
		if !ok {
			return progressMsg{id: id, ok: false, ch: ch}
		}
		ps := []sim.Progress{p}
		for len(ps) < 256 {
			select {
			case q, ok := <-ch:
				if !ok {
					return progressMsg{id: id, ps: ps, ok: false, ch: ch}
				}
				ps = append(ps, q)
			default:
				return progressMsg{id: id, ps: ps, ok: true, ch: ch}
			}
		}
		return progressMsg{id: id, ps: ps, ok: true, ch: ch}
	}
}

func (a *App) startSweep() tea.Cmd {
	a.sweepID++
	id, p, ctx := a.sweepID, a.params, a.ctx
	a.sweepFor, a.sweepRunning = p, true
	a.sweepDone.Store(0)
	a.sweepTotal.Store(int64(p.Journeys))
	return func() tea.Msg {
		pts, err := sim.Sweep(ctx, p, func(d, t int) {
			a.sweepDone.Store(int64(d))
			a.sweepTotal.Store(int64(t))
		})
		return sweepDoneMsg{id, pts, err}
	}
}

func (a *App) startBench() tea.Cmd {
	a.benchID++
	id, p, ctx := a.benchID, a.params, a.ctx
	a.benchFor, a.benchRunning = p, true
	return func() tea.Msg {
		res, err := sim.Bench(ctx, p, min(p.Journeys, 200), 3)
		return benchDoneMsg{id, res, err}
	}
}

// advance steps all animation state; returns whether anything is moving.
func (a *App) advance(dt float64) bool {
	moving := a.trans.Step(a.steps)
	a.bg.step(dt)
	a.spinTime += dt
	if a.spinTime > 0.08 {
		a.spinTime = 0
		a.spinIdx++
	}
	if len(a.tabPos) > 0 {
		a.tabX.Target = float64(a.tabPos[2*a.cur])
		a.tabW.Target = float64(a.tabPos[2*a.cur+1])
		moving = a.tabX.Step(a.steps) || moving
		moving = a.tabW.Step(a.steps) || moving
	}
	moving = a.screens[a.cur].tick(a, a.steps) || moving
	if a.trans.Pos < 1 || a.trans.Vel != 0 {
		a.screens[a.prev].tick(a, a.steps)
	}
	return moving || a.running || a.sweepRunning || a.benchRunning
}

func (a *App) spinner() string {
	f := spinner.Dot.Frames
	return f[a.spinIdx%len(f)]
}

// hl is the attribute for highlighted items: bold in colour, reverse in mono.
func (a *App) hl() attr {
	if a.th.mono {
		return attrRev
	}
	return attrBold
}

func (a *App) View() string {
	if a.w == 0 || a.h == 0 {
		return ""
	}
	c := &a.canvas
	c.Reset(a.w, a.h)
	if a.w < minW || a.h < minH {
		msg := fmt.Sprintf("Terminal too small: need %dx%d, have %dx%d", minW, minH, a.w, a.h)
		c.TextC(0, a.h/2-1, a.w, msg, cAmber, attrBold)
		c.TextC(0, a.h/2+1, a.w, "resize the window, or press q to quit", cDim, 0)
		return c.Render(a.th)
	}
	ch := a.h - 4
	restore := c.Sub(0, 2, a.w, ch)
	if a.trans.Pos < 0.999 || a.trans.Vel != 0 {
		off := int((1 - a.trans.Pos) * float64(a.w) * float64(a.transDir))
		r := c.Sub(off-a.transDir*a.w, 0, a.w, ch)
		a.screens[a.prev].draw(a, c, a.w, ch)
		r()
		r = c.Sub(off, 0, a.w, ch)
		a.screens[a.cur].draw(a, c, a.w, ch)
		r()
	} else {
		a.screens[a.cur].draw(a, c, a.w, ch)
	}
	a.bg.resize(a.w, ch)
	a.bg.drawBG(c)
	restore()
	a.drawHeader(c)
	a.drawKeybar(c)
	c.TextC(0, a.h-1, a.w, honesty, cAmber, 0)
	if a.help {
		a.drawHelp(c)
	}
	return c.Render(a.th)
}

func (a *App) drawHeader(c *Canvas) {
	x := 1
	x += c.TextA(x, 0, "W-MPTRS", cRain, attrBold)
	x += c.Text(x, 0, "·sim", cDim)
	x += 3
	first := len(a.tabPos) == 0
	a.tabPos = a.tabPos[:0]
	for i, s := range a.screens {
		name := s.title()
		w := utf8.RuneCountInString(name)
		a.tabPos = append(a.tabPos, x, w)
		if i == a.cur {
			c.TextA(x, 0, name, cWhite, a.hl())
		} else {
			c.Text(x, 0, name, cDim)
		}
		x += w + 2
	}
	if first {
		a.tabX.Jump(float64(a.tabPos[2*a.cur]))
		a.tabW.Jump(float64(a.tabPos[2*a.cur+1]))
	}
	ux, uw := int(a.tabX.Pos+0.5), int(a.tabW.Pos+0.5)
	for i := 0; i < uw; i++ {
		c.Put(ux+i, 1, '▔', cRain)
	}
	status := fmt.Sprintf("seed %d · β %.2f", a.params.Seed, a.params.Beta)
	switch {
	case a.running:
		status = fmt.Sprintf("%s running %d/%d", a.spinner(), a.runDone, a.runTotal)
	case a.sweepRunning:
		status = a.spinner() + " sweeping β"
	case a.benchRunning:
		status = a.spinner() + " benchmarking"
	}
	if a.w-x > utf8.RuneCountInString(status)+1 {
		c.TextR(a.w-1, 0, status, cDim)
	}
}

func (a *App) drawKeybar(c *Canvas) {
	y := a.h - 2
	x := 1
	all := append([]key.Binding{}, a.screens[a.cur].keys()...)
	all = append(all, globalKeys.next, globalKeys.prev, globalKeys.run, globalKeys.help, globalKeys.quit)
	for _, b := range all {
		h := b.Help()
		need := utf8.RuneCountInString(h.Key) + utf8.RuneCountInString(h.Desc) + 3
		if x+need > a.w-1 {
			break
		}
		x += c.TextA(x, y, h.Key, cRain, attrBold)
		x += 1
		x += c.Text(x, y, h.Desc, cDim)
		x += 2
	}
}

func (a *App) drawHelp(c *Canvas) {
	lines := []string{
		"Screens: tab / shift+tab switch screens, r runs with current params.",
		"",
		"This screen:",
	}
	for _, b := range a.screens[a.cur].keys() {
		lines = append(lines, fmt.Sprintf("  %-10s %s", b.Help().Key, b.Help().Desc))
	}
	lines = append(lines,
		"",
		"Model:  c = τ · w_m · (1 + β · E · φ(r)),  r = forecast rain (mm/h)",
		"  φ(r) = (σ(r) − σ(0)) / (1 − σ(0)),  σ(r) = 1 / (1 + e^(−k(r − r0)))",
		"  w_m 1.0 riding, 1.5 walk/wait.  E: walk/moto 1, BRT wait 0.4,",
		"  rail wait 0.1, in-vehicle 0.",
		"  A0 time · A1 threshold · A2 linear · A3 DP · A4 DP, wait enclosed",
		"Routes are chosen on the forecast; outcomes scored on the true rain.",
		"",
		"esc or ? closes this help.",
	)
	w, h := min(74, a.w-4), min(len(lines)+2, a.h-2)
	x, y := (a.w-w)/2, (a.h-h)/2
	done := c.Box(x, y, w, h, cBorderHi, "Help")
	for i, l := range lines {
		col := cText
		if strings.HasPrefix(l, "Model") || strings.HasSuffix(l, ":") {
			col = cRain
		}
		c.Text(0, i, l, col)
	}
	done()
}
