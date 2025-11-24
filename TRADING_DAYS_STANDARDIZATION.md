# Trading Days Standardization Implementation Summary

## Overview

This implementation standardizes the "1D" horizon across the entire platform, cleanly separating **trading days** from **calendar days** following textbook VaR conventions:

- **1D horizon = 1 trading day** (Friday→Monday is still "1D")
- **Volatility models** (GBM, GARCH) use `h = #trading_days`, not `#calendar_days`
- **Calendar days** (`h_eff_days`) are only for display/annotations and discounting
- **Range model** uses Yang-Zhang as a consistent σ estimator across all days

## ✅ Changes Implemented

### A) Normalized "time" in GBM & GARCH engines

#### 1. **GBM Engine** (`lib/gbm/engine.ts`)
- **BEFORE**: Used `h_eff` (calendar days) in volatility scaling
- **AFTER**: Uses `h_trading` (trading days only) for all calculations:
  ```typescript
  // GBM formulas now use trading days
  const m_t = Math.log(S_t) + muStarUsed * h_trading;
  const s_t = sigmaHat * Math.sqrt(h_trading);
  ```
- **Key Change**: Parameter renamed from `h_eff` → `h_trading` to emphasize trading days usage
- **Impact**: Friday→Monday (1 trading day) uses `√1` scaling, not `√3`

#### 2. **GARCH Multi-Step Variance** (`lib/volatility/piComposer.ts`)
- **CONFIRMED**: Already uses `horizonTrading` parameter correctly
- **Formula**: `σ²_{t+h|t} = σ²_uncond + φ^{h_trading−1} × (σ²_{t+1|t} − σ²_uncond)`
- **Key Point**: Uses trading step count, not calendar days between dates

### B) Calendar days as metadata/display only

#### 3. **Calendar Utilities** (`lib/calendar/service.ts`)
- **Enhanced**: `getNthTradingCloseAfter()` now returns both:
  ```typescript
  {
    verifyDate: string,      // Next h_trading-th trading close date
    calendarDays: number     // Calendar days from origin to verify
  }
  ```
- **Usage**: `calendarDays` used only for display, never in volatility calculations

#### 4. **Forecast Records** (GBM + GARCH)
- **Structure**: All forecasts now store:
  ```typescript
  {
    horizonTrading: number,  // Trading horizon (1,2,3,5) - used in calculations
    h_eff_days: number,      // Calendar days - display only  
    verifyDate: string,      // Verification date - display only
    // ... other fields
  }
  ```

### C) Updated Horizon/Verify Date display semantics

#### 5. **ModelDetails/PriceChart** (`components/PriceChart.tsx`)
- **Display Format**: 
  ```
  HORIZON: "1D (3 calendar days)"     // For Friday→Monday
  HORIZON: "2D (2 calendar days)"     // For Tuesday→Thursday
  ```
- **Key Insight**: Shows both trading and calendar perspectives clearly
- **Math Usage**: All PI calculations use `horizonTrading`, not `h_eff_days`

### D) Yang-Zhang volatility for Range model

#### 6. **Range Model** (`lib/volatility/range.ts`)
- **Enhanced**: Yang-Zhang estimator implementation with proper components:
  - Overnight returns (close→open)
  - Open→close returns  
  - Rogers-Satchell intraday component
  - Yang-Zhang weighting scheme
- **Consistency**: Used across ALL days, no special Friday logic
- **Multi-step**: `σ_YZ × √h_trading` scaling

### E) API Endpoint Updates

#### 7. **GBM API** (`app/api/forecast/gbm/[symbol]/route.ts`)
- **Parameter**: `horizonTrading` (1,2,3,5) in request body
- **Calculation**: Uses `h_trading` in `computeGbmInterval()`, not calendar days
- **Storage**: Stores `calendarDays` as `h_eff_days` for display

#### 8. **Volatility API** (`app/api/volatility/[symbol]/route.ts`) 
- **Fixed**: Now imports and uses `getNthTradingCloseAfter()` properly
- **Parameter**: `h = horizonTrading` passed to `composePi()`
- **Consistency**: Both APIs follow same trading/calendar separation

## ✅ Key Validation Points

### Mathematical Consistency
- **GBM Friday→Monday (h=1)**: Uses `σ × √1` and `μ* × 1`, NOT calendar-based scaling
- **GARCH Multi-step**: Uses `φ^{h_trading−1}` steps, not calendar time
- **Range Yang-Zhang**: Consistent daily σ estimates, weekend captured in returns

### UI/Display Accuracy
- **HORIZON**: Shows "1D (3 calendar days)" for Friday→Monday cases
- **VERIFY DATE**: Shows actual trading close date (Monday for Friday+1D)
- **VaR Diagnostics**: Still refers to 1-trading-day horizon correctly

### API Behavior
- **All endpoints**: Use `horizonTrading` for volatility/drift calculations
- **All forecasts**: Store `h_eff_days` for display metadata
- **Backward compatible**: Existing forecast filtering/calibration works

## ✅ Expected Friday Behavior (Example)

For **AAPL on 2025-10-10 (Friday)** with **horizonTrading=1**, **coverage=95%**:

### Input Parameters:
```
origin_date: "2025-10-10" (Friday)
horizonTrading: 1
coverage: 0.95
```

### Calendar Computation:
```
verifyDate: "2025-10-13" (Monday)  
h_eff_days: 3 (calendar days)
```

### Model Calculations (ALL MODELS):
```
GBM:       μ* × 1,  σ × √1      (NOT μ* × 3, σ × √3)
GARCH11:   φ^0 term in multi-step variance  
Range-YZ:  σ_YZ × √1           (NOT σ_YZ × √3)
```

### UI Display:
```
HORIZON:       "1D (3 calendar days)"
FORECAST DATE: "2025-10-10"  
VERIFY DATE:   "2025-10-13"
```

### VaR Diagnostics:
- Still reference **1-trading-day horizon**
- Weekend P&L naturally captured in Friday→Monday returns
- No special calendar adjustments needed

## ✅ Benefits Achieved

1. **Textbook Consistency**: Follows standard VaR/risk management conventions
2. **Clean Separation**: Trading time (calculations) vs calendar time (display)
3. **Mathematical Accuracy**: Volatility models use correct time scaling
4. **UI Clarity**: Users see both perspectives clearly
5. **Implementation Robustness**: No special-case Friday logic to maintain
6. **Yang-Zhang Integration**: Consistent high-quality volatility estimates
7. **Backward Compatibility**: Existing APIs and data structures preserved

## 🔧 Files Modified

- `lib/gbm/engine.ts` - Trading days in GBM calculations
- `lib/calendar/service.ts` - Enhanced calendar utilities  
- `lib/volatility/range.ts` - Improved Yang-Zhang estimator
- `app/api/forecast/gbm/[symbol]/route.ts` - Trading days usage
- `app/api/volatility/[symbol]/route.ts` - Trading days usage + imports
- `components/PriceChart.tsx` - Display format improvements

## ✅ Testing Validation

All changes validated through:
- **Build Success**: `npm run build` completes without errors
- **Type Safety**: TypeScript compilation passes
- **API Compatibility**: Existing request/response formats preserved
- **Mathematical Verification**: Scaling formulas confirmed correct
- **UI Rendering**: Display strings properly formatted

The implementation successfully standardizes the 1D horizon concept while maintaining full backward compatibility and improving mathematical accuracy across all volatility models.