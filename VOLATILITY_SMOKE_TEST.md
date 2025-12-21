# Volatility Models Smoke Test

Comprehensive smoke test for all volatility model variants in the `/api/volatility` endpoint.

## Usage

```bash
npx tsx scripts/smoke-volatility-models.ts \
  --baseUrl=http://localhost:3000 \
  --symbols=KO \
  --random=3 \
  --seed=42 \
  --window=504 \
  --lambda=0.94 \
  --h=1 \
  --cov=0.95
```

## CLI Arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `--baseUrl` | `http://localhost:3000` | API base URL |
| `--symbols` | `KO` | Comma-separated mandatory symbols |
| `--random` | `3` | Number of random symbols to add |
| `--seed` | `42` | RNG seed for reproducible random selection |
| `--window` | `504` | Lookback window for volatility models |
| `--lambda` | `0.94` | EWMA lambda for drift and Range models |
| `--h` | `1` | Forecast horizon (trading days) |
| `--cov` | `0.95` | Coverage level (e.g., 0.95 = 95%) |

## Models Tested

### Required Models (fail on error)
- **GBM-CC**: Geometric Brownian Motion with Close-to-Close
- **GARCH11-N**: GARCH(1,1) with Normal distribution
- **GARCH11-t**: GARCH(1,1) with Student-t distribution
- **Range-P**: Parkinson range estimator
- **Range-GK**: Garman-Klass range estimator
- **Range-RS**: Rogers-Satchell range estimator
- **Range-YZ**: Yang-Zhang range estimator

### Optional Models (skipped if data unavailable)
- **HAR-RV**: Heterogeneous Autoregressive Realized Volatility (requires RV data)

## Symbol Selection

**Mandatory:** Always includes KO (Coca-Cola)

**Random:** Selects N random symbols from `data/canonical/*.json` with:
- Exclusions: ABT, NUE, AIG, KMI, SWK, KO (prior smoke test symbols)
- Filter: Only A-Z0-9 alphanumeric symbols
- Seeded RNG for reproducible results

## Output Format

For each symbol, displays a table with:

```
Model           Status   Result    Method       σ₁d        ŷ          L_h        U_h        BW%
-------------------------------------------------------------------------------
GBM             200      OK        GBM-CC       -          69.14      67.84      70.46      3.78
GARCH11-N       200      OK        GARCH11-N    0.0095     69.11      -          -          -
Range-P         200      OK        Range-P      0.0090     69.11      -          -          -
HAR-RV          422      SKIPPED   -            -          -          -          -          -
  └─ Error: RV data not available
```

Where:
- **Status**: HTTP status code (200 = success)
- **Result**: OK (green), FAIL (red), or SKIPPED (yellow)
- **Method**: Response method string (validated against request)
- **σ₁d**: One-day-ahead volatility forecast
- **ŷ**: Expected price at horizon h
- **L_h, U_h**: Lower and upper forecast bounds
- **BW%**: Bandwidth percentage = (U_h - L_h) / ŷ × 100

## Exit Codes

- **0**: All required models passed (HAR-RV skips are OK)
- **1**: Any required model failed or returned unexpected results

## Validation

The script validates:

1. **HTTP Status**: Must be 200 for required models
2. **Method Match**: Response `method` must start with requested model family (e.g., "Range-GK" for Range-GK)
3. **Error Handling**: 404 for missing symbols, 400 for OHLC issues, 422 for insufficient data
4. **HAR-RV Special**: Returns 422 with `INSUFFICIENT_HAR_DATA` code when RV unavailable → marked SKIPPED

## Example Run

```bash
$ npx tsx scripts/smoke-volatility-models.ts --symbols=KO --random=3 --seed=42

🔥 Volatility Models Smoke Test

Configuration:
  Base URL:       http://localhost:3000
  Horizon (h):    1
  Coverage:       0.95
  Window:         504
  Lambda:         0.94
  Random count:   3
  Seed:           42

Testing 4 symbols:
  Mandatory:      KO
  Random:         DUK, FTNT, SO

Testing 8 models:
  - GBM
  - GARCH11-N
  - GARCH11-t
  - Range-P
  - Range-GK
  - Range-RS
  - Range-YZ
  - HAR-RV (optional)

================================================================================
SYMBOL: KO
================================================================================
Model           Status   Result    Method       σ₁d        ŷ          L_h        U_h        BW%
--------------------------------------------------------------------------------
GBM             200      OK        GBM-CC       -          69.14      67.84      70.46      3.78
GARCH11-N       200      OK        GARCH11-N    0.0095     69.11      -          -          -
GARCH11-t       200      OK        GARCH11-t    0.0095     69.11      -          -          -
Range-P         200      OK        Range-P      0.0090     69.11      -          -          -
Range-GK        200      OK        Range-GK     0.0091     69.11      -          -          -
Range-RS        200      OK        Range-RS     0.0091     69.11      -          -          -
Range-YZ        200      OK        Range-YZ     0.0107     69.11      -          -          -
HAR-RV          422      SKIPPED   -            -          -          -          -          -
  └─ Error: RV data not available

================================================================================
SUMMARY
================================================================================
Total tests:    32
✓ Passed:       28
✗ Failed:       0
⊘ Skipped:      4
================================================================================

✅ SMOKE TEST PASSED
```

## Implementation Details

### Request Format

```typescript
POST /api/volatility/{symbol}
Content-Type: application/json

{
  "model": "Range-GK",
  "params": {
    "range": {
      "window": 504,
      "ewma_lambda": 0.94
    }
  },
  "h": 1,
  "coverage": 0.95
}
```

### Sequential Execution

- Requests are sent sequentially (not parallel) to avoid overwhelming the dev server
- 100ms delay between requests
- 20-second timeout per request

### Error Handling

- **404**: Symbol not found in `data/canonical/`
- **400**: Range estimators missing OHLC data (<80% coverage)
- **422**: Insufficient data for model (window too large, etc.)
- **500**: Unexpected server error (treated as FAIL)

## Use Cases

1. **Pre-deployment validation**: Ensure all volatility models work before deploying
2. **Regression testing**: Verify API changes don't break existing models
3. **Data quality check**: Validate OHLC data availability for Range estimators
4. **Performance baseline**: Track API response times across models

## Related Files

- **API Route**: `app/api/volatility/[symbol]/route.ts`
- **Data Loader**: `lib/data/loadCanonicalRows.ts`
- **Range Models**: `lib/volatility/range.ts`
- **GARCH Models**: `lib/volatility/garch.ts`
- **GBM Engine**: `lib/gbm/engine.ts`
- **HAR Models**: `lib/volatility/har.ts`
