import { NextRequest, NextResponse } from 'next/server';
import { runSmokeTest, runFullTestSuite, runScenario } from '@/lib/qa/runner';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, symbol, scenario } = body;
    
    switch (type) {
      case 'smoke':
        const smokeResult = await runSmokeTest(symbol);
        return NextResponse.json(smokeResult);
        
      case 'full':
        const fullResult = await runFullTestSuite();
        return NextResponse.json(fullResult);
        
      case 'single':
        if (!symbol || !scenario) {
          return NextResponse.json({ error: 'Symbol and scenario name required for single test' }, { status: 400 });
        }
        const singleResult = await runScenario(scenario, symbol);
        return NextResponse.json(singleResult);
        
      default:
        return NextResponse.json({ error: 'Invalid test type. Use: smoke, full, or single' }, { status: 400 });
    }
  } catch (error) {
    console.error('QA runner error:', error);
    return NextResponse.json({ 
      error: 'QA runner failed', 
      details: error instanceof Error ? error.message : String(error) 
    }, { status: 500 });
  }
}