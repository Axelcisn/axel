# Momentum Timing — 01. Goals & Scope

## 1.1 Goal
User uploads an Excel file (e.g., AMD-history.xlsx) → the app ingests it, builds a canonical daily dataset, computes final **prediction intervals (PIs)**, detects abnormal **PI breakouts** (events), measures continuation **T** (time to reversion), learns the **magnitude → duration** mapping, evaluates calibration (OOS), and renders **watchlist rows + alerts**, with full **provenance**.

## 1.2 Scope
- **Single-company first** (e.g., AMD), pipeline is **multi-ticker-ready**.
- **Ingestion:** Excel → canonical dataset (split-adjusted OHLC, adj_close, volume, calendar/TZ binding, corporate actions).
- **Forecast target:** Next trading-day **Adjusted Close** (future observation), with **PIs** at nominal coverage (default 95%).
- **Model stack:** 
  - Baseline GBM PIs (μ* MLE with denom N; drift shrinkage λ).
  - Volatility upgrades: GARCH(1,1) (Normal or Student-t), HAR-RV (if RV exists), and Range-based σ (Parkinson/GK/RS/YZ with YZ weight k).
  - Conformal wrapper (ICP / CQR / EnbPI / ACI) for coverage calibration.
- **Events:** First day price lies **outside** the final 1-day PI.
- **Continuation clock:** Re-entry (recommended) or sign-flip; right-censor at T_max or end-of-sample.
- **Mapping:** KM by |z| bins (publish if n≥40) + Cox (ties=Efron, cluster=symbol) / AFT fallback.
- **Backtest:** Rolling-origin (daily refit); PI coverage + Interval (Winkler) score; DM(HAC) for model compare; survival C-index/IBS; stationary bootstrap CIs; Bai–Perron regimes; BH-FDR; PBO/CSCV + DSR when trading is enabled.
- **Watchlist:** One row per symbol with deviation snapshot, median T̂ (I60/I80), P̂(T≥k), next-review date, quality chips, and provenance.
- **Alerts:** Thresholds on P̂(T≥k) and next-review date (exchange TZ).

## 1.3 Non-goals
- No generic changepoint detectors (CUSUM, Kalman, PELT, Bayesian). Events come **only** from PI breakouts.
- No point-forecast KPIs (MAE/RMSE/MAPE) as headline metrics for PIs.
- No manual labeling of events; no external options feeds for IV/VIX (future enhancement).
- No multi-asset portfolio execution or brokerage integration in this phase.

## 1.4 Success Metrics (high-level)
- **PI calibration:** coverage within ±1–2 pp of nominal; lower Interval (Winkler) score better.
- **Duration predictive quality:** Harrell's **C-index** ≥ baseline; **IBS** decreased vs baseline.
- **Robustness:** Bootstrap CIs reported; regime splits consistent; DM(HAC) significance documented.
- **Reproducibility:** Forecasts locked with seeds/params; provenance complete.

## 1.5 Constraints & Assumptions
- PI logic runs at **t close** (exchange TZ); verification on **t+1 close**.
- **Adjusted Close** only for returns; OHLC coherence enforced.
- Minimum history: window ≥ 504 trading days for GBM; 1000 suggested for GARCH.
- Conformal domains default to **log-price**; domain switch forces recalibration.

## 1.6 Dependencies
- Exchange calendar & IANA TZ resolver for primary listing.
- Corporate actions feed (splits/dividends) or placeholders (logged if absent).
- Local storage/API for forecast/event/mapping/eval persistence.

## 1.7 Glossary (terms used throughout)
- **PI (Prediction Interval):** Range for the next **observation** (not a confidence interval).
- **μ*** (mu_star): Mean daily log-return; **MLE denom N**; shrink via λ.
- **Final PI:** Base PI (GBM/GARCH/HAR/Range) after **Conformal** adjustments.
- **Event:** S_{t+1} ∉ [L_1, U_1]; direction ↑/↓.
- **T:** Trading-day count from breakout until stop rule; right-censored if capped/not observed.

## 1.8 Page Sitemap (link to layout)
Header → Target → Data Quality → Final PI + GBM/Vol/Range → Conformal → Event → Continuation → Mapping (KM/Cox) → Backtest → Watchlist → Alerts → Provenance.

## 1.9 Acceptance Criteria (for this document step)
- This file exists at `/docs/momentum-timing/01-goals-scope.md`.
- It uses **"Prediction Interval"** terminology everywhere (no "confidence interval").
- It explicitly lists **Non-goals** forbidding CUSUM/Kalman/PELT/Bayesian.
- It references μ* **MLE with denom N** and drift shrinkage λ.
- It lists GARCH multi-step σ²_{t+h|t}, YZ weight **k**, and conformal modes (ICP/CQR/EnbPI/ACI).
- It states Cox ties **Efron**, cluster-robust SEs by symbol.

## 1.10 Next Steps (what follows after this doc)
2) Ingestion & Canonical Dataset → 3) GBM Baseline → 4–5) Vol upgrades → 6) Conformal → 7) Events → 8) Clock → 9) Mapping → 10) Backtest → 11) Watchlist + Alerts → 12) Provenance.