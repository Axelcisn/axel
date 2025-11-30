# Auto-Cleanup for Generated Forecast Files

## Summary

I've implemented an auto-cleanup system that automatically deletes generated forecast files when you refresh or close the browser window. This prevents your data directory from accumulating hundreds of temporary files.

## How It Works

### 1. File Generation Tracking
When you click "Generate", the system now tracks the timestamp IDs of all generated forecast files:
- `2024-10-10_GBM-CC_1764309461545.json`
- `2024-10-10_Range-YZ_1764309496874.json`
- etc.

### 2. Auto-Cleanup Events
The system automatically cleans up tracked files when:
- **Page Refresh** (F5 or browser refresh button)
- **Window Close** (closing the browser tab/window)  
- **Tab Switch** (switching to another tab)
- **Page Navigation** (navigating away from the timing page)
- **Component Unmount** (React component cleanup)

### 3. Backend Cleanup API
Created `/api/cleanup/forecasts` endpoint that:
- Accepts arrays of file IDs to delete
- Safely removes only .json files from forecasts directory
- Uses `sendBeacon` for reliable cleanup during page unload
- Provides fallback for browsers without sendBeacon support

## Implementation Details

### Frontend Changes:
1. **Custom Hook** (`useAutoCleanupForecasts.ts`):
   - Tracks generated file IDs in memory
   - Sets up event listeners for cleanup triggers
   - Uses `navigator.sendBeacon()` for reliable unload cleanup

2. **Timing Page Integration**:
   - Imports and initializes the auto-cleanup hook
   - Tracks file IDs returned from forecast generation APIs
   - Automatically cleans up on component unmount

### Backend Changes:
1. **Enhanced File Generation** (`generateBaseForecasts.ts`):
   - Modified to return generated file timestamp IDs
   - Added tracking to the generation result interface

2. **Cleanup API Endpoint** (`/api/cleanup/forecasts/route.ts`):
   - POST endpoint for bulk file cleanup by ID
   - DELETE endpoint for pattern-based cleanup  
   - Safe file validation (only .json files in forecasts directory)

## Benefits

✅ **No More File Accumulation**: Prevents hundreds of temporary files from building up
✅ **Automatic**: Works transparently without user intervention  
✅ **Safe**: Only deletes files generated in the current session
✅ **Reliable**: Uses browser APIs designed for cleanup during page unload
✅ **Non-Breaking**: Existing functionality unchanged, only adds cleanup

## Testing

The system is now active. When you:
1. Click "Generate" to create forecast files
2. Refresh the page or close the window
3. The generated files will be automatically deleted

You can verify this by:
- Checking the console logs for cleanup messages
- Looking in the `data/forecasts/[SYMBOL]/` directory before and after refresh

## Browser Compatibility

- **Modern Browsers**: Uses `navigator.sendBeacon()` for optimal reliability
- **Legacy Browsers**: Fallback to `fetch()` with `keepalive: true`
- **All Browsers**: Event listeners for multiple cleanup triggers

The auto-cleanup feature is now fully functional and will keep your data directory clean!