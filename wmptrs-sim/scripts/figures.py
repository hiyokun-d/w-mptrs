#!/usr/bin/env python3
"""Publication figures from `wmptrs-sim --export DIR`.

Usage:
    ./run.sh --export out            # writes CSVs (about 10 s)
    python3 scripts/figures.py out   # writes out/fig_*.pdf and .png

Needs only matplotlib (pip install matplotlib). Every number comes from the
CSVs, so figures always match the simulator output for that seed.
"""
import csv
import os
import sys
from collections import defaultdict

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

COL = {"A0": "#7c8eb0", "A1": "#e69f00", "A2": "#cc79a7", "A3": "#0072b2", "A4": "#009e73",
       "DP-now": "#e69f00", "DP-ahead": "#0072b2", "DP-ahead-TD": "#56b4e9", "oracle": "#333333"}
plt.rcParams.update({"font.size": 9, "axes.spines.top": False, "axes.spines.right": False,
                     "figure.dpi": 150, "savefig.bbox": "tight"})


def rows(d, name):
    with open(os.path.join(d, name), newline="") as f:
        return list(csv.DictReader(f))


def num(r, k):
    return float(r[k])


def save(fig, d, name):
    for ext in ("pdf", "png"):
        fig.savefig(os.path.join(d, f"{name}.{ext}"))
    plt.close(fig)
    print("wrote", os.path.join(d, name + ".pdf"))


def fig_phi(d):
    r = rows(d, "phi_curves.csv")
    x = [num(a, "rain_mmh") for a in r]
    fig, ax = plt.subplots(figsize=(3.4, 2.4))
    ax.plot(x, [num(a, "a1_walk_mult") for a in r], color=COL["A1"], label="A1 threshold", drawstyle="steps-post")
    ax.plot(x, [num(a, "a2_walk_mult") for a in r], color=COL["A2"], label="A2 linear")
    ax.plot(x, [num(a, "a3_walk_mult") for a in r], color=COL["A3"], label="A3 DP (sigmoid)", lw=2)
    ax.set_xlabel("forecast rain $\\hat r$ (mm/h)")
    ax.set_ylabel("walk edge cost multiplier")
    ax.legend(frameon=False)
    save(fig, d, "fig_cost_curves")


def fig_variants(d):
    r = [a for a in rows(d, "variants.csv") if a["variant"] != "A0"]
    fig, ax = plt.subplots(figsize=(3.4, 2.4))
    names = [a["variant"] for a in r]
    red = [num(a, "dose_reduction_pct") for a in r]
    err = [[red[i] - num(a, "dose_red_ci_lo") for i, a in enumerate(r)], [num(a, "dose_red_ci_hi") - red[i] for i, a in enumerate(r)]]
    ax.bar(names, red, yerr=err, color=[COL[n] for n in names], capsize=3)
    for i, a in enumerate(r):
        ax.text(i, 1, f"+{num(a, 'time_increase_pct'):.1f}% time", ha="center", va="bottom", fontsize=7, color="white", rotation=90)
    ax.set_ylabel("rain-dose reduction vs A0 (%)\n(bootstrap 95% CI)")
    save(fig, d, "fig_dose_reduction")


def fig_tradeoff(d):
    r = rows(d, "beta_sweep.csv")
    fam = defaultdict(list)
    for a in r:
        fam[a["family"]].append((num(a, "time_increase_pct"), num(a, "dose_reduction_pct"), num(a, "beta_or_alpha_scale")))
    fig, ax = plt.subplots(figsize=(3.4, 2.6))
    for f, pts in fam.items():
        pts.sort(key=lambda p: p[2])
        ax.plot([p[0] for p in pts], [p[1] for p in pts], "o-", ms=3, color=COL[f], label=f)
        if f == "A3":
            for t, dr, b in pts:
                ax.annotate(f"β={b:g}", (t, dr), fontsize=6, xytext=(3, -8), textcoords="offset points")
    ax.set_xlabel("travel-time increase (%)")
    ax.set_ylabel("rain-dose reduction (%)")
    ax.legend(frameon=False)
    save(fig, d, "fig_tradeoff")


def fig_seeds(d):
    r = rows(d, "seeds.csv")
    by = defaultdict(list)
    for a in r:
        if a["variant"] != "A0":
            by[a["variant"]].append(num(a, "dose_reduction_pct"))
    names = sorted(by)
    fig, ax = plt.subplots(figsize=(3.4, 2.4))
    bp = ax.boxplot([by[n] for n in names], patch_artist=True, widths=0.5)
    ax.set_xticks(range(1, len(names) + 1), names)
    for patch, n in zip(bp["boxes"], names):
        patch.set_facecolor(COL[n])
        patch.set_alpha(0.6)
    ax.set_ylabel(f"dose reduction (%), {len(by[names[0]])} seeds")
    save(fig, d, "fig_seeds")


def fig_sensitivity(d):
    r = rows(d, "sensitivity.csv")
    params = []
    for a in r:
        if a["param"] not in params:
            params.append(a["param"])
    fig, axes = plt.subplots(1, len(params), figsize=(7, 2.2), sharey=True)
    for ax, p in zip(axes, params):
        for v in ("A1", "A2", "A3", "A4"):
            pts = sorted((num(a, "value"), num(a, "dose_reduction_pct")) for a in r if a["param"] == p and a["variant"] == v)
            ax.plot([x for x, _ in pts], [y for _, y in pts], "o-", ms=3, color=COL[v], label=v)
        default = [num(a, "value") for a in r if a["param"] == p and a["is_default"] == "true"]
        if default:
            ax.axvline(default[0], color="#bbb", lw=0.8, ls="--")
        ax.set_xlabel(p.replace("_", " "))
    axes[0].set_ylabel("dose reduction (%)")
    axes[-1].legend(frameon=False, fontsize=7)
    save(fig, d, "fig_sensitivity")


def fig_moving(d):
    r = rows(d, "moving_motion_error.csv")
    x = [num(a, "motion_error_kmpmin") * 60 for a in r]
    fig, (ax, bx) = plt.subplots(1, 2, figsize=(7, 2.4))
    ax.plot(x, [num(a, "dp_now_red_pct") for a in r], "o-", color=COL["DP-now"], label="DP-now (snapshot)")
    ax.plot(x, [num(a, "dp_ahead_red_pct") for a in r], "o-", color=COL["DP-ahead"], label="DP-ahead")
    ax.plot(x, [num(a, "oracle_red_pct") for a in r], "--", color=COL["oracle"], label="oracle (true motion)")
    ax.set_xlabel("storm-velocity forecast error (km/h, SD)")
    ax.set_ylabel("dose reduction vs A0 (%)")
    ax.legend(frameon=False, fontsize=7)
    bx.plot(x, [num(a, "ahead_pod") for a in r], "o-", color="#009e73", label="POD")
    bx.plot(x, [num(a, "ahead_far") for a in r], "o-", color="#d55e00", label="FAR")
    bx.set_ylim(0, 1.05)
    bx.set_xlabel("storm-velocity forecast error (km/h, SD)")
    bx.set_ylabel("raincoat-alert score")
    bx.legend(frameon=False, fontsize=7)
    save(fig, d, "fig_moving_storms")


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else "out"
    for f in (fig_phi, fig_variants, fig_tradeoff, fig_seeds, fig_sensitivity, fig_moving):
        f(d)


if __name__ == "__main__":
    main()
