# Y_hat Implementation Verification Guide

## 🎯 Quick Verification Steps

### 1. Check that y_hat field is being added to new forecasts

**Test Method**: Generate a new forecast and inspect the saved JSON

```bash
# Navigate to your forecasts directory
cd data/forecasts/AAPL  # or any symbol you have

# Look at the newest forecast file
ls -lt | head -5

# Inspect the content for y_hat field
cat [newest-forecast-file].json | grep -A 5 -B 5 "y_hat"
```

**Expected Result**: Should see a line like:
```json
"y_hat": 185.67,
```

### 2. Verify model prediction line is using real forecasts

**Test Method**: Check the API response

```bash
# Test the model-line API
curl "http://localhost:3001/api/forecast/model-line/AAPL?method=GBM-CC&window=50"
```

**Expected Result**: 
- Response should contain `model_price` values that are NOT identical to realized prices
- Check the browser console for "[PREDICTION OK]" messages

### 3. Visual verification in the UI

**Test Steps**:
1. Go to `/company/AAPL/timing` page
2. Generate a new forecast using any volatility model
3. Look at the chart with the model prediction line
4. Verify the prediction line is NOT perfectly following the actual price line

**Expected Result**: 
- Model line should show smooth, predictive behavior
- Should not be identical to the realized price series
- May show trends or drifts based on the model

### 4. Console log verification

**Test Method**: 
1. Open browser developer tools (Console tab)
2. Generate new forecasts or view existing model lines
3. Look for debug messages

**Expected Messages**:
```
[PREDICTION OK] 2024-01-15: y_pred=185.67, realized=184.23, diff=1.44, source=y_hat
[PREDICTION OK] 2024-01-16: y_pred=186.12, realized=183.45, diff=2.67, source=y_hat
```

**Warning Messages** (these indicate potential issues):
```
[PREDICTION WARNING] 2024-01-15: prediction (184.23) ≈ tomorrow's price (184.24) - source: m_log
```

### 5. Backwards compatibility test

**Test Method**: Use old forecast files without y_hat

**Expected Result**: 
- Old forecasts should still work
- Console should show `source=geometric_mean` or `source=m_log`
- No errors in the application

## 🚨 Red Flags to Watch For

### ❌ Bad Signs
- Model prediction line exactly matches realized prices
- Console shows many "[PREDICTION WARNING]" messages
- New forecast files missing y_hat field
- API returns identical model_price and actual price values

### ✅ Good Signs  
- Model prediction line shows smooth, forward-looking behavior
- Console shows "[PREDICTION OK]" messages with `source=y_hat`
- New forecasts contain populated y_hat field
- Prediction vs realized price differences are reasonable (not zero)

## 🔧 Troubleshooting

### If y_hat is missing from new forecasts:
- Check that the volatility API is using the updated route
- Verify computeGbmExpectedPrice import is working
- Look for TypeScript compilation errors

### If model line still looks like tomorrow's prices:
- Check that loadBaseForecastPairs is prioritizing y_hat
- Verify the model-line API is calling the updated function
- Look for caching issues in the browser

### If console shows warnings:
- Old forecasts without y_hat will show warnings (expected)
- New forecasts showing warnings indicate implementation issues
- Check the mathematical calculation in y_hat computation

## 📊 Expected Mathematical Behavior

### GBM Forecasts (with drift):
```
If S_t = $100, mu_star_used = 0.05, h = 1 day
Then y_hat = 100 * exp(0.05 * 1) = $105.13
```

### Zero-drift models (Range, HAR):
```
y_hat should equal current price (no expected price change)
```

### Negative drift:
```
If mu_star_used = -0.02
Then y_hat = 100 * exp(-0.02 * 1) = $98.02
```

Run through these verification steps to ensure the y_hat implementation is working correctly!