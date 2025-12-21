# Stable Callback Pattern Implementation
**Date:** December 20, 2025  
**Issue:** Infinite render loop caused by unstable callbacks in useEffect dependencies  
**Solution:** Parent-level stability with proper dependency management

---

## 🎯 Problem Analysis

### Before: Unstable Callback Pattern
```typescript
// ❌ Parent (timing/page.tsx) - Callbacks depend on path data
const handleLoadBiasedClick = useCallback(() => {
  biasedEverLoaded.current = true;
  if (ewmaBiasedPath && ewmaBiasedPath.length > 0) return;  // ❌ Path data in deps
  loadEwmaBiasedWalker();
}, [ewmaBiasedPath, loadEwmaBiasedWalker]);  // ❌ ewmaBiasedPath changes → callback recreated

// ❌ Child (PriceChart.tsx) - Had to disable exhaustive-deps
useEffect(() => {
  if (showBiasedEwma && (!ewmaBiasedPath || ewmaBiasedPath.length === 0) && onLoadEwmaBiased) {
    onLoadEwmaBiased();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps  ❌ Unsafe!
}, [
  showBiasedEwma,
  ewmaBiasedPath,
  // onLoadEwmaBiased  ❌ Omitted to prevent loop, but violates exhaustive-deps
]);
```

### The Loop:
1. `useEffect` calls `onLoadEwmaBiased()` → loads data
2. Data loads → `ewmaBiasedPath` updates
3. Path update → parent recreates `handleLoadBiasedClick` (because `ewmaBiasedPath` is in deps)
4. New callback → `useEffect` sees change → triggers again
5. **INFINITE LOOP** 🔄

---

## ✅ Solution: Parent-Level Stability

### Strategy
Move the deduplication check **from parent to child**:
- Parent callbacks become **unconditionally stable** (only depend on stable load functions)
- Child effect handles the "already loaded" check before calling the callback
- This allows callbacks to be safely included in effect dependencies

---

## 🔧 Implementation

### 1. Parent: Simplified Stable Callbacks

**File:** `app/company/[ticker]/timing/page.tsx`

```typescript
// ✅ AFTER - Stable handlers that only depend on stable load functions
const handleLoadBiasedClick = useCallback(() => {
  biasedEverLoaded.current = true;
  loadEwmaBiasedWalker();  // ✅ Just call - no path checks
}, [loadEwmaBiasedWalker]);  // ✅ loadEwmaBiasedWalker is stable (properly memoized)

const handleLoadBiasedMaxClick = useCallback(() => {
  loadEwmaBiasedMaxWalker();  // ✅ Just call - no path checks
}, [loadEwmaBiasedMaxWalker]);  // ✅ loadEwmaBiasedMaxWalker is stable

const handleLoadUnbiasedClick = useCallback(() => {
  loadEwmaWalker();  // ✅ Just call - no path checks
}, [loadEwmaWalker]);  // ✅ loadEwmaWalker is stable
```

**Key insight:** The load functions (`loadEwmaWalker`, etc.) are already properly memoized:

```typescript
const loadEwmaBiasedWalker = useCallback(async () => {
  // ... API call logic
}, [params?.ticker, h, reactionLambda, coverage, reactionTrainFraction, reactionMinTrainObs, ewmaShrinkK]);
```

These functions only change when their **actual inputs** change (ticker, horizon, params), not when the result data changes. This breaks the circular dependency.

---

### 2. Child: Deduplication Check + Safe Dependencies

**File:** `components/PriceChart.tsx`

```typescript
// ✅ AFTER - Callbacks safely in dependencies with deduplication
useEffect(() => {
  // Dev-only guard: log trigger key to verify effect runs only when intended
  if (process.env.NODE_ENV !== "production") {
    const triggerKey = `${symbol}-mode:${simulationMode.baseMode}-unbiased:${showUnbiasedEwma}-biased:${showBiasedEwma}-paths:${ewmaPath?.length ?? 0}/${ewmaBiasedPath?.length ?? 0}/${ewmaBiasedMaxPath?.length ?? 0}`;
    console.debug("[PriceChart EWMA Load Effect]", triggerKey);
  }

  if (showUnbiasedEwma) {
    // ✅ Check if already loaded BEFORE calling callback
    if ((!ewmaPath || ewmaPath.length === 0) && onLoadEwmaUnbiased) {
      onLoadEwmaUnbiased();
    }
  } else if (showBiasedEwma) {
    const wantsMax = simulationMode.baseMode === "max";
    if (wantsMax) {
      // ✅ Check if already loaded BEFORE calling callback
      if (
        !isLoadingEwmaBiasedMax &&
        (!ewmaBiasedMaxPath || ewmaBiasedMaxPath.length === 0) &&
        onLoadEwmaBiasedMax
      ) {
        onLoadEwmaBiasedMax();
      }
    } else {
      // ✅ Check if already loaded BEFORE calling callback
      if (
        !isLoadingEwmaBiased &&
        (!ewmaBiasedPath || ewmaBiasedPath.length === 0) &&
        onLoadEwmaBiased
      ) {
        onLoadEwmaBiased();
      }
    }
  }
}, [
  symbol,                      // ✅ Ticker change should reload
  showUnbiasedEwma,           // ✅ Mode change should reload
  showBiasedEwma,             // ✅ Mode change should reload
  ewmaPath,                   // ✅ Data presence for dedup check
  ewmaBiasedPath,             // ✅ Data presence for dedup check
  ewmaBiasedMaxPath,          // ✅ Data presence for dedup check
  onLoadEwmaUnbiased,         // ✅ NOW SAFE - stable from parent
  onLoadEwmaBiased,           // ✅ NOW SAFE - stable from parent
  onLoadEwmaBiasedMax,        // ✅ NOW SAFE - stable from parent
  isLoadingEwmaBiased,        // ✅ Prevent duplicate requests
  isLoadingEwmaBiasedMax,     // ✅ Prevent duplicate requests
  simulationMode.baseMode,    // ✅ Mode change should reload
]);
// ✅ NO eslint-disable needed - exhaustive-deps satisfied!
```

---

## 🔍 Dev Guard: Trigger Key Logging

Added diagnostic logging to verify the effect runs only when intended:

```typescript
if (process.env.NODE_ENV !== "production") {
  const triggerKey = `${symbol}-mode:${simulationMode.baseMode}-unbiased:${showUnbiasedEwma}-biased:${showBiasedEwma}-paths:${ewmaPath?.length ?? 0}/${ewmaBiasedPath?.length ?? 0}/${ewmaBiasedMaxPath?.length ?? 0}`;
  console.debug("[PriceChart EWMA Load Effect]", triggerKey);
}
```

**Expected behavior:**
- Logs once on mount: `AAPL-mode:unbiased-unbiased:true-biased:false-paths:0/0/0`
- Logs once after load: `AAPL-mode:unbiased-unbiased:true-biased:false-paths:252/0/0`
- Logs once on mode change: `AAPL-mode:biased-unbiased:false-biased:true-paths:252/0/0`
- **Does NOT log repeatedly** for the same state

---

## 📊 Dependency Chain Analysis

### Load Functions (Already Stable)
```typescript
loadEwmaWalker         → depends on: params.ticker, h, coverage
loadEwmaBiasedWalker   → depends on: params.ticker, h, reactionLambda, coverage, reactionTrainFraction, reactionMinTrainObs, ewmaShrinkK
loadEwmaBiasedMaxWalker → depends on: params.ticker, h, coverage, reactionMinTrainObs, ewmaShrinkK, reactionTrainFraction, getMaxEwmaConfig, biasedMaxCalmarResult
```

These are **stable** because they only change when their **input parameters** change, not when result data changes.

### Handler Functions (Now Stable)
```typescript
handleLoadUnbiasedClick → depends on: loadEwmaWalker ✅
handleLoadBiasedClick   → depends on: loadEwmaBiasedWalker ✅
handleLoadBiasedMaxClick → depends on: loadEwmaBiasedMaxWalker ✅
```

**Stability chain:** Handlers are stable → safe to include in effect dependencies.

### Effect Dependencies (Complete & Safe)
```typescript
useEffect dependencies:
  - symbol                  (changes on ticker switch)
  - showUnbiasedEwma        (changes on mode toggle)
  - showBiasedEwma          (changes on mode toggle)
  - ewmaPath                (for dedup check)
  - ewmaBiasedPath          (for dedup check)
  - ewmaBiasedMaxPath       (for dedup check)
  - onLoadEwmaUnbiased      ✅ STABLE
  - onLoadEwmaBiased        ✅ STABLE
  - onLoadEwmaBiasedMax     ✅ STABLE
  - isLoadingEwmaBiased     (for dedup check)
  - isLoadingEwmaBiasedMax  (for dedup check)
  - simulationMode.baseMode (changes on mode toggle)
```

**No circular dependencies** because:
- Callbacks don't depend on path data anymore
- Effect checks path data before calling callbacks
- Callbacks remain stable when paths change

---

## 🎯 Why This Works

### Pattern: Separate Concerns

1. **Parent Responsibility:** Provide stable callback references
   - Callbacks encapsulate the "how to load" logic
   - Dependencies include only the inputs needed for loading

2. **Child Responsibility:** Decide when to load
   - Effect checks if data is already present
   - Effect triggers on mode changes, ticker changes, etc.
   - Callbacks are just called, not recreated

### Contrast with Previous Approach

| Aspect | Before (eslint-disable) | After (stable callbacks) |
|--------|------------------------|--------------------------|
| Parent callbacks | Depend on path data ❌ | Depend only on load functions ✅ |
| Child effect deps | Incomplete (callbacks omitted) ❌ | Complete (all deps included) ✅ |
| ESLint rule | Disabled ❌ | Satisfied ✅ |
| Stale closures | Risk if callbacks change ⚠️ | No risk - always current ✅ |
| Debugging | Hard to track missing deps ❌ | Clear trigger key logging ✅ |

---

## ✅ Verification Checklist

### Functionality
- [x] EWMA overlays load on initial page load
- [x] EWMA overlays load when toggling modes (Unbiased ↔ Biased ↔ Max)
- [x] EWMA overlays reload when changing horizon/coverage
- [x] No duplicate loading (deduplication works)
- [x] No infinite loops (stable callbacks prevent re-triggering)

### Code Quality
- [x] No `eslint-disable` comments
- [x] All useEffect dependencies satisfied
- [x] TypeScript compilation succeeds with no errors
- [x] Dev guard logs show expected trigger patterns

### Performance
- [x] Effect runs **once** per intended trigger (not on every render)
- [x] No "Maximum update depth exceeded" errors
- [x] Callbacks maintain stable references across renders

---

## 📚 Pattern for Future Reference

When you need to call parent callbacks from child effects:

### ❌ Anti-pattern: Deduplication in Parent
```typescript
// Parent
const handleLoad = useCallback(() => {
  if (data && data.length > 0) return;  // ❌ Depends on result data
  loadData();
}, [data, loadData]);  // ❌ data in deps → callback unstable

// Child
useEffect(() => {
  handleLoad();  // ❌ Can't safely include in deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [/* missing handleLoad */]);
```

### ✅ Correct pattern: Deduplication in Child
```typescript
// Parent
const handleLoad = useCallback(() => {
  loadData();  // ✅ No result checks - just the action
}, [loadData]);  // ✅ Only depends on stable load function

// Child
useEffect(() => {
  if ((!data || data.length === 0) && handleLoad) {  // ✅ Check before calling
    handleLoad();
  }
}, [data, handleLoad]);  // ✅ Safe - handleLoad is stable
```

---

## 🎉 Result

**Stable callbacks + exhaustive-deps compliance = No infinite loops, no stale closures!**

- ✅ ESLint happy (no disabled rules)
- ✅ React happy (no infinite loops)
- ✅ Developers happy (clear, maintainable code)
- ✅ TypeScript happy (no errors)
