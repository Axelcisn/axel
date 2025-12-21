# Shared Canonical Data Loader Implementation

## Problem
The `/api/volatility` and `/api/history` routes used different data loading mechanisms, causing `/api/volatility/ASML` to fail with 500 "No canonical data found for ASML" despite the file existing and `/api/history/ASML` working correctly.

## Root Cause
- **History route**: Used `loadCanonicalDataWithMeta()` with fetch(), then caught errors and tried Yahoo
- **Volatility route**: Used `ensureCanonicalOrHistory()` with filesystem loader, had divergent path resolution
- Result: Same symbol worked in one route but not the other

## Solution
Created a single source of truth for canonical data loading:

### 1. New Shared Loader
**`lib/data/loadCanonicalRows.ts`**
- Single function: `loadCanonicalRows(symbol: string)`
- Built-in symbol normalization: `symbol.toUpperCase()`
- Consistent path: `data/canonical/{SYMBOL}.json`
- Returns just the rows array (no meta)
- Proper error codes: throws Error with `code: 'ENOENT'` if file not found

### 2. Updated Routes

**`app/api/history/[symbol]/route.ts`**
```typescript
// Before: loadCanonicalDataWithMeta(symbol)
// After:  loadCanonicalRows(symbol)
let rows = await loadCanonicalRows(symbol);
```

**`app/api/volatility/[symbol]/route.ts`**
```typescript
// Before: ensureCanonicalOrHistory(symbol, { minRows: 0 })
// After:  loadCanonicalRows(symbol)
let canonicalData = await loadCanonicalRows(symbol);
```

**`lib/volatility/range.ts`**
```typescript
// Before: loadCanonicalDataFromFS() with fetch() fallback
// After:  loadCanonicalRows(symbol)
const data = await loadCanonicalRows(symbol);
```

### 3. HTTP Status Code Improvements
- **404**: File not found (`code === 'ENOENT'`) → `{ error: "No history for symbol", symbol }`
- **400**: Range estimator missing OHLC → `{ error: "Range requires OHLC high/low", symbol }`
- **422**: Insufficient data for model → `{ error: "Insufficient data...", code: 'INSUFFICIENT_*' }`

## Results

### Before
```bash
curl -X POST http://localhost:3001/api/volatility/ASML \
  -d '{"model":"Range-GK","params":{"range":{"window":504,"ewma_lambda":0.94}}}'
# Response: 500 "No canonical data found for ASML"
```

### After
```bash
curl -X POST http://localhost:3001/api/volatility/ASML \
  -d '{"model":"Range-GK","params":{"range":{"window":504,"ewma_lambda":0.94}}}'
# Response: 200 { "method": "Range-GK", "sigma_1d": 0.0169, ... }
```

## Removed Code
- Removed all diagnostic logging scaffolding from volatility route
- Removed `ensureCanonicalOrHistory()` complexity from volatility route
- Removed dual-mode FS/fetch fallback logic from `range.ts`
- Removed `loadCanonicalDataFromFS()` and `loadCanonicalDataWithMeta()` imports

## Acceptance Criteria
✅ `/api/volatility/ASML` returns 200 with method "Range-GK"  
✅ `/api/history/ASML` still works (7745 rows)  
✅ Missing symbols return 404 (not 500)  
✅ Range model validates OHLC availability (returns 400 if <80% coverage)  
✅ No TypeScript compilation errors  
✅ All routes use the SAME data loading function  

## Files Changed
- `lib/data/loadCanonicalRows.ts` (NEW)
- `app/api/history/[symbol]/route.ts`
- `app/api/volatility/[symbol]/route.ts`
- `lib/volatility/range.ts`
