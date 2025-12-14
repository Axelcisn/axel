'use client';

import { useId, useMemo } from 'react';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
}

export function Sparkline({ data, width = 82, height = 28 }: SparklineProps) {
  const gradientId = useId();

  const { path, areaPath, color } = useMemo(() => {
    if (!data || data.length < 2) {
      return { path: '', areaPath: '', color: '#10b981' };
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const pad = 2;
    const usableHeight = height - pad * 2;
    const usableWidth = width - pad * 2;

    const points = data.map((value, index) => {
      const x = pad + (index / (data.length - 1)) * usableWidth;
      const y = pad + (1 - (value - min) / range) * usableHeight;
      return [x, y];
    });

    const linePath = points.reduce(
      (acc, [x, y], idx) => `${acc}${idx === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `,
      '',
    );

    const areaPathString = `${linePath}L${pad + usableWidth},${height - pad} L${pad},${height - pad} Z`;
    const rising = data[data.length - 1] >= data[0];
    return {
      path: linePath,
      areaPath: areaPathString,
      color: rising ? '#16a34a' : '#dc2626',
    };
  }, [data, height, width]);

  if (!data || data.length < 2) {
    return <div className="h-[28px] w-[82px] text-center text-[11px] text-white/50">—</div>;
  }

  return (
    <svg width={width} height={height} role="presentation">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.16" />
          <stop offset="100%" stopColor={color} stopOpacity="0.06" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

export default Sparkline;
