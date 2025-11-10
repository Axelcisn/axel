import { NextRequest, NextResponse } from 'next/server';
import { listRulesBySymbol, saveRule, updateRule } from '@/lib/alerts/store';
import { validateAlertRule } from '@/lib/alerts/engine';
import { AlertRule } from '@/lib/watchlist/types';

/**
 * GET /api/alerts/[symbol] - List rules for symbol
 * POST /api/alerts/[symbol] - Create rule for symbol
 * PATCH /api/alerts/[symbol] - Update rule for symbol
 * DELETE /api/alerts/[symbol] - Delete rule for symbol
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = params.symbol.toUpperCase();
    
    const rules = await listRulesBySymbol(symbol);
    
    return NextResponse.json({
      symbol,
      rules,
      count: rules.length
    });

  } catch (error) {
    console.error(`Alerts GET error for ${params.symbol}:`, error);
    return NextResponse.json(
      { 
        error: 'Failed to retrieve alert rules',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = params.symbol.toUpperCase();
    const body = await request.json();
    
    const {
      enabled = true,
      threshold,
      on_review,
      channel = "log",
      webhook_url
    } = body;

    // Create rule object
    const rule: AlertRule = {
      id: crypto.randomUUID(),
      symbol,
      created_at: new Date().toISOString(),
      enabled,
      threshold: threshold || null,
      on_review: on_review || false,
      channel,
      webhook_url: webhook_url || null,
      last_fired_at: null
    };

    // Validate rule
    const validation = validateAlertRule(rule);
    if (!validation.valid) {
      return NextResponse.json(
        { 
          error: 'Invalid alert rule',
          validation_errors: validation.errors
        },
        { status: 400 }
      );
    }

    // Save rule
    const ruleId = await saveRule(rule);

    return NextResponse.json({
      success: true,
      rule_id: ruleId,
      rule,
      message: `Created alert rule for ${symbol}`
    });

  } catch (error) {
    console.error(`Alerts POST error for ${params.symbol}:`, error);
    return NextResponse.json(
      { 
        error: 'Failed to create alert rule',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = params.symbol.toUpperCase();
    const body = await request.json();
    
    const { rule_id, ...updates } = body;

    if (!rule_id) {
      return NextResponse.json(
        { error: 'rule_id is required for updates' },
        { status: 400 }
      );
    }

    // Get existing rules to find the one to update
    const existingRules = await listRulesBySymbol(symbol);
    const existingRule = existingRules.find(r => r.id === rule_id);

    if (!existingRule) {
      return NextResponse.json(
        { error: `Alert rule ${rule_id} not found for ${symbol}` },
        { status: 404 }
      );
    }

    // Merge updates with existing rule
    const updatedRule: AlertRule = {
      ...existingRule,
      ...updates,
      id: rule_id, // Ensure ID doesn't change
      symbol, // Ensure symbol doesn't change
    };

    // Validate updated rule
    const validation = validateAlertRule(updatedRule);
    if (!validation.valid) {
      return NextResponse.json(
        { 
          error: 'Invalid alert rule update',
          validation_errors: validation.errors
        },
        { status: 400 }
      );
    }

    // Update rule
    await updateRule(updatedRule);

    return NextResponse.json({
      success: true,
      rule_id,
      rule: updatedRule,
      message: `Updated alert rule for ${symbol}`
    });

  } catch (error) {
    console.error(`Alerts PATCH error for ${params.symbol}:`, error);
    return NextResponse.json(
      { 
        error: 'Failed to update alert rule',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = params.symbol.toUpperCase();
    const { searchParams } = new URL(request.url);
    const ruleId = searchParams.get('rule_id');

    if (!ruleId) {
      return NextResponse.json(
        { error: 'rule_id parameter is required' },
        { status: 400 }
      );
    }

    // Verify rule exists and belongs to symbol
    const existingRules = await listRulesBySymbol(symbol);
    const existingRule = existingRules.find(r => r.id === ruleId);

    if (!existingRule) {
      return NextResponse.json(
        { error: `Alert rule ${ruleId} not found for ${symbol}` },
        { status: 404 }
      );
    }

    // Delete rule
    const { alertsStore } = await import('@/lib/alerts/store');
    await alertsStore.deleteRule(ruleId);

    return NextResponse.json({
      success: true,
      message: `Deleted alert rule ${ruleId} for ${symbol}`
    });

  } catch (error) {
    console.error(`Alerts DELETE error for ${params.symbol}:`, error);
    return NextResponse.json(
      { 
        error: 'Failed to delete alert rule',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}