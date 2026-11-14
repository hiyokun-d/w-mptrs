# Claims and sources

Every external fact that the simulator, TUI or paper relies on, with its source and
how well it is verified. Checked 2026-11-14. **Open each source and quote the exact
page or table before submission.** These are pointers, not finished citations.

| # | Claim (where it is used) | Status | Source |
|---|---|---|---|
| 1 | BMKG hourly rain categories: light 1–5, moderate 5–10, heavy 10–20, very heavy > 20 mm/h (Guide "r vs r_f", Symbols `r0`, web `RAIN_MMH`) | **Verified** in several BMKG-derived documents. The daily scale (20–50 / 50–100 / > 100 mm/day) is a *different* table, so do not mix them. | BMKG NTT monthly bulletin, Nov 2019 ([pdf](https://ntt.bmkg.go.id/uploads/buletin/2019/11/buletin%20November_2019.pdf)); STMKG thesis, Table 2.4 "Kategori intensitas curah hujan menurut BMKG" ([link](https://perpus.stmkg.ac.id/index.php?p=fstream-pdf&fid=825&bid=10026)); BMKG Kalbar radar legend (moderate 5–10 mm/h ≈ 38–48 dBZ) ([link](https://kalbar.bmkg.go.id/?page=citra-radar)) |
| 2 | `r0 = 5 mm/h` is the light/moderate boundary (Symbols, Data) | Follows from #1. | as #1 |
| 3 | Out-of-vehicle (walk/wait) time is weighted ≈ 1.5–2 × in-vehicle time; we use 1.5 (Guide "τ and w_m", Data table) | **Verified (range)**. The traditional value is 2. UK and international meta-analyses find lower values, about 1.5–1.75. Our 1.5 is the conservative end. | Abrantes & Wardman (2011), *Transp. Res. A* 45(1):1–17 ([RePEc](https://econpapers.repec.org/RePEc:eee:transa:v:45:y:2011:i:1:p:1-17)); Wardman (2004), "Public transport values of time", *Transport Policy* ([link](https://www.worldtransitresearch.info/research/1505)); Wardman et al., worldwide meta-analysis of walk/wait/headway multipliers ([TRID](https://trid.trb.org/View/2680681)) |
| 4 | Jakarta wet-season rain is short, intense, convective and local; heavy afternoon convection (Guide "WHY", Data "storm peak") | **Verified**. | HARIMAU2010 campaign (Jakarta diurnal cycle), *Prog. Earth Planet. Sci.* (2018) ([doi](https://link.springer.com/10.1186/s40645-018-0216-3)); Siswanto et al., observed increase of urban extreme rainfall in Jakarta ([KNMI](https://www.knmi.nl/research/publications/observed-increase-of-urban-extreme-rainfall-as-surface-temperature-rise-the-jakarta-case)); *JMSJ* 100(3), 2022, short-duration rain trends in Jakarta ([J-STAGE](https://www.jstage.jst.go.jp/article/jmsj/100/3/100_2022-023/_article/-char/en)) |
| 5 | Many Jakarta trips use open modes, mainly motorcycles (Guide "WHY", Q&A) | **Verified (qualitative)**. The numbers depend on the survey: about 54 % of trips (2019 Greater Jakarta mobility survey) to about 76 % of traffic (JICA/JUTPI). **Do not quote one number without its definition.** | Motorcycle congestion-charging study, *J. Perencanaan Wilayah dan Kota* (ITB) ([link](https://journals.itb.ac.id/index.php/jpwk/article/view/23412)); HEART 2020 paper 56 ([pdf](https://transp-or.epfl.ch/heart/2020/abstracts/HEART_2020_paper_56.pdf)); Palevsky, Penn IUR (JUTPI commuter survey) ([pdf](https://penniur.upenn.edu/uploads/media/11_Palevsky.pdf)) |
| 6 | Peaks of 10–40 mm/h for convective cells (Data) | **Consistent with #1** (heavy to very heavy). This is a modelling choice, not a measured distribution. | as #1, #4 |
| 7 | Forecast error of about ±30 % (σ = 0.3 log-normal per 2 × 2 km tile) | **Assumption**. It is not tied to a published BMKG nowcast skill score. Present it as a scenario, and point to the σ sweep (Results → error levels). | — |
| 8 | Exposure values E (walk/moto 1, BRT wait 0.4, rail wait 0.1, in-vehicle 0) | **Assumption**, tested by the sensitivity grid (Robustness screen, `--sensitivity`). | — |
| 9 | Storm speeds 0.1–0.45 km/min (6–27 km/h) for the moving-storm experiment | **Assumption**, within the usual range for tropical convective cell motion. Look for a radar-tracking source if a reviewer asks. | — |

## Text that was changed after checking

* Guide "τ and w_m" now says the value-of-time multiplier is "about 1.5 to 2" (meta-analyses), not just "practice".
* Data table: the `w_m` source column now reads "VoT meta-analyses: 1.5–2".
* Nothing else needed correcting. The BMKG thresholds in the TUI already match the hourly table.
