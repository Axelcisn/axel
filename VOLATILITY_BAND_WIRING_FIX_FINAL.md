# Volatility Model Band Wiring Fix - Final Implementation

## Problem Summary

**User Report:**
- Clicking Range/GARCH in the Volatility Model selector updates the button highlight
- BUT the chart badge still shows "GBM σ₁d..."
- AND the volatility band/cone does not appear or change

## Root Cause

The chart overlay was reading from an **unfiltered fallback chain** that returned forecasts regardless of whether they matched the currently selected model.

### The Faulty Fallback Chain (Original Code)

```tsx
const stableOverlayForecast = useMemo(() => {
  // Priority: activeForecast > currentForecast > gbmForecast
  return activeForecast || currentForecast || gbmForecast || null;
}, [activeForecast, currentForecast, gbmForecast, params.ticker]);
```

**The Issue:**
1. User toggles GBM → Range
2. `handleModelChange` clears `activeForecast`, `baseForecast`, `volForecast`, `currentForecast`, `gbmForecast` ✅
3. Auto-forecast effect fires and sets `activeForecast = <Range forecast>` ✅
4. BUT if `currentForecast` or `gbmForecast` get re-populated (from localStorage, API calls, etc.), they leak into the fallback chain ❌
5. `stableOverlayForecast` returns the first non-null forecast, which could be stale GBM instead of the new Range forecast ❌
6. Chart displays stale GBM badge and band ❌

## The Fix

### 1. Model-Matching Forecast Filter (page.tsx)

**Added helper function** (after state declarations at ~line 393):
```tsx
const forecastMatchesSelection = useCallback((forecast: any) => {
  if (!forecast?.method) return false;
  
  const method = forecast.method;
  
  // Check if forecast matches selected model
  if (volModel === 'GBM') {
    return method === 'GBM' || method === 'GBM-CC';
  } else if (volModel === 'GARCH') {
    const expectedMethod = garchEstimator === 'Student-t' ? 'GARCH11-t' : 'GARCH11-N';
    return method === expectedMethod;
  } else if (volModel === 'HAR-RV') {
    return method === 'HAR-RV';
  } else if (volModel === 'Range') {
    return method === `Range-${rangeEstimator}`;
  }
  
  return false;
}, [volModel, garchEstimator, rangeEstimator]);
```

**Filtered forecast selection** (~line 400):
```tsx
const stableOverlayForecastFiltered = useMemo(() => {
  const candidates = [activeForecast, currentForecast, gbmForecast].filter(Boolean);
  const matchingForecast = candidates.find(f => forecastMatchesSelection(f));
  return matchingForecast || null;
}, [activeForecast, currentForecast, gbmForecast, forecastMatchesSelection]);
```

**Filtered fallback with localStorage** (~line 408):
```tsx
const fallbackOverlayForecast = useMemo(() => {
  if (stableOverlayForecastFiltered) return stableOverlayForecastFiltered;
  // Check if stored forecast matches current selection before using it
  if (storedForecast && forecastMatchesSelection(storedForecast)) {
    return storedForecast;
  }
  return null;
}, [stableOverlayForecastFiltered, storedForecast, forecastMatchesSelection]);
```

**Key Changes:**
- ✅ Only forecasts matching the current `volModel` + estimator are returned
- ✅ Stale GBM forecasts are filtered out when Range/GARCH is selected
- ✅ localStorage persistence also filters by model match
- ✅ Chart always receives model-consistent forecast or `null`

### 2. Band Data Logging (PriceChart.tsx)

**Added `forecastBand` field to ChartPoint interface** (~line 148):
```tsx
interface ChartPoint {
  // ... existing fields ...
  forecastBand?: number | null;  // Band width (Upper - Lower) for stacked area rendering
}
```

**Added dev logging to verify band data** (~line 2808):
```tsx
useEffect(() => {
  if (process.env.NODE_ENV !== "development") return;
  if (!forecastOverlay?.activeForecast) return;
  
  const bandPoints = chartDataWithForecastBand.filter(p => p.forecastBand != null && p.forecastBand > 0);
  const af = forecastOverlay.activeForecast;
  
  console.log('[CHART][BAND-DATA]', {
    method: af?.method,
    totalChartPoints: chartDataWithForecastBand.length,
    bandPointsCount: bandPoints.length,
    hasBandData: bandPoints.length > 0,
    sampleBandPoint: bandPoints.length > 0 ? {
      date: bandPoints[0].date,
      forecastCenter: bandPoints[0].forecastCenter?.toFixed(2),
      forecastLower: bandPoints[0].forecastLower?.toFixed(2),
      forecastUpper: bandPoints[0].forecastUpper?.toFixed(2),
      forecastBand: bandPoints[0].forecastBand?.toFixed(2),
    } : 'NO BAND DATA',
    bandIsVisible: bandPoints.length > 0 ? '✅ YES' : '❌ NO - Band will not render!'
  });
}, [chartDataWithForecastBand, forecastOverlay]);
```

**Why This Helps:**
- Shows exactly how many chart points have valid band data
- Provides sample band point for debugging
- Clear visibility indicator (✅ YES / ❌ NO)
- Helps diagnose if band is computed but not visible (e.g., outside chart domain)

### 3. Loading Badge (Already Implemented)

The loading badge was already added in the previous fix (lines 4377-4391):
```tsx
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

## Testing Instructions

### Manual Verification

1. **Start dev server:**
   ```bash
   npm run dev
   ```

2. **Open timing page:**
   ```
   http://localhost:3000/company/AAPL/timing
   ```

3. **Test GBM → Range:**
   - Current state: GBM selected, badge shows "GBM σ₁d: ..."
   - Click "Range" button
   - **Expected:**
     - Badge immediately shows "Loading Range..." (pulse animation)
     - After ~300ms, badge updates to "Range-P σ₁d: 0.0123 h=5D 95%"
     - Band appears on chart (filled gradient area from last bar to t+5)
     - Console shows:
       ```
       [AutoForecast] volModel: 'Range'
       [VOL_OVERLAY] {method: "Range-P", ...}
       [CHART][VOL-BAND] ✅ lower <= center <= upper
       [CHART][BAND-DATA] {method: "Range-P", bandPointsCount: 6, bandIsVisible: "✅ YES"}
       ```

4. **Test Range → GARCH:**
   - Click "GARCH" button → "Normal"
   - **Expected:**
     - Badge shows "Loading GARCH..."
     - Badge updates to "GARCH11-N σ₁d: 0.0118 h=5D 95%"
     - Band updates (narrower due to mean-reversion)
     - Console shows `method: "GARCH11-N"`

5. **Test GARCH → GBM:**
   - Click "GBM" button
   - **Expected:**
     - Badge shows "Loading GBM..."
     - Badge updates to "GBM σ₁d: 0.0115 h=5D 95%"
     - Band updates

6. **Test Estimator Toggle:**
   - Select "Range", toggle P → YZ → GK
   - **Expected:** Each toggle triggers new forecast with updated estimator name in badge
   - Select "GARCH", toggle Normal → Student-t
   - **Expected:** Badge updates to "GARCH11-t", band typically wider (heavier tails)

### Console Verification

**Expected log sequence:**
```
[FORECAST_CHANGE_LOG] {action: "setActiveForecast called", forecast: null}
[AutoForecast] Triggering volatility forecast for Inspector: {volModel: 'Range', rangeEstimator: 'P'}
[VOL][handler] POST -> /api/volatility {model: 'Range-P'}
[AutoForecast] Volatility forecast generated successfully
[FORECAST_CHANGE_LOG] {action: "setActiveForecast called", forecast: {method: "Range-P"}}
[FORECAST_OVERLAY_DEBUG] activeForecast changed: {method: "Range-P", hasIntervals: true}
[VOL_OVERLAY] {hasOverlay: true, method: "Range-P", overlayDate: "2025-01-15"}
[CHART][VOL-BAND] {model: "Range-P", sigma_1d: "0.012345", sanityCheck: "✅ lower <= center <= upper"}
[CHART][BAND-DATA] {method: "Range-P", bandPointsCount: 6, hasBandData: true, bandIsVisible: "✅ YES"}
```

**Should NOT see:**
- `[VOL_OVERLAY] {method: "GBM"}` after toggling to Range
- `bandIsVisible: "❌ NO - Band will not render!"`
- Badge stuck showing old model name

### Network Verification

**DevTools → Network tab:**
1. Toggle GBM → Range
2. **Expected:** Exactly 1 POST to `/api/volatility/AAPL`
3. **Request body:**
   ```json
   {
     "model": "Range-P",
     "params": {"range": {"window": 504, "ewma_lambda": 0.94, "estimator": "P"}},
     "horizon": 5,
     "coverage": 0.95
   }
   ```
4. **Response:** `{method: "Range-P", intervals: {L_h: ..., U_h: ...}}`
5. **Should NOT see:** Multiple rapid-fire requests (no loops)

## Acceptance Criteria

✅ **Badge updates immediately** after model toggle (shows loading state)
✅ **Badge displays correct model name** (Range-P, GARCH11-N, etc.)
✅ **Badge NEVER shows GBM** when Range/GARCH is selected
✅ **Band becomes visible** on chart (filled gradient area)
✅ **Band width changes** when toggling models (GARCH narrower due to mean-reversion)
✅ **Estimator changes work** (Range: P/GK/RS/YZ, GARCH: Normal/Student-t)
✅ **Exactly 1 API call per toggle** (no loops)
✅ **Console shows band data** with `bandIsVisible: "✅ YES"`
✅ **TypeScript compilation passes** (`npx tsc --noEmit`)

## Files Changed

### `/app/company/[ticker]/timing/page.tsx`

**Changes:**
1. Added `forecastMatchesSelection()` helper function (after volModel state declarations)
2. Created `stableOverlayForecastFiltered` that filters candidates by model match
3. Updated `fallbackOverlayForecast` to use filtered forecast and check stored forecast match
4. Moved localStorage persist effect to use `stableOverlayForecastFiltered`

**Lines affected:** ~310-425

### `/components/PriceChart.tsx`

**Changes:**
1. Added `forecastBand?: number | null` to `ChartPoint` interface
2. Added dev logging useEffect to verify band data and visibility

**Lines affected:** 
- Interface: ~148
- Logging: ~2808-2830

## Architecture Notes

### Why Filter Instead of Clear?

**Original approach (VOLATILITY_BAND_WIRING_FIX.md):**
- Clear `currentForecast` and `gbmForecast` on model toggle
- Problem: These get re-populated from various sources (API, localStorage, auto-effects)
- Result: Race conditions where stale forecasts leak back in

**Current approach (this fix):**
- Keep all forecast sources intact (`activeForecast`, `currentForecast`, `gbmForecast`)
- Filter the fallback chain to ONLY return forecasts matching current selection
- Result: No matter what populates the forecast states, chart only sees matching forecasts

**Why This Is Better:**
- ✅ Robust to race conditions (no timing-dependent bugs)
- ✅ Preserves forecast data for other UI components (GBM card, Inspectors)
- ✅ Simple mental model: "chart sees only matching forecasts"
- ✅ No need to coordinate clearing across multiple effects

### Forecast State Separation

The codebase maintains separate forecast states for different purposes:

| State Variable | Purpose | Used By |
|---|---|---|
| `activeForecast` | Chart overlay display | PriceChart |
| `currentForecast` | Latest from API | Historical view |
| `gbmForecast` | GBM baseline | GBM card |
| `volForecast` | Last vol model run | Inspectors |
| `baseForecast` | Conformal input | Pipeline |

**This separation is intentional.** The fix preserves this architecture while ensuring the chart overlay receives model-consistent data via filtering.

### Band Visibility Requirements

**For the band to render:**
1. ✅ `forecastOverlay.activeForecast` must exist and match selected model
2. ✅ `overlayDate`, `overlayCenter`, `overlayLower`, `overlayUpper` must be computed
3. ✅ `chartDataWithForecastBand` must have points with `forecastBand > 0`
4. ✅ Band points must be within chart's visible domain

**The dev logging helps diagnose issues:**
- `[VOL_OVERLAY]` - Checks step 1 & 2
- `[CHART][VOL-BAND]` - Checks step 2 (band ordering, sanity)
- `[CHART][BAND-DATA]` - Checks step 3 (band data exists)
- Visual inspection - Checks step 4 (band within viewport)

## Troubleshooting

### Badge Still Shows "GBM" After Toggle

**Possible causes:**
1. `forecastMatchesSelection()` logic doesn't match API response `method` format
2. Auto-forecast effect not firing (check dependencies)
3. API returning wrong `method` string

**Debug steps:**
```javascript
// In browser console:
console.log('[DEBUG] fallbackOverlayForecast:', fallbackOverlayForecast);
console.log('[DEBUG] volModel:', volModel);
console.log('[DEBUG] garchEstimator:', garchEstimator);
console.log('[DEBUG] rangeEstimator:', rangeEstimator);
```

### Band Not Visible

**Possible causes:**
1. Band points outside visible chart domain (zoom/pan issue)
2. `forecastBand` values all zero/null
3. Gradient fill opacity too low

**Debug steps:**
```javascript
// Check dev console:
// Look for: [CHART][BAND-DATA] {bandIsVisible: "❌ NO"}
// If bandPointsCount = 0, band data not computed
// If bandPointsCount > 0 but not visible, check chart domain/zoom
```

## Future Improvements

1. **Type Safety:** Add discriminated union for forecast types instead of `any`
2. **Forecast Cache:** Implement LRU cache to avoid re-fetching when toggling back
3. **Loading State:** Centralize in reducer pattern instead of multiple useState
4. **Band Animation:** Add smooth transition when band updates
5. **Domain Auto-Fit:** Automatically adjust Y-axis when band extends beyond current domain

## Related Documentation

- Previous fix attempt: `VOLATILITY_BAND_WIRING_FIX.md` (clearing approach)
- Original implementation: `VOLATILITY_BAND_IMPLEMENTATION.md` (formula fixes)
- Testing checklist: `VOLATILITY_BAND_TEST_CHECKLIST.md` (acceptance criteria)
