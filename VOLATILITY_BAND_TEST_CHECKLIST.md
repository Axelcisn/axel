# Volatility Band Visual Test Checklist

## Quick Test (5 minutes)

### Prerequisites
1. Start dev server: `npm run dev`
2. Open browser to timing page: `/company/AAPL/timing`
3. Open browser console (F12)

---

## Part 1: Band Appearance ✅

**Test:** Does the band render correctly?

1. **Initial state** (should have a forecast loaded on page load)
   - [ ] Shaded blue band visible from last bar to future date
   - [ ] Band is cone-shaped (starts narrow, expands)
   - [ ] Dashed line in middle (expected price)
   - [ ] Two thin boundary lines (upper/lower)
   - [ ] Info badge top-left shows: "GBM • σ₁d: X.XXXX • h=5D • 95%"

2. **Console check**
   ```
   Look for: [CHART][VOL-BAND] { model: "GBM-CC", ... }
   Verify: sanityCheck: "✅ lower <= center <= upper"
   ```

---

## Part 2: Model Toggle ✅

**Test:** Does the band update when changing models?

### Test Case 1: GBM → GARCH

1. Click **"GARCH"** button in horizon/coverage controls
2. **Verify:**
   - [ ] Network tab shows 1 POST to `/api/volatility/AAPL`
   - [ ] Band updates (~500ms delay)
   - [ ] Info badge changes to "GARCH (1,1) - Normal"
   - [ ] Console shows new log: `model: "GARCH11-N"`
   - [ ] σ₁d value likely different from GBM

### Test Case 2: GARCH → Range

1. Click **"Range"** button
2. Select **"Parkinson"** from dropdown
3. **Verify:**
   - [ ] 1 API call
   - [ ] Band updates
   - [ ] Info badge: "Range - Parkinson"
   - [ ] Console: `model: "Range-P"`

### Test Case 3: Range → HAR-RV

1. Click **"HAR-RV"** button
2. **Expected:** Error or disabled state (no intraday RV data)
3. **Verify:**
   - [ ] Either band disappears OR old band stays + error message
   - [ ] Console may show: "HAR-RV disabled: no realized volatility data"

---

## Part 3: Horizon/Coverage Changes ✅

**Test:** Does band width respond to h and coverage?

### Horizon Test (h=1 → h=5)

1. Current: h=5D, coverage=95%
2. Click **"1D"** button
3. **Verify:**
   - [ ] Band becomes **much narrower** (√1 vs √5 scaling)
   - [ ] Info badge updates: "h=1D"
   - [ ] Console: `bandWidthPct: ~5%` (vs ~12% for h=5)

4. Click **"5D"** button (back)
5. **Verify:** Band widens again

### Coverage Test (95% → 99%)

1. Current: h=5D, coverage=95%
2. Click **"99%"** button
3. **Verify:**
   - [ ] Band becomes **wider** (z_0.005 = 2.576 vs z_0.025 = 1.96)
   - [ ] Info badge: "99%"
   - [ ] Console: `bandWidthPct` increases by ~30%

---

## Part 4: GARCH Mean-Reversion Test ✅

**Test:** GARCH h=5 should be narrower than naive √h scaling

### Setup

1. Select **GARCH** model
2. Select **h=5D**, coverage=95%
3. Check console for α and β:
   ```
   [VOL_OVERLAY] {
     method: "GARCH11-N",
     ...
   }
   ```
4. Find these in Network tab → Response:
   ```json
   {
     "estimates": {
       "volatility_diagnostics": {
         "alpha": 0.05,
         "beta": 0.90,
         "alpha_plus_beta": 0.95  // φ
       }
     }
   }
   ```

### Manual Calculation

Given:
- σ₁ = 0.0234 (from console log)
- φ = 0.95
- h = 5

**Old formula (incorrect):**
```
σ²_5 = σ²_uncond + φ^4 · (σ²_1 - σ²_uncond)
     ≈ σ²_1  (since φ^4 ≈ 0.81)
s_old = σ_1 = 0.0234
width_old = 2 * z * σ_1 = 2 * 1.96 * 0.0234 = 0.0917 = 9.17%
```

**New formula (correct):**
```
V_5 = 5·σ²_uncond + (σ²_1 - σ²_uncond)·(1 - 0.95^5)/(1 - 0.95)
    ≈ 4.77·σ²_1  (less than 5·σ²_1 due to mean-reversion!)
s_new = sqrt(4.77) * σ_1 = 2.184 * 0.0234 = 0.0511
width_new = 2 * z * s_new = 2 * 1.96 * 0.0511 = 0.200 = 20.0%

IID baseline (no mean-reversion):
s_IID = sqrt(5) * σ_1 = 2.236 * 0.0234 = 0.0523
width_IID = 23.4%
```

**Verify:**
- [ ] Console shows `bandWidthPct: ~20%` (new formula)
- [ ] NOT ~23% (naive IID)
- [ ] Difference: ~3 percentage points tighter due to mean-reversion

### Visual Check

1. Keep GARCH h=5 selected
2. Switch to **GBM** (IID model)
3. **Verify:**
   - [ ] GBM band is **slightly wider** than GARCH band (if σ₁ similar)
   - [ ] Difference more pronounced if φ is high (e.g., 0.98)

---

## Part 5: Pan/Zoom Stability ✅

**Test:** Band should not flicker or remount

1. With band visible, **drag chart left/right** (pan)
2. **Verify:**
   - [ ] Band **disappears** when panned away from latest bar (expected)
   - [ ] Band **reappears** when panning back to latest bar
   - [ ] No console errors
   - [ ] No extra API calls during pan

3. Click different **date range presets** (1M, 3M, 6M, 1Y)
4. **Verify:**
   - [ ] Band stays stable at right edge
   - [ ] No duplicate bands
   - [ ] Chart doesn't remount (smooth transition)

---

## Part 6: Error Cases ✅

**Test:** Graceful degradation

### Case 1: Insufficient Data

1. Pick a symbol with <500 bars (e.g., recent IPO)
2. Select **GARCH** + h=5D
3. **Expected:**
   - [ ] Error message: "GARCH needs ~600 returns"
   - [ ] Band does NOT render (or shows last valid forecast)
   - [ ] No infinite loop

### Case 2: HAR-RV (No Intraday Data)

1. Select **HAR-RV**
2. **Expected:**
   - [ ] Error: "HAR-RV disabled: no realized volatility data"
   - [ ] Band disappears or shows last valid model
   - [ ] Model buttons still functional (can switch back to GBM)

---

## Part 7: Console Sanity Checks ✅

**Test:** Dev logs confirm correct math

### What to Look For

```javascript
[CHART][VOL-BAND] {
  model: "GARCH11-t",
  units: "daily log-return sigma",
  sigma_1d: "0.021234",
  horizon: 5,
  center: "245.67",
  lower: "230.12",
  upper: "261.89",
  sanityCheck: "✅ lower <= center <= upper",
  bandWidthPct: "13.78%"
}
```

### Red Flags (Should NOT Appear)

- ❌ `sanityCheck: "❌ INVALID ORDERING"`
- ❌ `bandWidthPct: "150%"` (way too wide)
- ❌ `bandWidthPct: "0.5%"` (way too narrow)
- ❌ `sigma_1d: "0"` or negative
- ❌ Multiple identical logs per second (infinite loop)

---

## Acceptance Summary

| Category | Test | Pass/Fail |
|----------|------|-----------|
| **Visual** | Band renders with shaded area | ⬜ |
| **Visual** | Info badge shows model + params | ⬜ |
| **Toggle** | GBM → GARCH updates band | ⬜ |
| **Toggle** | 1 API call per toggle | ⬜ |
| **Horizon** | h=1 narrower than h=5 | ⬜ |
| **Coverage** | 99% wider than 95% | ⬜ |
| **Formula** | GARCH h=5 < √5 scaling | ⬜ |
| **Stability** | Pan/zoom doesn't break band | ⬜ |
| **Console** | Sanity checks pass | ⬜ |

---

## Quick Pass Criteria

**ALL must be true:**
1. ✅ Band is clearly visible (not just thin lines)
2. ✅ Toggling models changes the band instantly
3. ✅ No infinite loops (Network tab shows ≤ 1 req per action)
4. ✅ Console shows "✅ lower <= center <= upper"
5. ✅ GARCH band is narrower than GBM band (for h>1, high φ)

**If any fail:** Check implementation files listed in VOLATILITY_BAND_IMPLEMENTATION.md
