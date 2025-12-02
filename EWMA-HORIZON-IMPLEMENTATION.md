# EWMA Walker Horizon-Aware Implementation

## Summary

The EWMA Walker has been updated to support variable forecast horizons (1D, 2D, 3D, 5D, etc.) that track the Timing page horizon `h`. Previously, everything was hard-wired to 1-day (`t → t+1`).

## Changes Made

### 1. `lib/volatility/ewmaWalker.ts`

#### Updated File Header Comment
- Changed from "1-day ahead" to "h-day ahead" description
- Updated formula to show `σ_h = σ_t × √h` scaling

#### Updated `EwmaWalkerPoint` Interface
- Comments now reference `t+h` instead of `t+1`
- Standardized error formula updated to `(log(S_{t+h}/S_t)) / (sigma_t * sqrt(h))`

#### Extended `EwmaWalkerParams` Interface
```typescript
export interface EwmaWalkerParams {
  // ... existing fields ...
  /** Forecast horizon in trading days (default 1) */
  horizon?: number;
}
```

#### Updated `runEwmaWalker` Function
- Added `horizon` parameter with default value of 1
- Validates horizon: `const h = Number.isFinite(horizon) && horizon >= 1 ? Math.floor(horizon) : 1`
- Changed loop bound from `data.length - 1` to `data.length - h` to ensure target index is valid
- Computes h-day volatility: `sigma_h = sigma_t * Math.sqrt(h)`
- Applies h-day scaling to prediction interval bounds:
  ```typescript
  const L_target = S_t * Math.exp(-z * sigma_h);
  const U_target = S_t * Math.exp(z * sigma_h);
  ```
- Standardized error now uses h-day volatility: `standardizedError = logReturnH / sigma_h`
- Returns `horizon: h` in `params` object

### 2. `app/api/volatility/ewma/[symbol]/route.ts`

- Added `h` query parameter parsing (default: 1)
- Added validation: `h` must be at least 1
- Passes `horizon` to `runEwmaWalker()`
- Returns `horizon: result.params.horizon` in JSON response

### 3. `app/company/[ticker]/timing/page.tsx`

- Updated `loadEwmaWalker` to pass current horizon `h` to API:
  ```typescript
  const query = new URLSearchParams({
    lambda: '0.94',
    h: String(h),
  });
  ```
- Added `h` to the dependency array: `[params?.ticker, h]`
- EWMA now auto-refreshes when horizon changes

### 4. `components/PriceChart.tsx`

- Changed static label from `EWMA Walker (1D)` to dynamic `EWMA Walker ({horizon ?? 1}D)`
- Updated comment to clarify `date_tp1` is the "h-step target date"

### 5. Test Files

- `test-ewma-walker.ts`: Added explicit `horizon: 1` parameter
- `test-ewma-integration.ts`: Added multi-horizon test that:
  - Runs with `horizon: 5`
  - Verifies point count reduction by `h-1`
  - Verifies avgWidth increases by approximately `√h`

## Mathematical Details

For h-day forecast:
- Daily EWMA volatility: `σ_t` (unchanged)
- H-day volatility: `σ_h = σ_t × √h`
- Prediction interval: `[S_t × exp(-z × σ_h), S_t × exp(+z × σ_h)]`
- Coverage evaluated against realized price `S_{t+h}`

## Behavior

1. When user clicks a horizon pill (1D, 2D, 3D, 5D) on the Timing page:
   - `setH(newH)` updates the horizon state
   - `loadEwmaWalker` dependency on `h` triggers re-fetch
   - API returns EWMA points computed for the new horizon
   - Chart overlay updates with wider bands (√h scaling)
   - Card label shows `EWMA Walker (hD)`

2. Default behavior (horizon=1) is identical to previous implementation

## Verification

To verify the implementation works correctly:
1. Run `npx tsx test-ewma-integration.ts`
2. Check that the width ratio between 5D and 1D is approximately √5 ≈ 2.24
3. On the Timing page, toggle between horizons and observe the EWMA band widening
