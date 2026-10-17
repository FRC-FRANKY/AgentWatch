import React, { useId } from 'react';

export type BrandMarkVariant = 'gradient' | 'dark' | 'light' | 'monochrome' | 'white';
export type BrandMarkSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;

export interface BrandMarkProps {
  size?: BrandMarkSize;
  variant?: BrandMarkVariant;
  className?: string;
  style?: React.CSSProperties;
  glow?: boolean;
  title?: string;
}

const sizeMap: Record<string, number> = {
  xs: 18,
  sm: 26,
  md: 34,
  lg: 48,
  xl: 64,
};

export const BrandMark: React.FC<BrandMarkProps> = ({
  size = 'md',
  variant = 'gradient',
  className = '',
  style,
  glow = false,
  title = 'AgentWatch Symbol',
}) => {
  const uniqueId = useId().replace(/:/g, '');
  const dimension = typeof size === 'number' ? size : sizeMap[size] ?? 36;

  const aGradId = `aw-a-grad-${uniqueId}`;
  const orbitGradId = `aw-orbit-grad-${uniqueId}`;

  const isMono = variant === 'monochrome';
  const isWhite = variant === 'white';
  const isLight = variant === 'light';

  // Determine fills based on variant
  let aFill = `url(#${aGradId})`;
  let orbitStroke = `url(#${orbitGradId})`;
  let eyeOuter = '#FFFFFF';
  let eyePupil = '#0F172A';
  let eyeHighlight = '#FFFFFF';

  if (isMono) {
    aFill = '#0F172A';
    orbitStroke = '#0F172A';
    eyeOuter = '#FFFFFF';
    eyePupil = '#0F172A';
    eyeHighlight = '#FFFFFF';
  } else if (isWhite) {
    aFill = '#FFFFFF';
    orbitStroke = '#FFFFFF';
    eyeOuter = '#0F172A';
    eyePupil = '#FFFFFF';
    eyeHighlight = '#38BDF8';
  } else if (isLight) {
    // Light mode still uses vibrant brand gradients for A and orbit,
    // with high-contrast eye
    aFill = `url(#${aGradId})`;
    orbitStroke = `url(#${orbitGradId})`;
    eyeOuter = '#FFFFFF';
    eyePupil = '#0F172A';
    eyeHighlight = '#38BDF8';
  }

  return (
    <svg
      width={dimension}
      height={dimension}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`agentwatch-mark ${className}`}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        flexShrink: 0,
        overflow: 'visible',
        filter: glow ? `drop-shadow(0 0 10px rgba(59, 130, 246, 0.45))` : undefined,
        ...style,
      }}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <defs>
        {!isMono && !isWhite && (
          <>
            {/* Primary A Gradient: Cyan (#22D3EE) -> Royal Blue (#3B82F6) -> Violet (#8B5CF6) */}
            <linearGradient id={aGradId} x1="16" y1="16" x2="84" y2="84" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#22D3EE" />
              <stop offset="42%" stopColor="#3B82F6" />
              <stop offset="100%" stopColor="#8B5CF6" />
            </linearGradient>

            {/* Orbit Gradient: Cyan (#22D3EE) -> Sky Blue (#38BDF8) -> Blue (#3B82F6) -> Violet (#8B5CF6) */}
            <linearGradient id={orbitGradId} x1="8" y1="70" x2="92" y2="35" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#22D3EE" />
              <stop offset="35%" stopColor="#38BDF8" />
              <stop offset="70%" stopColor="#3B82F6" />
              <stop offset="100%" stopColor="#8B5CF6" />
            </linearGradient>
          </>
        )}
      </defs>

      {/* 1. Back of the Orbit Loop (sweeps behind right leg) */}
      <path
        d="M 44 41 C 58 35, 78 32, 88 36 C 96 40, 94 48, 83 55 C 76 59, 68 62, 59 64"
        stroke={orbitStroke}
        strokeWidth={5}
        strokeLinecap="round"
        fill="none"
      />

      {/* 2. Geometric Letter 'A' Form */}
      <path
        d="M 50 14 
           C 54 14, 57 16, 59 20 
           L 83 75 
           C 85 79, 83 84, 78 84 
           L 66 84 
           C 62 84, 59 81, 58 77 
           L 54 62 
           L 46 62 
           L 42 77 
           C 41 81, 38 84, 34 84 
           L 22 84 
           C 17 84, 15 79, 17 75 
           L 41 20 
           C 43 16, 46 14, 50 14 Z
           M 50 33
           C 47 33, 45 35, 44 38
           L 40 52
           L 60 52
           L 56 38
           C 55 35, 53 33, 50 33 Z"
        fill={aFill}
      />

      {/* 3. The Central Eye Icon in Counter */}
      <g className="agentwatch-mark-eye">
        {/* White outer eye contour */}
        <path
          d="M 37 46.5 C 41 40, 59 40, 63 46.5 C 59 53, 41 53, 37 46.5 Z"
          fill={eyeOuter}
        />
        {/* Dark pupil */}
        <circle cx="50" cy="46.5" r="4.2" fill={eyePupil} />
        {/* Specular light dot */}
        <circle cx="51.5" cy="45" r="1.3" fill={eyeHighlight} />
      </g>

      {/* 4. Front of the Orbit Loop (sweeps across front of left leg and under eye) */}
      <path
        d="M 59 64 C 47 66, 33 66, 20 63 C 11 60, 6 65, 8 70 C 10 74, 18 75, 27 73 C 36 71, 46 67, 54 64"
        stroke={orbitStroke}
        strokeWidth={5}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
};

export const AgentWatchIcon = BrandMark;
export default BrandMark;
