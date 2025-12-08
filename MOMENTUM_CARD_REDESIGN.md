# Price Momentum Card Redesign

## Changes to make the layout more professional:

### 1. **Increase padding**: Change `p-4 sm:p-5` to `p-6` for consistent spacing

### 2. **Improve header spacing**: 
- Change `mb-4` to `mb-6`
- Change `gap-2.5` to `gap-3` 
- Change `gap-1` to `gap-2`

### 3. **Enlarge title**: Change `text-sm` to `text-base` for "Price Momentum"

### 4. **Better button styling**:
- Change `px-2 py-1` to `px-3 py-1.5`
- Change `text-[11px]` to `text-xs font-medium`
- Add `transition-all` for smooth hover
- Change `bg-slate-900` to `bg-slate-900/50`
- Change `hover:border-slate-500` to `hover:border-slate-600`

### 5. **Reorganize regime section**:
- Wrap in a bordered card: `rounded-xl border border-slate-800 bg-slate-900/30 p-4`
- Add section header: `text-xs font-medium uppercase tracking-wider text-slate-500 mb-2`
- Make regime text larger: Change `text-xl` to `text-2xl font-bold`
- Improve description text: Change `text-[11px]` to `text-sm` and add `leading-relaxed`

### 6. **Better metrics layout**:
- Wrap metrics in a card: `rounded-xl border border-slate-800 bg-slate-900/30 p-4`
- Add section header like regime
- Use 2-column grid: `grid grid-cols-2 gap-4`
- Stack label and value vertically
- Make values larger: Change sizes to `text-lg font-bold`

### 7. **Improve signals panel**:
- Increase padding: `p-5` instead of `p-3 sm:p-4`
- Better section title styling
- Add dividers between signal items
- Stack signal info vertically for clarity

This will create a cleaner, more organized professional layout with better visual hierarchy.
