import React from 'react';

type MomentumLogoProps = {
  size?: number;
  className?: string;
};

/**
 * Stylized radial logo (lightweight SVG approximation of the provided mark).
 * Uses wedge segments arranged around a circle to mimic the original ring.
 */
export function MomentumLogo({ size = 24, className }: MomentumLogoProps) {
  const wedges = Array.from({ length: 14 }, (_, i) => i);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      stroke="currentColor"
      strokeWidth="6"
      className={className}
    >
      <circle cx="100" cy="100" r="84" stroke="currentColor" strokeOpacity={0.6} />
      <g strokeLinecap="round" strokeLinejoin="round">
        {wedges.map((i) => {
          const angle = (360 / wedges.length) * i;
          return (
            <g key={i} transform={`rotate(${angle} 100 100)`}>
              <path d="M100 18 L118 60 L82 60 Z" opacity={0.9} />
              <path d="M100 60 L112 92 L88 92 Z" opacity={0.6} />
            </g>
          );
        })}
      </g>
      <path
        d="M52 128 C82 146 118 152 146 138"
        stroke="currentColor"
        strokeOpacity={0.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
