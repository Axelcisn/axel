import { NextRequest, NextResponse } from 'next/server';
import { listEvents } from '../../../../lib/events/store';
import { mappingStorage } from '../../../../lib/mapping/storage';
import { computeKmBins } from '../../../../lib/mapping/km';
import { fitCoxModel } from '../../../../lib/mapping/cox';
import { BinSpec, CoxSpec, MappingSummary } from '../../../../lib/mapping/types';

/**
 * POST /api/mapping/rebuild
 * Rebuild KM bins and Cox models for specified symbols
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbols, stratify_vol = false, force = false } = body;
    
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return NextResponse.json(
        { error: 'symbols array is required' },
        { status: 400 }
      );
    }
    
    const results: Array<{
      symbol: string;
      status: 'success' | 'error' | 'skipped';
      message?: string;
      km_bins?: number;
      cox_fit?: boolean;
    }> = [];
    
    // Define standard |z| bins
    const standardBins: BinSpec[] = [
      { z_abs_lower: 2.0, z_abs_upper: 2.5, label: "[2.0, 2.5)" },
      { z_abs_lower: 2.5, z_abs_upper: 3.0, label: "[2.5, 3.0)" },
      { z_abs_lower: 3.0, z_abs_upper: 3.5, label: "[3.0, 3.5)" },
      { z_abs_lower: 3.5, z_abs_upper: 4.0, label: "[3.5, 4.0)" },
      { z_abs_lower: 4.0, z_abs_upper: Infinity, label: "[4.0, ∞)" }
    ];
    
    // Cox model specification
    const coxSpec: CoxSpec = {
      formula: "Surv(T, status) ~ z_abs",
      ties: "efron",
      cluster: "symbol"
    };
    
    for (const symbol of symbols) {
      try {
        // Check if rebuild needed
        if (!force) {
          const freshness = await mappingStorage.getMappingFreshness(symbol);
          if (!freshness.needs_rebuild) {
            results.push({
              symbol,
              status: 'skipped',
              message: 'Data is fresh, use force=true to rebuild'
            });
            continue;
          }
        }
        
        // Load events for this symbol
        const events = await listEvents(symbol);
        
        if (events.length < 40) {
          results.push({
            symbol,
            status: 'error',
            message: `Insufficient events: ${events.length} (need ≥40)`
          });
          continue;
        }
        
        // Compute KM bins
        const kmBins = await computeKmBins(events, standardBins, stratify_vol);
        
        // Fit Cox model
        let coxFit;
        try {
          coxFit = await fitCoxModel(events, coxSpec);
        } catch (error) {
          console.warn(`Cox model failed for ${symbol}:`, error);
          coxFit = undefined;
        }
        
        // Save results
        const summary: MappingSummary = {
          symbol,
          bins: kmBins,
          cox: coxFit,
          updated_at: new Date().toISOString()
        };
        
        await mappingStorage.saveMappingSummary(summary);
        
        results.push({
          symbol,
          status: 'success',
          km_bins: kmBins.length,
          cox_fit: !!coxFit
        });
        
      } catch (error) {
        console.error(`Failed to rebuild mapping for ${symbol}:`, error);
        results.push({
          symbol,
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    return NextResponse.json({
      success: true,
      results,
      summary: {
        total: symbols.length,
        success: results.filter(r => r.status === 'success').length,
        errors: results.filter(r => r.status === 'error').length,
        skipped: results.filter(r => r.status === 'skipped').length
      }
    });
    
  } catch (error) {
    console.error('Mapping rebuild error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/mapping/rebuild?symbols=AAPL,MSFT
 * Get rebuild status for symbols
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');
    
    if (!symbolsParam) {
      // Return all mapped symbols
      const mappedSymbols = await mappingStorage.listMappedSymbols();
      
      const summaries = await Promise.all(
        mappedSymbols.map(async (symbol) => {
          const freshness = await mappingStorage.getMappingFreshness(symbol);
          const summary = await mappingStorage.loadMappingSummary(symbol);
          
          return {
            symbol,
            km_bins: summary?.bins.length || 0,
            cox_fit: !!summary?.cox,
            ...freshness
          };
        })
      );
      
      return NextResponse.json({
        mapped_symbols: summaries
      });
    }
    
    const symbols = symbolsParam.split(',').map(s => s.trim()).filter(Boolean);
    
    const status = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const freshness = await mappingStorage.getMappingFreshness(symbol);
          const summary = await mappingStorage.loadMappingSummary(symbol);
          
          return {
            symbol,
            exists: !!summary,
            km_bins: summary?.bins.length || 0,
            cox_fit: !!summary?.cox,
            ...freshness
          };
        } catch (error) {
          return {
            symbol,
            exists: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      })
    );
    
    return NextResponse.json({ status });
    
  } catch (error) {
    console.error('Mapping status error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}