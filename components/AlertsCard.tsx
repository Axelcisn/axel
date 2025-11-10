"use client"

import React, { useState, useEffect } from 'react';
import { AlertRule, AlertFire } from '@/lib/watchlist/types';

interface AlertsCardProps {
  symbol: string;
}

interface NewRuleForm {
  enabled: boolean;
  threshold: { k: number; p_min: number } | null;
  on_review: boolean;
  channel: "log" | "email" | "webhook";
  webhook_url: string;
}

export default function AlertsCard({ symbol }: AlertsCardProps) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [runningAlerts, setRunningAlerts] = useState(false);
  const [recentFires, setRecentFires] = useState<AlertFire[]>([]);
  
  const [newRule, setNewRule] = useState<NewRuleForm>({
    enabled: true,
    threshold: { k: 2, p_min: 0.60 },
    on_review: false,
    channel: "log",
    webhook_url: ""
  });

  useEffect(() => {
    const loadRulesForSymbol = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/alerts/${symbol}`);
        if (response.ok) {
          const data = await response.json();
          setRules(data.rules || []);
        }
      } catch (error) {
        console.error('Failed to load alert rules:', error);
      } finally {
        setLoading(false);
      }
    };

    loadRulesForSymbol();
  }, [symbol]);

  const loadRules = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/alerts/${symbol}`);
      if (response.ok) {
        const data = await response.json();
        setRules(data.rules || []);
      }
    } catch (error) {
      console.error('Failed to load alert rules:', error);
    } finally {
      setLoading(false);
    }
  };

  const createRule = async () => {
    try {
      const ruleData: any = {
        enabled: newRule.enabled,
        on_review: newRule.on_review,
        channel: newRule.channel
      };

      // Add threshold if enabled
      if (newRule.threshold) {
        ruleData.threshold = newRule.threshold;
      }

      // Add webhook URL if channel is webhook
      if (newRule.channel === "webhook" && newRule.webhook_url) {
        ruleData.webhook_url = newRule.webhook_url;
      }

      const response = await fetch(`/api/alerts/${symbol}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ruleData)
      });

      if (response.ok) {
        await loadRules();
        setShowCreateForm(false);
        resetForm();
      } else {
        const error = await response.json();
        console.error('Failed to create rule:', error);
      }
    } catch (error) {
      console.error('Failed to create alert rule:', error);
    }
  };

  const updateRule = async (rule: AlertRule, updates: Partial<AlertRule>) => {
    try {
      const response = await fetch(`/api/alerts/${symbol}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule_id: rule.id,
          ...updates
        })
      });

      if (response.ok) {
        await loadRules();
      } else {
        const error = await response.json();
        console.error('Failed to update rule:', error);
      }
    } catch (error) {
      console.error('Failed to update alert rule:', error);
    }
  };

  const deleteRule = async (ruleId: string) => {
    try {
      const response = await fetch(`/api/alerts/${symbol}?rule_id=${ruleId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await loadRules();
      } else {
        const error = await response.json();
        console.error('Failed to delete rule:', error);
      }
    } catch (error) {
      console.error('Failed to delete alert rule:', error);
    }
  };

  const runAlertsNow = async () => {
    setRunningAlerts(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const response = await fetch('/api/alerts/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols: [symbol],
          as_of: today,
          exchange_tz: "America/New_York"
        })
      });

      if (response.ok) {
        const data = await response.json();
        setRecentFires(data.fires || []);
        console.log('Alerts run completed:', data);
      } else {
        const error = await response.json();
        console.error('Failed to run alerts:', error);
      }
    } catch (error) {
      console.error('Failed to run alerts:', error);
    } finally {
      setRunningAlerts(false);
    }
  };

  const resetForm = () => {
    setNewRule({
      enabled: true,
      threshold: { k: 2, p_min: 0.60 },
      on_review: false,
      channel: "log",
      webhook_url: ""
    });
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleString();
  };

  const formatPercent = (value: number) => {
    return `${(value * 100).toFixed(0)}%`;
  };

  return (
    <div className="bg-white rounded-lg shadow-md">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900">Alert Rules for {symbol}</h3>
          <div className="flex space-x-2">
            <button
              onClick={runAlertsNow}
              disabled={runningAlerts}
              className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
            >
              {runningAlerts ? (
                <>
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1"></div>
                  Running...
                </>
              ) : (
                'Run Now'
              )}
            </button>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
            >
              {showCreateForm ? 'Cancel' : 'Create Rule'}
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">

        {/* Create Rule Form */}
        {showCreateForm && (
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="text-md font-medium mb-4">Create New Alert Rule</h4>
            
            <div className="space-y-4">
              
              {/* Enabled Toggle */}
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="enabled"
                  checked={newRule.enabled}
                  onChange={(e) => setNewRule({...newRule, enabled: e.target.checked})}
                  className="rounded"
                />
                <label htmlFor="enabled" className="ml-2 text-sm">Enabled</label>
              </div>

              {/* Threshold Configuration */}
              <div>
                <div className="flex items-center mb-2">
                  <input
                    type="checkbox"
                    id="use-threshold"
                    checked={newRule.threshold !== null}
                    onChange={(e) => setNewRule({
                      ...newRule,
                      threshold: e.target.checked ? { k: 2, p_min: 0.60 } : null
                    })}
                    className="rounded"
                  />
                  <label htmlFor="use-threshold" className="ml-2 text-sm font-medium">Threshold Alert</label>
                </div>
                
                {newRule.threshold && (
                  <div className="ml-6 grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">k (horizon days)</label>
                      <select
                        value={newRule.threshold.k}
                        onChange={(e) => setNewRule({
                          ...newRule,
                          threshold: { ...newRule.threshold!, k: parseInt(e.target.value) }
                        })}
                        className="w-full text-sm border border-gray-300 rounded px-2 py-1"
                      >
                        {[1, 2, 3, 4, 5].map(k => (
                          <option key={k} value={k}>{k} day{k > 1 ? 's' : ''}</option>
                        ))}
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Minimum Probability</label>
                      <input
                        type="range"
                        min="0.5"
                        max="0.95"
                        step="0.05"
                        value={newRule.threshold.p_min}
                        onChange={(e) => setNewRule({
                          ...newRule,
                          threshold: { ...newRule.threshold!, p_min: parseFloat(e.target.value) }
                        })}
                        className="w-full"
                      />
                      <div className="text-xs text-gray-600 text-center">
                        {formatPercent(newRule.threshold.p_min)}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Review Date Alert */}
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="on-review"
                  checked={newRule.on_review}
                  onChange={(e) => setNewRule({...newRule, on_review: e.target.checked})}
                  className="rounded"
                />
                <label htmlFor="on-review" className="ml-2 text-sm">Fire on next review date</label>
              </div>

              {/* Channel Selection */}
              <div>
                <label className="block text-sm font-medium mb-2">Channel</label>
                <select
                  value={newRule.channel}
                  onChange={(e) => setNewRule({...newRule, channel: e.target.value as any})}
                  className="w-full text-sm border border-gray-300 rounded px-3 py-2"
                >
                  <option value="log">Log only</option>
                  <option value="email">Email (coming soon)</option>
                  <option value="webhook">Webhook (coming soon)</option>
                </select>
              </div>

              {/* Webhook URL (if webhook channel) */}
              {newRule.channel === "webhook" && (
                <div>
                  <label className="block text-sm font-medium mb-1">Webhook URL</label>
                  <input
                    type="url"
                    value={newRule.webhook_url}
                    onChange={(e) => setNewRule({...newRule, webhook_url: e.target.value})}
                    placeholder="https://example.com/webhook"
                    className="w-full text-sm border border-gray-300 rounded px-3 py-2"
                  />
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={createRule}
                  disabled={!newRule.threshold && !newRule.on_review}
                  className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  Create Rule
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Existing Rules */}
        <div>
          <h4 className="text-md font-medium mb-3">Existing Rules ({rules.length})</h4>
          
          {loading ? (
            <div className="text-center py-4 text-gray-500">Loading rules...</div>
          ) : rules.length === 0 ? (
            <div className="text-center py-4 text-gray-500">
              No alert rules configured for {symbol}
            </div>
          ) : (
            <div className="space-y-3">
              {rules.map((rule) => (
                <div key={rule.id} className="border border-gray-200 rounded p-4">
                  <div className="flex justify-between items-start">
                    
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          rule.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {rule.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                        <span className="text-xs text-gray-500">
                          {rule.channel}
                        </span>
                      </div>
                      
                      <div className="space-y-1 text-sm">
                        {rule.threshold && (
                          <div>
                            <span className="font-medium">Threshold:</span> Fire when P(T≥{rule.threshold.k}) ≥ {formatPercent(rule.threshold.p_min)}
                          </div>
                        )}
                        {rule.on_review && (
                          <div>
                            <span className="font-medium">Review:</span> Fire on next review date
                          </div>
                        )}
                        <div className="text-xs text-gray-500">
                          Created: {formatDate(rule.created_at)}
                          {rule.last_fired_at && (
                            <span className="ml-4">Last fired: {formatDate(rule.last_fired_at)}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex space-x-2 ml-4">
                      <button
                        onClick={() => updateRule(rule, { enabled: !rule.enabled })}
                        className={`px-2 py-1 text-xs rounded ${
                          rule.enabled 
                            ? 'bg-gray-200 text-gray-700 hover:bg-gray-300' 
                            : 'bg-green-200 text-green-700 hover:bg-green-300'
                        }`}
                      >
                        {rule.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => deleteRule(rule.id)}
                        className="px-2 py-1 text-xs bg-red-200 text-red-700 rounded hover:bg-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Fires */}
        {recentFires.length > 0 && (
          <div>
            <h4 className="text-md font-medium mb-3">Recent Alerts Fired</h4>
            <div className="space-y-2">
              {recentFires.map((fire) => (
                <div key={fire.id} className="bg-yellow-50 border border-yellow-200 rounded p-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium text-sm">
                        {fire.reason === 'threshold' ? 'Threshold Alert' : 'Review Date Alert'}
                      </div>
                      <div className="text-xs text-gray-600">
                        Fired: {formatDate(fire.fired_at)}
                      </div>
                    </div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      fire.reason === 'threshold' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {fire.reason}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Alert Summary */}
        <div className="bg-gray-50 rounded p-3">
          <div className="text-sm text-gray-600">
            <div className="flex justify-between">
              <span>Total Rules:</span>
              <span>{rules.length}</span>
            </div>
            <div className="flex justify-between">
              <span>Enabled:</span>
              <span>{rules.filter(r => r.enabled).length}</span>
            </div>
            <div className="flex justify-between">
              <span>With Thresholds:</span>
              <span>{rules.filter(r => r.threshold).length}</span>
            </div>
            <div className="flex justify-between">
              <span>With Review Alerts:</span>
              <span>{rules.filter(r => r.on_review).length}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}