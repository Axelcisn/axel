import { NextRequest, NextResponse } from 'next/server';
import { detectBreakoutForDate } from '@/lib/events/engine';
import { listEvents, getOpenEvent } from '@/lib/events/store';
import { getLatestFinalForecast } from '@/lib/forecast/store';
import { loadCanonicalData } from '@/lib/storage/canonical';

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const { symbol } = params;
    const recent = request.nextUrl.searchParams.get('recent') === '1';
    
    if (recent) {
      // Return the latest event (if any)
      const events = await listEvents(symbol);
      const latestEvent = events.length > 0 ? events[events.length - 1] : null;
      
      return NextResponse.json({ event: latestEvent });
    } else {
      // Return full list (paginated in future)
      const events = await listEvents(symbol);
      return NextResponse.json({ events });
    }
    
  } catch (error: any) {
    console.error('Events GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const { symbol } = params;
    const body = await request.json();
    const { mode, t_date, since } = body;
    
    if (mode === 'today') {
      // Detect using latest Final PI date t and realized t+1 if exists
      const latestForecast = await getLatestFinalForecast(symbol);
      if (!latestForecast) {
        return NextResponse.json(
          { error: 'No Final PI available' },
          { status: 422 }
        );
      }
      
      try {
        const event = await detectBreakoutForDate(symbol, latestForecast.date_t);
        return NextResponse.json({ created: event });
      } catch (error: any) {
        if (error.message.includes('S_{t+1} not available yet')) {
          return NextResponse.json(
            { error: 'Cannot verify today yet - S_{t+1} missing' },
            { status: 422 }
          );
        }
        if (error.message.includes('Cooldown failed')) {
          return NextResponse.json(
            { error: error.message },
            { status: 409 }
          );
        }
        throw error;
      }
      
    } else if (mode === 'date') {
      // Detect for a specific t_date
      if (!t_date) {
        return NextResponse.json(
          { error: 'Missing t_date parameter' },
          { status: 400 }
        );
      }
      
      try {
        const event = await detectBreakoutForDate(symbol, t_date);
        return NextResponse.json({ created: event });
      } catch (error: any) {
        if (error.message.includes('No Final PI')) {
          return NextResponse.json(
            { error: `No Final PI for ${t_date}` },
            { status: 422 }
          );
        }
        if (error.message.includes('S_{t+1} not available')) {
          return NextResponse.json(
            { error: 'S_{t+1} missing for specified date' },
            { status: 422 }
          );
        }
        if (error.message.includes('Cooldown failed')) {
          return NextResponse.json(
            { error: error.message },
            { status: 409 }
          );
        }
        throw error;
      }
      
    } else if (mode === 'rescan') {
      // Iterate dates, generate events where applicable
      if (!since) {
        return NextResponse.json(
          { error: 'Missing since parameter for rescan' },
          { status: 400 }
        );
      }
      
      try {
        const events = await rescanEvents(symbol, since);
        return NextResponse.json({ created: events });
      } catch (error: any) {
        throw error;
      }
      
    } else {
      return NextResponse.json(
        { error: 'Invalid mode. Use: today, date, or rescan' },
        { status: 400 }
      );
    }
    
  } catch (error: any) {
    console.error('Events POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Rescan dates since a given date, creating events where applicable
 */
async function rescanEvents(symbol: string, since: string) {
  const canonicalData = await loadCanonicalData(symbol);
  const tradingDates = canonicalData
    .filter(row => row.date >= since && row.adj_close)
    .map(row => row.date)
    .sort();
  
  const existingEvents = await listEvents(symbol);
  const existingEventDates = new Set(existingEvents.map(e => e.t_date));
  
  const createdEvents = [];
  
  for (const t_date of tradingDates) {
    // Skip dates already recorded as events
    if (existingEventDates.has(t_date)) {
      continue;
    }
    
    try {
      const event = await detectBreakoutForDate(symbol, t_date);
      if (event) {
        createdEvents.push(event);
        // Update existing events set to respect cooldown for subsequent dates
        existingEventDates.add(t_date);
      }
    } catch (error) {
      // Continue on errors (missing data, cooldown failures, etc.)
      console.warn(`Rescan failed for ${symbol} ${t_date}:`, error);
      continue;
    }
  }
  
  return createdEvents;
}