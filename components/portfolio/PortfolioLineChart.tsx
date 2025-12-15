'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { formatCompactCurrency, formatPercent } from '@/lib/portfolio/format';

interface ChartPoint {
  x: string;
  y: number;
}

interface PortfolioLineChartProps {
  points: ChartPoint[];
  variant: 'value' | 'performance';
  height?: number;
  currency?: string;
}

type ScaledPoint = {
  x: number;
  y: number;
  raw: number;
};

type LineSegment = {
  path: string;
  color: string;
};

function buildSegments(points: ScaledPoint[], zeroY: number): LineSegment[] {
  if (points.length < 2) return [];

  const positive = '#22c55e';
  const negative = '#ef4444';
  const segments: LineSegment[] = [];

  let current: LineSegment = {
    color: points[0].raw >= 0 ? positive : negative,
    path: `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`,
  };
  segments.push(current);

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];

    const prevColor = prev.raw >= 0 ? positive : negative;
    const nextColor = next.raw >= 0 ? positive : negative;

    if (prevColor === nextColor) {
      current.path += ` L${next.x.toFixed(2)},${next.y.toFixed(2)}`;
      continue;
    }

    const denom = Math.abs(next.raw - prev.raw) || 1;
    const ratio = Math.abs(prev.raw) / denom;
    const crossX = prev.x + (next.x - prev.x) * ratio;

    current.path += ` L${crossX.toFixed(2)},${zeroY.toFixed(2)}`;

    current = {
      color: nextColor,
      path: `M${crossX.toFixed(2)},${zeroY.toFixed(2)} L${next.x.toFixed(2)},${next.y.toFixed(2)}`,
    };
    segments.push(current);
  }

  return segments;
}

export default function PortfolioLineChart({
  points,
  variant,
  height = 360,
  currency = 'USD',
}: PortfolioLineChartProps) {
  const gradientId = useId();
  const svgWidth = 1100;
  const axisPad = 72;
  const leftPad = 10;
  const topPad = 12;
  const bottomPad = 38;

  const {
    hasData,
    gridLines,
    linePath,
    areaPath,
    zeroY,
    segments,
    chartWidth,
    yFormatter,
    scaledPoints,
  } = useMemo(() => {
    if (!points || points.length < 2) {
      return {
        hasData: false,
        gridLines: [],
        linePath: '',
        areaPath: '',
        zeroY: null,
        segments: [] as LineSegment[],
        chartWidth: svgWidth - axisPad - leftPad,
        yFormatter: (value: number) => value.toString(),
        scaledPoints: [] as ScaledPoint[],
      };
    }

    const yValues = points.map((p) => p.y);
    let minY = Math.min(...yValues);
    let maxY = Math.max(...yValues);

    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
      return {
        hasData: false,
        gridLines: [],
        linePath: '',
        areaPath: '',
        zeroY: null,
        segments: [] as LineSegment[],
        chartWidth: svgWidth - axisPad - leftPad,
        yFormatter: (value: number) => value.toString(),
        scaledPoints: [] as ScaledPoint[],
      };
    }

    const baseRange = maxY - minY || 1;
    minY -= baseRange * 0.08;
    maxY += baseRange * 0.08;

    if (variant === 'performance') {
      minY = Math.min(minY, 0);
      maxY = Math.max(maxY, 0);
      if (minY < 0 && maxY > 0) {
        const absMax = Math.max(Math.abs(minY), Math.abs(maxY));
        minY = -absMax;
        maxY = absMax;
      }
    }

    const yRange = maxY - minY || 1;
    const chartWidthComputed = svgWidth - axisPad - leftPad;
    const chartHeightComputed = height - topPad - bottomPad;

    const xScale = (index: number) =>
      leftPad + (index / Math.max(points.length - 1, 1)) * chartWidthComputed;
    const yScale = (value: number) => topPad + (1 - (value - minY) / yRange) * chartHeightComputed;

    const scaledPoints: ScaledPoint[] = points.map((pt, idx) => ({
      raw: pt.y,
      x: xScale(idx),
      y: yScale(pt.y),
    }));

    const baseValue = variant === 'performance' ? Math.min(0, minY) : minY;
    const baseY = yScale(baseValue);

    const line = scaledPoints
      .map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`)
      .join(' ');
    const area = `${line} L${leftPad + chartWidthComputed},${baseY.toFixed(2)} L${leftPad.toFixed(
      2,
    )},${baseY.toFixed(2)} Z`;

    const gridLinesComputed = Array.from({ length: 5 }, (_, i) => {
      const value = maxY - (i / 4) * (maxY - minY);
      return {
        y: yScale(value),
        value,
      };
    });

    const zeroLine = 0 >= minY && 0 <= maxY ? yScale(0) : null;
    const performanceSegments = variant === 'performance' ? buildSegments(scaledPoints, zeroLine ?? 0) : [];

    const yLabelFormatter =
      variant === 'value'
        ? (value: number) => formatCompactCurrency(value, currency)
        : (value: number) => formatPercent(value, 2);

    return {
      hasData: true,
      gridLines: gridLinesComputed,
      linePath: line,
      areaPath: area,
      zeroY: zeroLine,
      segments: performanceSegments,
      chartWidth: chartWidthComputed,
      yFormatter: yLabelFormatter,
      scaledPoints,
    };
  }, [points, variant, height, axisPad, leftPad, svgWidth, topPad, bottomPad, currency]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    setActiveIndex((prev) => {
      if (prev == null) return null;
      if (!points.length || !scaledPoints.length) return null;
      const maxIndex = Math.min(points.length, scaledPoints.length) - 1;
      return Math.min(Math.max(prev, 0), maxIndex);
    });
  }, [points.length, scaledPoints.length]);

  const effectiveIndex =
    points.length === 0 || activeIndex == null
      ? null
      : Math.min(Math.max(activeIndex, 0), points.length - 1);

  const activePoint =
    effectiveIndex != null && effectiveIndex < scaledPoints.length ? scaledPoints[effectiveIndex] : null;
  const activeRaw = effectiveIndex != null ? points[effectiveIndex]?.y ?? 0 : 0;

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current || scaledPoints.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relativeX = event.clientX - rect.left;
    if (relativeX < 0 || relativeX > rect.width) return;

    const svgX = (relativeX / rect.width) * svgWidth;
    const nearestIndex = scaledPoints.reduce((bestIdx, pt, idx) => {
      const best = scaledPoints[bestIdx] ?? pt;
      return Math.abs(pt.x - svgX) < Math.abs(best.x - svgX) ? idx : bestIdx;
    }, 0);

    setActiveIndex(nearestIndex);
  };

  const onPointerLeave = () => {
    setActiveIndex(null);
  };

  const labelFormatter = variant === 'value'
    ? (value: number) => formatCompactCurrency(value, currency)
    : (value: number) => formatPercent(value, 2);

  const labelValue =
    effectiveIndex != null && points[effectiveIndex]
      ? labelFormatter(points[effectiveIndex].y)
      : null;
  const labelDate =
    effectiveIndex != null && points[effectiveIndex]
      ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
          new Date(points[effectiveIndex].x),
        )
      : null;

  const bottomLabelWidth = labelDate ? Math.max(82, labelDate.length * 7.2) : 0;
  const rightLabelWidth = labelValue ? Math.max(62, labelValue.length * 8) : 0;

  const hasPerformanceSegments = variant === 'performance' && segments.length > 0;
  const areaColor =
    variant === 'value'
      ? '#3B82F6'
      : (points[points.length - 1]?.y ?? 0) >= 0
        ? '#22c55e'
        : '#ef4444';

  if (!hasData) {
    return (
      <div
        className="flex w-full items-center justify-center rounded-2xl bg-white/[0.03] text-sm text-white/50"
        style={{ height }}
        role="presentation"
      >
        No data available
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      className="w-full"
      viewBox={`0 0 ${svgWidth} ${height}`}
      role="presentation"
      preserveAspectRatio="none"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={areaColor} stopOpacity="0.18" />
          <stop offset="100%" stopColor={areaColor} stopOpacity="0.04" />
        </linearGradient>
      </defs>

      {gridLines.map((line) => (
        <g key={line.y}>
          <line
            x1={leftPad}
            x2={leftPad + chartWidth}
            y1={line.y}
            y2={line.y}
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={1}
            strokeDasharray="4 6"
          />
          <text
            x={leftPad + chartWidth + 56}
            y={line.y + 4}
            fill="rgba(255,255,255,0.65)"
            fontSize="12"
            textAnchor="end"
          >
            {yFormatter(line.value)}
          </text>
        </g>
      ))}

      {variant === 'performance' && zeroY !== null && (
        <line
          x1={leftPad}
          x2={leftPad + chartWidth}
          y1={zeroY}
          y2={zeroY}
          stroke="rgba(255,255,255,0.28)"
          strokeWidth={1}
          strokeDasharray="6 6"
        />
      )}

      <path d={areaPath} fill={`url(#${gradientId})`} opacity={0.9} />

      {hasPerformanceSegments
        ? segments.map((segment, idx) => (
            <path
              key={`${segment.color}-${idx}`}
              d={segment.path}
              fill="none"
              stroke={segment.color}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))
        : (
            <path
              d={linePath}
              fill="none"
              stroke="#3B82F6"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

      {activePoint && labelValue && labelDate && (
        <>
          <line
            x1={activePoint.x}
            x2={activePoint.x}
            y1={topPad}
            y2={height - bottomPad + 6}
            stroke="white"
            strokeWidth={1.25}
            strokeDasharray="4 6"
          />

          <line
            x1={leftPad}
            x2={leftPad + chartWidth}
            y1={activePoint.y}
            y2={activePoint.y}
            stroke="white"
            strokeWidth={1.25}
            strokeDasharray="4 6"
          />

          <circle
            cx={activePoint.x}
            cy={activePoint.y}
            r={6}
            fill="rgba(51,156,255,0.35)"
            stroke="#3B82F6"
            strokeWidth={2}
          />
          <circle
            cx={activePoint.x}
            cy={activePoint.y}
            r={3}
            fill={variant === 'performance' ? (activeRaw >= 0 ? '#22c55e' : '#ef4444') : '#3B82F6'}
            stroke="white"
            strokeWidth={1.4}
          />

          <g>
            <rect
              x={leftPad + chartWidth + 10}
              y={Math.min(Math.max(activePoint.y - 12, topPad), height - bottomPad - 22)}
              width={rightLabelWidth}
              height={24}
              rx={8}
              fill="#339CFF"
            />
            <text
              x={leftPad + chartWidth + 10 + rightLabelWidth / 2}
              y={Math.min(Math.max(activePoint.y - 12, topPad), height - bottomPad - 22) + 16}
              textAnchor="middle"
              fill="white"
              fontSize="11"
              fontWeight="700"
            >
              {labelValue}
            </text>
          </g>

          <g>
            <rect
              x={Math.min(
                Math.max(activePoint.x - bottomLabelWidth / 2, leftPad),
                leftPad + chartWidth - bottomLabelWidth,
              )}
              y={height - bottomPad - 4}
              width={bottomLabelWidth}
              height={28}
              rx={9}
              fill="#339CFF"
            />
            <text
              x={
                Math.min(
                  Math.max(activePoint.x - bottomLabelWidth / 2, leftPad),
                  leftPad + chartWidth - bottomLabelWidth,
                ) +
                bottomLabelWidth / 2
              }
              y={height - bottomPad + 14}
              textAnchor="middle"
              fill="white"
              fontSize="11"
              fontWeight="700"
            >
              {labelDate}
            </text>
          </g>
        </>
      )}
    </svg>
  );
}
