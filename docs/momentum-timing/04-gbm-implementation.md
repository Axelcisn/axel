# Momentum Timing — 04. GBM Baseline PI Engine Implementation

## Overview
Complete implementation of the **GBM baseline PI** engine with window controls, drift shrinkage λ, day-ahead prediction intervals using canonical dataset and Target Spec, immutable forecast persistence, and comprehensive UI rendering.

## Implementation Status: ✅ COMPLETE

### Files Created/Updated

#### 1. Forecast Type System
- **`/lib/forecast/types.ts`** - ForecastRecord, ForecastParams, GbmEstimates interfaces

#### 2. Immutable Storage Layer
- **`/lib/forecast/store.ts`** - Atomic forecast persistence with locked records

#### 3. GBM Engine Core
- **`/lib/gbm/engine.ts`** - Complete GBM computation with exact MLE formulas

#### 4. API Endpoints
- **`/app/api/forecast/gbm/[symbol]/route.ts`** - GET/POST forecast management

#### 5. User Interface Enhancement
- **`/app/company/[ticker]/timing/page.tsx`** - Added GBM card and Final PI card

#### 6. Directory Structure
- **`/data/forecasts/`** - Directory for immutable forecast records

### Key Features Implemented

#### ✅ GBM Engine (Exact Specifications)
```typescript
// MLE with denominator N
mu_star_hat = mean(r_window)
sigma_hat = sqrt((1/N) * Σ(r_i − mu_star_hat)²)
mu_star_used = λ * mu_star_hat

// PI Components (log scale)
m_t(h) = ln(S_t) + h * mu_star_used
s_t(h) = sigma_hat * sqrt(h)
z_α = Φ⁻¹(1 − α/2)
L_h = exp(m_t(h) − z_α * s_t(h))
U_h = exp(m_t(h) + z_α * s_t(h))
band_width_bp = 10000 * (U_1 / L_1 − 1)
```

#### ✅ Normal Inverse CDF Implementation
- **Beasley-Springer-Moro algorithm** for Φ⁻¹ computation
- No external dependencies required
- High precision for critical values

#### ✅ Controls & Parameters
- **Window Length**: 252, 504, 756 trading days (default 504)
- **Drift Shrinkage**: λ ∈ [0,1] with slider control (default 0.25)
- **Target Integration**: Reads h and coverage from Target Spec
- **Canonical Integration**: Uses adj_close series with validation

#### ✅ Immutable Forecast Records
- **Persistence**: `/data/forecasts/{symbol}/{date_t}-gbm.json`
- **Locked Flag**: `locked: true` prevents overwriting
- **Atomic Writes**: Temp file → rename pattern
- **Timestamping**: ISO `created_at` for audit trail

#### ✅ Edge Case Handling
- **Insufficient History**: N < window → 422 "Insufficient history (N<window)"
- **Zero Volatility**: σ < 1e-8 → 422 "Vol too small to form PI"
- **Missing Dependencies**: Target Spec/canonical → 400 with clear messages
- **Invalid Prices**: Non-positive prices filtered and validated

### API Implementation

#### ✅ GET `/api/forecast/gbm/{symbol}`
- **Query Param**: `?date=YYYY-MM-DD` (optional)
- **Response**: Latest or specific ForecastRecord
- **Status**: 404 if no forecast found

#### ✅ POST `/api/forecast/gbm/{symbol}`
- **Body**: `{ date_t?, window?, lambda_drift? }`
- **Validation**: Window ∈ {252,504,756}, λ ∈ [0,1]
- **Processing**: Compute → persist → return ForecastRecord
- **Error Handling**: Proper HTTP status codes for all edge cases

### UI Components

#### ✅ GBM Card (`data-testid="card-gbm"`)
- **Window Selector**: Segmented buttons for 252/504/756
- **Lambda Slider**: Range input 0-1 with live value display
- **Generate Button**: Triggers computation with loading state
- **Estimates Display**: μ*, σ, λ, window dates, N with "MLE denominator N" note
- **Methods Tooltip**: Complete formula reference

#### ✅ Final PI Card (`data-testid="card-final-pi"`)
- **Method Chip**: 🔒 GBM-CC with lock icon
- **PI Values**: L₁, U₁, band width (bp), critical z_α
- **Technical Details**: Coverage, horizon, as-of date, window, drift shrinkage
- **Creation Timestamp**: Locked record audit trail
- **Placeholder**: "No forecast yet" when empty

### Data Contracts

#### ✅ ForecastRecord Structure
```typescript
{
  symbol: string;
  date_t: string;           // YYYY-MM-DD as-of date
  method: "GBM-CC";         // Method identifier
  params: {
    window: number;         // 252|504|756
    lambda_drift: number;   // [0,1]
    coverage: number;       // From Target Spec
    h: number;              // From Target Spec
  };
  estimates: {
    mu_star_hat: number;    // MLE mean
    sigma_hat: number;      // MLE volatility
    mu_star_used: number;   // Shrunk drift
    window_start: string;   // YYYY-MM-DD
    window_end: string;     // YYYY-MM-DD
    n: number;              // Effective N
  };
  critical: {
    type: "normal";
    z_alpha: number;        // Critical value
  };
  m_log: number;            // Log-scale mean
  s_scale: number;          // Scale parameter
  L_h: number;              // Lower bound
  U_h: number;              // Upper bound
  band_width_bp: number;    // Basis points width
  locked: true;             // Immutability flag
  created_at: string;       // ISO timestamp
}
```

### Terminology Compliance

#### ✅ "Prediction Interval (PI)" Only
- All UI text uses **"Prediction Interval (PI)"**
- No "confidence interval" references anywhere
- Methods tooltip emphasizes PI for **future observations**
- Cards and API consistently use PI terminology

### Integration Dependencies

#### ✅ Target Spec Integration
- Reads `h` (horizon) and `coverage` from saved Target Spec
- Blocks generation if Target Spec missing
- Inherits timezone validation requirements

#### ✅ Canonical Data Integration
- Uses `adj_close` series from canonical dataset
- Validates data quality and price positivity
- Respects existing data validation from Step 2

### Validation & Error Handling

#### ✅ Parameter Validation
- **Window**: Must be 252, 504, or 756
- **Lambda**: Must be between 0 and 1
- **Date**: Must exist in canonical data
- **History**: Sufficient observations for window

#### ✅ Statistical Validation
- **Volatility Check**: σ > 1e-8 required
- **Price Validation**: Non-positive prices rejected
- **Return Computation**: Uses existing canonical log returns

#### ✅ HTTP Status Codes
- **200**: Successful forecast generation/retrieval
- **400**: Missing dependencies (Target Spec, canonical data)
- **404**: No forecast found for GET requests
- **422**: Statistical issues (insufficient history, zero volatility)
- **500**: Unexpected server errors

### Flow & User Experience

#### ✅ Complete Workflow
1. **Upload data** → canonical dataset created
2. **Set target spec** → h, coverage, timezone validated  
3. **Generate GBM PI** → computation with parameters
4. **View results** → Final PI card updates immediately
5. **Locked persistence** → immutable forecast records

#### ✅ Real-time Feedback
- Loading states during computation
- Clear error messaging for all failure modes
- Immediate UI updates after successful generation
- Parameter validation with visual feedback

### Performance & Reliability

#### ✅ Atomic Operations
- Forecast persistence uses temp file → rename
- No partial writes or corruption possible
- Concurrent-safe file operations

#### ✅ Memory Efficiency
- Streams large datasets without loading all in memory
- Efficient log return computation
- Minimal object allocation in hot paths

### Acceptance Criteria: ✅ COMPLETE

✅ **API Endpoints** return correct ForecastRecord with method="GBM-CC"  
✅ **Persistence** creates `/data/forecasts/{symbol}/{date}-gbm.json` with locked=true  
✅ **Edge Cases** return 422 for N<window and σ≈0, 400 for missing dependencies  
✅ **UI Cards** show GBM controls and Final PI with correct values and method chip  
✅ **Formulas** implemented exactly as specified with MLE denominator N  
✅ **Immutability** prevents overwriting with lock icon and created_at display  
✅ **Parameters** h and coverage come from Target Spec integration  
✅ **Terminology** uses "Prediction Interval (PI)" exclusively  

### File Structure Generated
```
/data/forecasts/{symbol}/{date_t}-gbm.json
```

Example content:
```json
{
  "symbol": "AMD",
  "date_t": "2024-12-31",
  "method": "GBM-CC",
  "params": {
    "window": 504,
    "lambda_drift": 0.25,
    "coverage": 0.95,
    "h": 1
  },
  "estimates": {
    "mu_star_hat": 0.001234,
    "sigma_hat": 0.023456,
    "mu_star_used": 0.000309,
    "window_start": "2023-01-03",
    "window_end": "2024-12-31",
    "n": 503
  },
  "critical": {
    "type": "normal",
    "z_alpha": 1.96
  },
  "m_log": 4.123456,
  "s_scale": 0.023456,
  "L_h": 58.42,
  "U_h": 65.78,
  "band_width_bp": 1260,
  "locked": true,
  "created_at": "2025-11-06T15:30:00.000Z"
}
```

### Next Steps
Ready for **Step 5: GARCH/HAR Volatility Models** implementation.

### Testing Instructions
1. Navigate to `/company/AMD/timing`
2. Upload data to create canonical dataset
3. Set target specification (required for generation)
4. Use GBM card controls to adjust window/lambda
5. Click "Generate GBM PI" to compute forecast
6. Verify Final PI card updates with locked record
7. Check persistence in `/data/forecasts/AMD/` directory

### Development Server
Running on http://localhost:3001 with complete GBM functionality.