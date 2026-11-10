package ui

import (
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
)

// Palette indices used by canvas cells.
const (
	cBG uint8 = iota
	cCity
	cPanel
	cBorder
	cBorderHi
	cText
	cDim
	cFaint
	cRain
	cRainDim
	cAmber
	cGreen
	cMagenta
	cGold
	cGoldDim
	cRed
	cWhite
	cR1
	cR2
	cR3
	cR4
	cR5
	cR6
	numColors
)

var palette = [numColors]lipgloss.Color{
	cBG:       "#0a1428",
	cCity:     "#0b1830",
	cPanel:    "#0e1b35",
	cBorder:   "#2a3f66",
	cBorderHi: "#4f86c6",
	cText:     "#d6e2f5",
	cDim:      "#7c8eb0",
	cFaint:    "#34476b",
	cRain:     "#5fd7ff",
	cRainDim:  "#1f4f70",
	cAmber:    "#ffb000",
	cGreen:    "#5fd787",
	cMagenta:  "#ff6ad5",
	cGold:     "#ffd75f",
	cGoldDim:  "#6b5a2a",
	cRed:      "#ff6b6b",
	cWhite:    "#ffffff",
	cR1:       "#112a52",
	cR2:       "#143d6e",
	cR3:       "#18548c",
	cR4:       "#1e6fa8",
	cR5:       "#2b8fc4",
	cR6:       "#4fb3dc",
}

// variantColor colours A0..A4 consistently across screens.
var variantColor = [...]uint8{cDim, cAmber, cMagenta, cRain, cGreen}

type theme struct {
	mono   bool
	fg, bg [numColors]string
}

// newTheme detects the colour profile from the environment only (no
// terminal queries, so startup never blocks); NO_COLOR yields monochrome.
func newTheme() *theme {
	t := &theme{}
	prof := termenv.EnvColorProfile()
	if prof == termenv.Ascii {
		t.mono = true
		return t
	}
	for i, hex := range palette {
		c := prof.Color(string(hex))
		if c == nil {
			continue
		}
		if seq := c.Sequence(false); seq != "" {
			t.fg[i] = "\x1b[" + seq + "m"
		}
		if seq := c.Sequence(true); seq != "" {
			t.bg[i] = "\x1b[" + seq + "m"
		}
	}
	return t
}

// rainLevel maps mm/h to a background ramp colour (0 = dry).
func rainLevel(r float64) uint8 {
	switch {
	case r < 1:
		return 0
	case r < 3:
		return cR1
	case r < 5:
		return cR2
	case r < 10:
		return cR3
	case r < 20:
		return cR4
	case r < 30:
		return cR5
	}
	return cR6
}
