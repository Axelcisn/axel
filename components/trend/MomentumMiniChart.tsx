'use client';

import { useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area, ReferenceLine, YAxis, XAxis } from 'recharts';
import type { MomentumScorePoint } from '@/lib/indicators/momentum';

interface MomentumMiniChartProps {
  data: MomentumScorePoint[] | null;
}

export default function MomentumMiniChart({ data }: MomentumMiniChartProps) {
  const slice = useMemo(() => {
    if (!data || data.length === 0) return [];
    const windowSize = 60;
    return data.slice(-windowSize);
  }, [data]);

  if (!data || data.length === 0) {
    return (
      <div className="mt-4 h-20 rounded-xl border border-slate-800 bg-slate-900/40 text-[11px] text-slate-500 flex items-center justify-center">
        Momentum mini chart – no data
      </div>
    );
  }

  return (
    <div className="mt-4 h-20 rounded-xl border border-slate-800 bg-slate-900/40 px-2 py-1.5">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={slice}>
          <defs>
            <linearGradient id="momentumScoreFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[0, 100]} />
          <XAxis dataKey="date" hide />
          <ReferenceLine y={50} stroke="#475569" strokeDasharray="3 3" />
          <ReferenceLine y={30} stroke="#4b5563" strokeDasharray="2 2" />
          <ReferenceLine y={70} stroke="#4b5563" strokeDasharray="2 2" />
          <Area
            type="monotone"
            dataKey="score"
            stroke="#22c55e"
            fill="url(#momentumScoreFill)"
            strokeWidth={1.4}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
