import { NextRequest, NextResponse } from 'next/server';
import { tickOpenEventForDate, rescanOpenEvent } from '@/lib/events/continuation';
import { getOpenEvent } from '@/lib/events/store';
import { isTradingDate } from '@/lib/events/dates';

export async function POST(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const { symbol } = params;
    const body = await request.json();
    const { mode, D_date, start, end, stop_rule, k_inside, T_max } = body;

    // Validate required fields
    if (!mode || !stop_rule) {
      return NextResponse.json(
        { error: 'Missing required fields: mode, stop_rule' },
        { status: 400 }
      );
    }

    // Set defaults
    const options = {
      stop_rule: stop_rule as "re-entry" | "sign-flip",
      k_inside: (k_inside as 1 | 2) || 1,
      T_max: T_max || 20
    };

    // Check for open event
    const openEvent = await getOpenEvent(symbol);
    if (!openEvent) {
      return NextResponse.json(
        { error: 'No open event found' },
        { status: 422 }
      );
    }

    if (mode === 'tick') {
      // Single date tick
      if (!D_date) {
        return NextResponse.json(
          { error: 'Missing D_date for tick mode' },
          { status: 400 }
        );
      }

      if (!isTradingDate(D_date, 'UTC')) {
        return NextResponse.json(
          { error: 'D_date is not a trading date' },
          { status: 400 }
        );
      }

      try {
        const updated = await tickOpenEventForDate(symbol, D_date, options);
        
        if (!updated) {
          return NextResponse.json(
            { error: 'No open event to tick' },
            { status: 422 }
          );
        }

        // Determine action based on event state
        let action: "continue" | "stop" | "censor" | "pause";
        if (!updated.event_open) {
          if (updated.censored) {
            action = "censor";
          } else {
            action = "stop";
          }
        } else {
          action = "continue";
        }

        return NextResponse.json({
          updated,
          action
        });

      } catch (error: any) {
        if (error.message.includes('missing') || error.message.includes('no PI')) {
          return NextResponse.json(
            { error: 'Missing S_D or PI for D-1' },
            { status: 422 }
          );
        }
        throw error;
      }

    } else if (mode === 'rescan') {
      // Batch rescan
      if (!start) {
        return NextResponse.json(
          { error: 'Missing start date for rescan mode' },
          { status: 400 }
        );
      }

      const endDate = end || new Date().toISOString().split('T')[0];

      try {
        const updated = await rescanOpenEvent(symbol, start, endDate, options);
        
        if (!updated) {
          return NextResponse.json(
            { error: 'No open event to rescan' },
            { status: 422 }
          );
        }

        // Determine final action
        let action: "continue" | "stop" | "censor";
        if (!updated.event_open) {
          if (updated.censored) {
            action = "censor";
          } else {
            action = "stop";
          }
        } else {
          action = "continue";
        }

        return NextResponse.json({
          updated,
          action
        });

      } catch (error: any) {
        if (error.message.includes('missing') || error.message.includes('no PI')) {
          return NextResponse.json(
            { error: 'Missing data during rescan' },
            { status: 422 }
          );
        }
        throw error;
      }

    } else {
      return NextResponse.json(
        { error: 'Invalid mode. Use: tick or rescan' },
        { status: 400 }
      );
    }

  } catch (error: any) {
    console.error('Continuation API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}