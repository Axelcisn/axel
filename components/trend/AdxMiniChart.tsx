'use client';

import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  YAxis,
  XAxis,
  ReferenceLine,
  Tooltip,
} from 'recharts';
import type { AdxPoint } from '@/lib/indicators/adx';

interface AdxMiniChartProps {
  data: AdxPoint[] | null;
}

const AdxMiniChart: React.FC<AdxMiniChartProps> = ({ data }) => {
  const slice = useMemo(() => {
    if (!data || data.length === 0) return [];
    const windowSize = 60;
    return data.slice(-windowSize);
  }, [data]);

  if (!slice.length) {
    return (
      <div className="mt-4 h-20 rounded-xl border border-slate-800 bg-slate-900/40 px-2 py-1.5 text-[11px] text-slate-500 flex items-center justify-center">
        ADX mini chart – no data
      </div>
    );
  }

  return (
    <div className="mt-4 h-20 rounded-xl border border-slate-800 bg-slate-900/40 px-2 py-1.5">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={slice}>
          <YAxis hide domain={[0, 100]} />
          <XAxis dataKey="date" hide />
          <ReferenceLine y={20} stroke="#4b5563" strokeDasharray="2 2" />
          <ReferenceLine y={25} stroke="#4b5563" strokeDasharray="3 3" />
          <ReferenceLine y={50} stroke="#4b5563" strokeDasharray="3 3" />
          <ReferenceLine y={70} stroke="#4b5563" strokeDasharray="2 2" />
          <Tooltip
            cursor={{ stroke: '#1f2937', strokeWidth: 1 }}
            contentStyle={{ fontSize: 11 }}
            labelFormatter={() => ''}
            formatter={(v: any) => [v, 'ADX']}
          />
          <Line
            type="monotone"
            dataKey="adx"
            stroke="#e5b3ff"
            strokeWidth={1.4}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default AdxMiniChart;
