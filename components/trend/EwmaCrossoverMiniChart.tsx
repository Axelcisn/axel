'use client';

import React, { useMemo } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import type { EwmaPoint, EwmaCrossoverEvent } from '@/lib/indicators/ewmaCrossover';

interface EwmaCrossoverMiniChartProps {
  symbol: string;
  shortWindow: number;
  longWindow: number;
  priceSeries: { date: string; close: number }[] | null;
  shortEwma: EwmaPoint[] | null;
  longEwma: EwmaPoint[] | null;
  lastEvent: EwmaCrossoverEvent | null;
}

export default function EwmaCrossoverMiniChart({
  symbol,
  shortWindow,
  longWindow,
  priceSeries,
  shortEwma,
  longEwma,
}: EwmaCrossoverMiniChartProps) {
  const data = useMemo(() => {
    if (!priceSeries || !shortEwma || !longEwma) return [];
    const shortMap = new Map(shortEwma.map((p) => [p.date, p.value]));
    const longMap = new Map(longEwma.map((p) => [p.date, p.value]));
    return priceSeries.map((p) => ({
      date: p.date,
      close: p.close,
      short: shortMap.get(p.date),
      long: longMap.get(p.date),
    }));
  }, [priceSeries, shortEwma, longEwma]);

  if (!data.length) {
    return (
      <div className="mt-3 h-20 rounded-xl border border-slate-800 bg-slate-900/40 text-[11px] text-slate-500 flex items-center justify-center">
        Mini crossover chart for {symbol.toUpperCase()} ({shortWindow}/{longWindow}) - no data
      </div>
    );
  }

  return (
    <div className="mt-3 h-24 rounded-xl border border-slate-800 bg-slate-900/40 px-2 py-1.5">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <XAxis dataKey="date" hide />
          <YAxis hide />
          <Tooltip
            contentStyle={{ fontSize: 11 }}
            formatter={(v: any, name: string) =>
              name === 'close'
                ? [v, 'Price']
                : name === 'short'
                ? [v, `Short EWMA (${shortWindow})`]
                : [v, `Long EWMA (${longWindow})`]
            }
          />
          <Line
            type="monotone"
            dataKey="close"
            stroke="#64748b"
            dot={false}
            strokeWidth={1}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="short"
            stroke="#22c55e"
            dot={false}
            strokeWidth={1.2}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="long"
            stroke="#3b82f6"
            dot={false}
            strokeWidth={1.2}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
