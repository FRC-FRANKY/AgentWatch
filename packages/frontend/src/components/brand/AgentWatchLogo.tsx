import React from 'react';
import { Link } from 'react-router-dom';
import { BrandMark, BrandMarkVariant } from './BrandMark';

export type LogoVariant = 'auto' | 'dark' | 'light' | 'monochrome';

export interface AgentWatchLogoProps {
  variant?: LogoVariant;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showTagline?: boolean;
  iconOnly?: boolean;
  collapsed?: boolean;
  linkTo?: string;
  className?: string;
  style?: React.CSSProperties;
  glow?: boolean;
}

const fontSizes: Record<string, { title: string; tagline: string; gap: number; letterSpacing?: string }> = {
  sm: { title: '1.15rem', tagline: '0.50rem', gap: 10, letterSpacing: '0.16em' },
  md: { title: '1.38rem', tagline: '0.52rem', gap: 10, letterSpacing: '0.15em' },
  lg: { title: '1.95rem', tagline: '0.70rem', gap: 14, letterSpacing: '0.22em' },
  xl: { title: '2.5rem', tagline: '0.82rem', gap: 18, letterSpacing: '0.24em' },
};

export const AgentWatchLogo: React.FC<AgentWatchLogoProps> = ({
  variant = 'auto',
  size = 'md',
  showTagline = false,
  iconOnly = false,
  collapsed = false,
  linkTo,
  className = '',
  style,
  glow = false,
}) => {
  const isCollapsed = iconOnly || collapsed;
  const isMono = variant === 'monochrome';
  const isExplicitLight = variant === 'light';
  const isExplicitDark = variant === 'dark';

  const markVariant: BrandMarkVariant = isMono
    ? 'monochrome'
    : isExplicitLight
      ? 'light'
      : isExplicitDark
        ? 'gradient'
        : 'gradient';

  // Explicit inline color overrides only when requested; 'auto' defers to CSS tokens
  let agentInlineColor: string | undefined = undefined;
  let taglineInlineColor: string | undefined = undefined;

  if (isExplicitLight) {
    agentInlineColor = '#0F172A';
    taglineInlineColor = '#475569';
  } else if (isExplicitDark) {
    agentInlineColor = '#FFFFFF';
    taglineInlineColor = '#94A3B8';
  } else if (isMono) {
    agentInlineColor = 'currentColor';
    taglineInlineColor = 'currentColor';
  }

  const dimensions = fontSizes[size] || fontSizes.md;

  const content = (
    <div
      className={`agentwatch-logo-container size-${size} variant-${variant} ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: `${dimensions.gap}px`,
        textDecoration: 'none',
        lineHeight: 1,
        userSelect: 'none',
        ...style,
      }}
    >
      <BrandMark size={size} variant={markVariant} glow={glow} />

      {!isCollapsed && (
        <div
          className="agentwatch-wordmark-wrapper"
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            minWidth: 0,
          }}
        >
          <div
            className="agentwatch-wordmark"
            style={{
              fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
              fontSize: dimensions.title,
              fontWeight: 800,
              letterSpacing: '-0.025em',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'baseline',
            }}
          >
            <span
              className="agentwatch-wordmark-agent"
              style={{
                color: agentInlineColor,
              }}
            >
              Agent
            </span>
            {isMono ? (
              <span
                className="agentwatch-wordmark-watch"
                style={{
                  color: agentInlineColor,
                }}
              >
                Watch
              </span>
            ) : (
              <span
                className="agentwatch-wordmark-watch"
                style={{
                  background: 'linear-gradient(135deg, var(--logo-watch-start, #3B82F6) 0%, var(--logo-watch-end, #8B5CF6) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                Watch
              </span>
            )}
          </div>

          {showTagline && (
            <div
              className="agentwatch-tagline"
              style={{
                fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                fontSize: dimensions.tagline,
                fontWeight: 700,
                letterSpacing: dimensions.letterSpacing || '0.16em',
                color: taglineInlineColor,
                textTransform: 'uppercase',
                marginTop: '3px',
                whiteSpace: 'nowrap',
              }}
            >
              REMOTE WORKSTATION MONITORING
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (linkTo) {
    return (
      <Link
        to={linkTo}
        style={{ textDecoration: 'none', color: 'inherit', display: 'inline-flex', minWidth: 0, alignItems: 'center' }}
        aria-label="AgentWatch Home"
      >
        {content}
      </Link>
    );
  }

  return content;
};

export default AgentWatchLogo;
