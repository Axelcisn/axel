# Volatility Model Band Wiring Fix

## Problem Summary

When toggling volatility model buttons (GBM → Range, GBM → GARCH, etc.), the chart's info badge and forecast band did not update. The badge continued showing "GBM σ₁d..." even after selecting Range or GARCH, and the band remained invisible or stale.

## Root Cause (Bucket 1 + Bucket 3)

### The Forecast Request Pipeline WAS Working
- ✅ The auto-forecast `useEffect` (lines 5048-5180) correctly depends on `volModel`, `garchEstimator`, `rangeEstimator`
- ✅ It fires on every model toggle
- ✅ It calls `generateVolatilityForecast()` successfully
- ✅ It sets `activeForecast` to the new forecast (line 5141)

### The Chart Rendering Pipeline WAS NOT Working

**The bug:** Multiple stale forecast state variables polluted the fallback chain used by the chart.

#### State Variable Confusion (lines 200-213)
```tsx
const [currentForecast, setCurrentForecast] = useState<GbmForecast | ForecastRecord | null>(null);
const [gbmForecast, setGbmForecast] = useState<any | null>(null);
const [volForecast, setVolForecast] = useState<any | null>(null);
const [baseForecast, setBaseForecast] = useState<any | null>(null);
const [activeForecast, setActiveForecast] = useState<any | null>(null);
```

#### Fallback Chain (line 310)
```tsx
const stableOverlayForecast = useMemo(() => {
  // Priority: activeForecast > currentForecast > gbmForecast
  return activeForecast || currentForecast || gbmForecast || null;
}, [activeForecast, currentForecast, gbmForecast, params.ticker]);
```

#### Chart Props (line 1621)
```tsx
const forecastOverlayProps = useMemo(() => ({
  activeForecast: fallbackOverlayForecast,  // ← Uses fallback chain, not direct activeForecast!
  volModel,
  coverage,
  conformalState,
}), [fallbackOverlayForecast, volModel, coverage, conformalState]);
```

**The issue:** When user toggled from GBM to Range:
1. `handleModelChange` set `activeForecast = null` ✅
2. Auto-forecast effect fired and set `activeForecast = <new Range forecast>` ✅
3. BUT `currentForecast` and `gbmForecast` were **NOT cleared** ❌
4. `stableOverlayForecast` evaluated to `currentForecast` (old GBM) instead of `activeForecast` (new Range) ❌
5. Chart displayed stale GBM badge/band ❌

## The Fix

### 1. Clear ALL Forecast State on Model Toggle (page.tsx lines 4836-4844)

**Before:**
```tsx
const handleModelChange = useCallback((newModel: 'GBM' | 'GARCH' | 'HAR-RV' | 'Range') => {
  setVolModel(newModel);
  // Clear stale overlays so tooltip/chart doesn't show previous model while new one is loading
  setActiveForecast(null);
  setBaseForecast(null);
  setVolForecast(null);
  // Auto-triggers volatility forecast via useEffect (for Inspector)
  // Conformal calibration only runs when user clicks "Generate"
}, []);
```

**After:**
```tsx
const handleModelChange = useCallback((newModel: 'GBM' | 'GARCH' | 'HAR-RV' | 'Range') => {
  setVolModel(newModel);
  // Clear ALL stale overlays so tooltip/chart doesn't show previous model while new one is loading
  setActiveForecast(null);
  setBaseForecast(null);
  setVolForecast(null);
  setCurrentForecast(null);  // CRITICAL: Clear this to prevent fallback to old forecast
  setGbmForecast(null);       // CRITICAL: Clear this to prevent fallback to old GBM
  // Auto-triggers volatility forecast via useEffect (for Inspector)
  // Conformal calibration only runs when user clicks "Generate"
}, []);
```

**Why this works:**
- Clears the entire fallback chain so `stableOverlayForecast` evaluates to `null` initially
- When auto-forecast completes, `activeForecast` is set to the new forecast
- `stableOverlayForecast` now correctly uses `activeForecast` (no stale fallbacks)
- Chart receives correct forecast data via `forecastOverlayProps`

### 2. Add Loading Badge (PriceChart.tsx lines 4376-4391)

**Added before existing badge:**
```tsx
{/* Volatility Model Info Badge - shown when forecast is active OR loading */}
{horizonCoverage?.isLoading && !forecastModelName && (
  <div className="absolute top-2 left-2 z-10 pointer-events-none">
    <div className={`px-2.5 py-1 rounded-lg text-[10px] font-mono backdrop-blur-sm border animate-pulse ${
      isDarkMode 
        ? 'bg-gray-800/60 border-gray-600/30 text-gray-300' 
        : 'bg-gray-100/80 border-gray-400/50 text-gray-600'
    }`}>
      <div className="flex items-center gap-2">
        <span className="font-semibold">Loading {horizonCoverage.volModel}...</span>
        {horizonCoverage?.h && (
          <span className="opacity-75">h={horizonCoverage.h}D</span>
        )}
        {horizonCoverage?.coverage && (
          <span className="opacity-75">{(horizonCoverage.coverage * 100).toFixed(0)}%</span>
        )}
      </div>
    </div>
  </div>
)}
```

**Why this helps:**
- Shows "Loading GARCH..." or "Loading Range..." immediately after model toggle
- Prevents confusion when stale GBM badge disappears but new model isn't ready
- Uses `animate-pulse` for visual feedback that work is in progress

## Testing Instructions

### Manual Verification Steps

1. **Start dev server:**
   ```bash
   npm run dev
   ```

2. **Open timing page:**
   ```
   http://localhost:3000/company/AAPL/timing
   ```

3. **Test GBM → Range:**
   - Click "Range" button
   - **Expected:** Badge immediately shows "Loading Range..." with pulse animation
   - **Expected:** After ~300ms, badge updates to "Range-P σ₁d: 0.0123 h=5D 95%"
   - **Expected:** Forecast band appears on chart (filled area from last bar to t+5)
   - **Expected:** Console shows `[AutoForecast] Triggering volatility forecast for Inspector: volModel: 'Range'`

4. **Test Range → GARCH:**
   - Click "GARCH" button → "Normal" sub-button
   - **Expected:** Badge shows "Loading GARCH..."
   - **Expected:** Badge updates to "GARCH11-N σ₁d: 0.0118 h=5D 95%"
   - **Expected:** Band updates (should be narrower due to mean-reversion)
   - **Expected:** Console shows `[AutoForecast] volModel: 'GARCH'`

5. **Test GARCH → GBM:**
   - Click "GBM" button
   - **Expected:** Badge shows "Loading GBM..."
   - **Expected:** Badge updates to "GBM σ₁d: 0.0115 h=5D 95%"
   - **Expected:** Band updates

6. **Test Estimator Toggle (Range):**
   - Select "Range" model
   - Click "P" → "YZ" → "GK" estimators
   - **Expected:** Each click triggers loading badge → updated badge with new estimator name
   - **Expected:** Band width changes slightly between estimators

7. **Test Estimator Toggle (GARCH):**
   - Select "GARCH" model
   - Click "Normal" → "Student-t"
   - **Expected:** Loading badge → "GARCH11-t σ₁d: ..."
   - **Expected:** Band typically wider with Student-t (heavier tails)

### Console Verification

**Expected log sequence on model toggle:**
```
[FORECAST_CHANGE_LOG] {timestamp: ..., action: "setActiveForecast called", forecast: null}
[AutoForecast] Triggering volatility forecast for Inspector: {volModel: 'Range', rangeEstimator: 'P', ...}
[VOL][handler] POST -> /api/volatility {model: 'Range-P', ...}
[AutoForecast] Volatility forecast generated successfully
[FORECAST_CHANGE_LOG] {timestamp: ..., action: "setActiveForecast called", forecast: {method: "Range-P", ...}}
[FORECAST_OVERLAY_DEBUG] activeForecast changed: {method: "Range-P", hasIntervals: true, ...}
[VOL_OVERLAY] {hasOverlay: true, method: "Range-P", overlayDate: "2025-01-15", ...}
[CHART][VOL-BAND] ✅ lower <= center <= upper
```

**Should NOT see:**
- `[VOL_OVERLAY] {method: "GBM", ...}` after toggling to Range
- `❌ SANITY FAIL: Band ordering violated!`
- Badge stuck on old model name

### Network Verification

1. **Open DevTools → Network tab**
2. **Toggle from GBM → Range**
3. **Expected:** Exactly 1 POST to `/api/volatility/AAPL` with body:
   ```json
   {
     "model": "Range-P",
     "params": {"range": {"window": 504, "ewma_lambda": 0.94, "estimator": "P"}},
     "horizon": 5,
     "coverage": 0.95,
     ...
   }
   ```
4. **Expected:** Response contains `method: "Range-P"` and `intervals: {L_h: ..., U_h: ...}`
5. **Should NOT see:** Multiple rapid-fire requests (indicates infinite loop)

## Acceptance Criteria

✅ **Badge updates immediately** after model toggle (shows loading state)
✅ **Badge displays correct model name** after forecast completes (Range-*, GARCH11-*, GBM)
✅ **Band becomes visible** on chart (filled area with gradient)
✅ **Band width changes** when toggling models (GARCH narrower than GBM due to mean-reversion)
✅ **Estimator changes work** (Range: P/GK/RS/YZ, GARCH: Normal/Student-t)
✅ **Exactly 1 API call per toggle** (no loops, no excessive requests)
✅ **Console shows sanity check pass** (`✅ lower <= center <= upper`)
✅ **No TypeScript errors** (`npx tsc --noEmit` passes)

## Files Changed

### `/app/company/[ticker]/timing/page.tsx`
- **Function:** `handleModelChange` (lines 4836-4844)
- **Change:** Added `setCurrentForecast(null)` and `setGbmForecast(null)` to clear entire fallback chain

### `/components/PriceChart.tsx`
- **Section:** Volatility Model Info Badge (lines 4376-4409)
- **Change:** Added loading badge before existing forecast badge
- **Visual:** Pulse animation with gray styling during loading state

## Technical Notes

### Why Multiple Forecast State Variables?

The codebase evolved with separate state for different purposes:
- `activeForecast` - Chart overlay display (what user sees)
- `baseForecast` - Input to conformal calibration (internal pipeline)
- `currentForecast` - Latest from API (GBM card display)
- `gbmForecast` - Baseline GBM (comparison reference)
- `volForecast` - Last volatility model run (Inspector display)

This separation is intentional for different UI sections. The bug was that the **fallback chain** used by `forecastOverlayProps` included stale variables that weren't cleared on model toggle.

### Why Not Simplify to Single Forecast State?

Considered but rejected because:
1. GBM card should ONLY show GBM forecasts (never Range/GARCH)
2. Inspectors need separate display logic for each model type
3. Conformal calibration pipeline needs stable `baseForecast` that doesn't change during UI updates
4. Historical forecasts in `currentForecast` shouldn't be overwritten by new model experiments

The fix preserves this separation while ensuring the chart overlay fallback chain is properly cleared.

### Alternative Fixes Considered

**Option A: Remove fallback chain entirely**
```tsx
const forecastOverlayProps = useMemo(() => ({
  activeForecast: activeForecast,  // Direct, no fallbacks
  volModel,
  coverage,
  conformalState,
}), [activeForecast, volModel, coverage, conformalState]);
```
**Rejected:** Breaks localStorage persistence feature (line 320-328) where stored forecast is used if no active forecast exists.

**Option B: Clear localStorage on model toggle**
**Rejected:** User might want to keep old forecast for comparison. Only clearing state variables is sufficient.

**Option C: Add `key` prop to PriceChart to force remount**
**Rejected:** Causes chart animation churn and loses zoom/pan state. State management fix is cleaner.

## Related Documentation

- Original implementation: `VOLATILITY_BAND_IMPLEMENTATION.md` (formula fixes, visual design)
- Testing checklist: `VOLATILITY_BAND_TEST_CHECKLIST.md` (acceptance criteria)
- Formula derivations: `lib/volatility/piComposer.ts` (GARCH cumulative variance)

## Future Improvements

1. **Deduplicate forecast state:** Refactor to single source with derived selectors
2. **Type safety:** Add discriminated unions for forecast types instead of `any`
3. **Loading states:** Centralize loading/error/success states in reducer pattern
4. **Forecast cache:** Implement LRU cache to avoid re-fetching when toggling back to previous model
