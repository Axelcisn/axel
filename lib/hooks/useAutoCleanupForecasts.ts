import { useEffect, useRef, useCallback } from 'react';

interface GeneratedFile {
  symbol: string;
  fileId: string;
  timestamp: number;
}

/**
 * Custom hook to track generated forecast files and auto-delete them
 * when the user refreshes or closes the window
 */
export function useAutoCleanupForecasts(symbol: string) {
  const generatedFilesRef = useRef<GeneratedFile[]>([]);
  const cleanupInProgressRef = useRef(false);

  // Function to track a newly generated file
  const trackGeneratedFile = useCallback((fileId: string) => {
    const file: GeneratedFile = {
      symbol,
      fileId,
      timestamp: Date.now()
    };
    
    generatedFilesRef.current.push(file);
    console.log(`[AutoCleanup] Tracking file: ${fileId} for symbol ${symbol}`);
  }, [symbol]);

  // Function to clean up all tracked files
  const cleanupTrackedFiles = useCallback(async () => {
    if (cleanupInProgressRef.current || generatedFilesRef.current.length === 0) {
      return;
    }

    cleanupInProgressRef.current = true;
    
    try {
      const fileIds = generatedFilesRef.current
        .filter(f => f.symbol === symbol)
        .map(f => f.fileId);

      if (fileIds.length === 0) {
        return;
      }

      console.log(`[AutoCleanup] Cleaning up ${fileIds.length} files for ${symbol}`);

      // Use sendBeacon for cleanup during page unload (more reliable)
      if (navigator.sendBeacon) {
        const cleanupData = JSON.stringify({ symbol, fileIds });
        const blob = new Blob([cleanupData], { type: 'application/json' });
        navigator.sendBeacon('/api/cleanup/forecasts', blob);
        console.log(`[AutoCleanup] Sent beacon cleanup request for ${fileIds.length} files`);
      } else {
        // Fallback for browsers without sendBeacon
        await fetch('/api/cleanup/forecasts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, fileIds }),
          keepalive: true
        });
        console.log(`[AutoCleanup] Sent fetch cleanup request for ${fileIds.length} files`);
      }

      // Clear the tracked files
      generatedFilesRef.current = generatedFilesRef.current.filter(f => f.symbol !== symbol);
    } catch (error) {
      console.error('[AutoCleanup] Error during cleanup:', error);
    } finally {
      cleanupInProgressRef.current = false;
    }
  }, [symbol]);

  // Function to clear tracking without cleanup (for manual cleanup)
  const clearTracking = useCallback(() => {
    generatedFilesRef.current = generatedFilesRef.current.filter(f => f.symbol !== symbol);
    console.log(`[AutoCleanup] Cleared tracking for ${symbol}`);
  }, [symbol]);

  // Set up cleanup handlers
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      // Execute cleanup synchronously during page unload
      cleanupTrackedFiles();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Page is being hidden (tab switch, minimize, etc.)
        cleanupTrackedFiles();
      }
    };

    const handlePageHide = () => {
      // Page is being unloaded
      cleanupTrackedFiles();
    };

    // Add event listeners
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    // Cleanup function for component unmount
    return () => {
      // Remove event listeners
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      
      // Clean up tracked files when component unmounts
      cleanupTrackedFiles();
    };
  }, [cleanupTrackedFiles]);

  return {
    trackGeneratedFile,
    cleanupTrackedFiles,
    clearTracking,
    getTrackedFilesCount: () => generatedFilesRef.current.filter(f => f.symbol === symbol).length
  };
}

/**
 * Utility function to extract file ID from a forecast file path or name
 */
export function extractFileIdFromPath(filePath: string): string | null {
  try {
    // Extract filename from path
    const filename = filePath.split('/').pop() || filePath;
    
    // Handle different forecast filename patterns:
    // - 2025-11-28_GBM-CC_1234567890123.json
    // - 2025-11-28-Conformal-ICP.json
    // - 2025-11-28_Range-YZ_1234567890123.json
    
    const timestampMatch = filename.match(/_(\d{13})\.json$/);
    if (timestampMatch) {
      // Return the timestamp as fileId for generated forecasts
      return timestampMatch[1];
    }
    
    const conformalMatch = filename.match(/^(\d{4}-\d{2}-\d{2})-Conformal-([^.]+)\.json$/);
    if (conformalMatch) {
      // Return date and method as fileId for conformal forecasts
      return `${conformalMatch[1]}-Conformal-${conformalMatch[2]}`;
    }
    
    // Fallback: use the filename without extension
    return filename.replace(/\.json$/, '');
  } catch (error) {
    console.error('[AutoCleanup] Error extracting file ID:', error);
    return null;
  }
}