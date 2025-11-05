# Momentum Timing — Implementation Checklist (Layout → Logic)

[x] 01 Goals & Scope (this doc) — ACCEPTED
[x] 02 Ingestion & Canonical dataset — schema, calendar/TZ, badges
[x] 03 Forecast Target Spec — h, coverage, variable, cutoff, TZ dependency, validation
[ ] 04 GBM PI engine — μ* (MLE N), σ (MLE N), λ drift, band_width_bp, lock
[ ] 04 GARCH/HAR — σ forecasts (Normal/Student-t), multi-step, diagnostics
[ ] 05 Range-based σ — Parkinson/GK/RS/YZ (with k), EWMA option
[ ] 06 Conformal — ICP (scaled), CQR, EnbPI, ACI; coverage chips
[ ] 07 Event engine — PI breakout, z_B, z_excess_B, pct_outside_B, ndist_B; cooldown
[ ] 08 Continuation — T, stop logic, censoring; KM tuples
[ ] 09 Mapping — KM (n≥40) + Cox (efron, cluster) / AFT; predictions
[ ] 10 Backtest — rolling-origin; coverage & Interval score; DM(HAC); C/IBS; bootstrap; regimes; FDR; PBO/DSR
[ ] 11 Watchlist & Alerts — row composer; triggers; provenance
[ ] 12 Provenance & Audit — seeds/params; repair logs