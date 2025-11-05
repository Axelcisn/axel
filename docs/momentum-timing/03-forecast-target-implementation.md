# Momentum Timing — 03. Forecast Target Spec Implementation

## Overview
Complete implementation of the **Forecast Target** card allowing users to set horizon (`h`), coverage, and confirm target variable and cutoff rule, with dependency on timezone resolution.

## Implementation Status: ✅ COMPLETE

### Files Created/Updated

#### 1. Types & Data Contracts
- **`/lib/types/targetSpec.ts`** - TargetSpec, TargetSpecResult interfaces

#### 2. Storage Layer
- **`/lib/storage/targetSpecStore.ts`** - Atomic JSON persistence for target specs

#### 3. API Endpoints
- **`/app/api/canonical/[symbol]/route.ts`** - GET canonical metadata (exchange_tz dependency)
- **`/app/api/target-spec/[symbol]/route.ts`** - GET/POST target spec management

#### 4. User Interface
- **`/app/company/[ticker]/timing/page.tsx`** - Added Forecast Target card with full functionality

#### 5. Directory Structure
- **`/data/specs/`** - Directory for target spec persistence

### Key Features Implemented

#### ✅ Horizon Controls
- Segmented buttons: 1D (default), 2D, 3D, 5D
- Numeric input with validation (h ≥ 1)
- State management with immediate UI feedback

#### ✅ Coverage Controls  
- Segmented buttons: 90%, 95% (default), 97.5%
- Numeric input with validation (0.50 < coverage ≤ 0.995)
- Decimal storage (e.g., 0.95 for 95%)

#### ✅ Read-only Fields
- **Target Variable**: "NEXT_CLOSE_ADJ" (locked)
- **Cutoff**: "compute at t close; verify at t+1 close" (locked)

#### ✅ Timezone Dependency
- Reads `exchange_tz` from canonical metadata first
- Falls back to calendar service resolution
- Blocks save when timezone unknown
- Clear error messaging for timezone issues

#### ✅ Validation System
- Horizon validation: h ≥ 1
- Coverage validation: 0.50 < coverage ≤ 0.995  
- Timezone validation: exchange_tz must be resolved
- Visual feedback with error states

#### ✅ Persistence
- Atomic writes to `/data/specs/{symbol}-target.json`
- Includes updated_at timestamp
- Survives page reload
- Toast notifications on save

#### ✅ Provenance Display
- Header shows: "Target: NEXT_CLOSE_ADJ @ 95% • h=1 • cutoff: t→t+1 (TZ: America/New_York)"
- Updates immediately after save

### Technical Specifications Met

#### ✅ API Contracts
```typescript
GET /api/target-spec/{symbol}
Response: TargetSpecResult with spec and meta (hasTZ, source)

POST /api/target-spec/{symbol}  
Body: { h: number, coverage: number }
Response: TargetSpec with all fields populated
```

#### ✅ Data Contract
```typescript
TargetSpec {
  symbol: string;
  exchange?: string | null;
  exchange_tz: string;      // IANA timezone (required)
  h: number;                // horizon in trading days
  coverage: number;         // decimal (e.g., 0.95)
  variable: "NEXT_CLOSE_ADJ";
  cutoff_note: string;
  updated_at: string;       // ISO timestamp
}
```

#### ✅ Reference Text (Exact)
```
Target (future observation): y_{t+1} = AdjClose_{t+1}
"Prediction Interval (PI)" for y_{t+1} at coverage 1−α
```

#### ✅ Methods Tooltip
- Explains PIs are for **future observations**
- Notes **out-of-sample (OOS)** verification with rolling-origin
- Describes target variable purpose

### Validation Rules Implemented

#### ✅ Save Blocking Conditions
1. **Timezone Missing**: `exchange_tz` not resolved → "Exchange time zone not resolved. Upload canonical data or set primary listing."
2. **Invalid Horizon**: `h < 1` → "Horizon must be ≥ 1"  
3. **Invalid Coverage**: `coverage ∉ (0.50, 0.995]` → "Coverage must be in range (0.50, 0.995]"

#### ✅ Edge Cases Handled
- Symbol's canonical JSON not found → show defaults, disable save until TZ resolved
- Network failures → graceful error handling
- Invalid input types → validation with visual feedback

### Terminology Compliance

#### ✅ "Prediction Interval (PI)" Only
- NO references to "confidence interval"
- Consistent PI terminology throughout
- Reference text explicitly states "Prediction Interval (PI)"

### Default Behavior

#### ✅ Default Proposal (when no existing spec)
- `h = 1` (1D horizon)
- `coverage = 0.95` (95%)
- `variable = "NEXT_CLOSE_ADJ"`
- `cutoff_note = "compute at t close; verify at t+1 close"`
- `exchange_tz` from canonical or calendar service

### File Structure Created
```
/data/specs/{symbol}-target.json
```

Example content:
```json
{
  "symbol": "AMD",
  "exchange": "NASDAQ", 
  "exchange_tz": "America/New_York",
  "h": 1,
  "coverage": 0.95,
  "variable": "NEXT_CLOSE_ADJ",
  "cutoff_note": "compute at t close; verify at t+1 close",
  "updated_at": "2025-11-06T10:30:00.000Z"
}
```

### User Experience

#### ✅ Card Layout (data-testid="card-forecast-target")
1. **Horizon Section**: Segmented buttons + numeric input
2. **Coverage Section**: Segmented buttons + numeric input  
3. **Read-only Sections**: Target variable and cutoff
4. **Save Button**: Disabled when invalid/no TZ
5. **Reference Text**: Exact mathematical notation
6. **Methods Tooltip**: Expandable details

#### ✅ State Management
- Loads existing spec on mount
- Real-time validation feedback
- Success/error messaging
- Immediate provenance update

### Acceptance Criteria: ✅ COMPLETE

✅ **Files created** at exact specified paths  
✅ **API dependency check** reads exchange_tz from canonical, falls back to calendar service  
✅ **Validation** blocks save for timezone/horizon/coverage issues  
✅ **Terminology** uses "Prediction Interval (PI)" exclusively  
✅ **Persistence** creates `/data/specs/{symbol}-target.json` with all fields  
✅ **Reference text** renders exact specified lines  
✅ **Card survives** page reload with persisted data  
✅ **Toast notification** on successful save  
✅ **Provenance display** in header after save  

### Next Steps
Ready for **Step 4: GBM Baseline** implementation.

### Testing
- Navigate to `/company/AMD/timing`
- Forecast Target card appears above upload section
- All controls functional with validation
- Save disabled until timezone resolved (upload data first)
- Persistence verified across page reloads

### Development Server
Running on http://localhost:3001