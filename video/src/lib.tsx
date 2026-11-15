import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {COLORS} from './theme';

/** Fade in/out envelope based on local frame within a scene. */
export const envelope = (
  frame: number,
  dur: number,
  fadeIn = 12,
  fadeOut = 14,
) =>
  interpolate(
    frame,
    [0, fadeIn, dur - fadeOut, dur],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

export const useSpring = (delay = 0, damping = 200, stiffness = 120) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({
    frame: frame - delay,
    fps,
    config: {damping, mass: 0.9, stiffness},
  });
};

/** Animated multi-stop radial glow background. */
export const GlowBG: React.FC<{
  hue?: string;
  hue2?: string;
  intensity?: number;
}> = ({hue = COLORS.accent, hue2 = COLORS.accent2, intensity = 1}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pulse = 0.5 + 0.5 * Math.sin((frame / fps) * 1.4);
  const drift = Math.sin((frame / fps) * 0.5) * 30;
  return (
    <AbsoluteFill style={{backgroundColor: COLORS.bg}}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(55% 55% at ${50 + drift / 8}% 42%, ${hexA(
            hue,
            (0.2 + pulse * 0.08) * intensity,
          )} 0%, ${hexA(hue, 0.04 * intensity)} 40%, rgba(5,6,10,0) 72%)`,
          transform: `translateX(${drift}px)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(40% 38% at 80% 82%, ${hexA(
            hue2,
            0.1 * intensity,
          )} 0%, rgba(5,6,10,0) 62%)`,
        }}
      />
    </AbsoluteFill>
  );
};

export const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      pointerEvents: 'none',
      background:
        'radial-gradient(125% 125% at 50% 50%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.6) 100%)',
    }}
  />
);

export const Grain: React.FC<{opacity?: number}> = ({opacity = 0.055}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{opacity, mixBlendMode: 'overlay'}}>
      <svg width="100%" height="100%">
        <filter id="g-noise">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            seed={frame % 97}
            stitchTiles="stitch"
          />
        </filter>
        <rect width="100%" height="100%" filter="url(#g-noise)" />
      </svg>
    </AbsoluteFill>
  );
};

/** Rounded play-triangle inside a ring. */
export const PlayGlyph: React.FC<{size: number; color?: string}> = ({
  size,
  color = COLORS.accent,
}) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
    <circle cx="50" cy="50" r="46" stroke={color} strokeWidth="3" opacity="0.9" />
    <circle cx="50" cy="50" r="46" fill={color} opacity="0.08" />
    <path
      d="M41 34.5 L70 50 L41 65.5 Z"
      fill={COLORS.ink}
      strokeLinejoin="round"
      strokeWidth="6"
      stroke={COLORS.ink}
    />
  </svg>
);

/** hex (#rrggbb) + alpha -> rgba() */
export function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export const EASE_OUT = Easing.out(Easing.cubic);
export const EASE_IN_OUT = Easing.inOut(Easing.cubic);

/** Staggered word reveal (rise + fade). */
export const KineticWords: React.FC<{
  text: string;
  delay?: number;
  stagger?: number;
  fontSize: number;
  weight?: number;
  accentWord?: string;
  color?: string;
  accentColor?: string;
  letterSpacing?: number;
  gap?: number;
  dir?: 'ltr' | 'rtl';
  fontFamily?: string;
}> = ({
  text,
  delay = 0,
  stagger = 6,
  fontSize,
  weight = 800,
  accentWord,
  color = COLORS.ink,
  accentColor = COLORS.accent,
  letterSpacing = -1.5,
  gap = 0.28,
  dir = 'ltr',
  fontFamily,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const words = text.split(' ');
  return (
    <div
      dir={dir}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: `0 ${gap * fontSize}px`,
        fontSize,
        fontFamily,
        fontWeight: weight,
        letterSpacing: dir === 'rtl' ? 0 : letterSpacing,
        lineHeight: 1.18,
        maxWidth: 1500,
      }}
    >
      {words.map((w, i) => {
        const d = delay + i * stagger;
        const p = spring({frame: frame - d, fps, config: {damping: 200, mass: 0.8, stiffness: 120}});
        const y = interpolate(p, [0, 1], [90, 0]);
        const o = interpolate(frame, [d, d + 14], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const isAccent =
          accentWord && w.replace(/[.,—]/g, '').toUpperCase() === accentWord.toUpperCase();
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              transform: `translateY(${y}px)`,
              opacity: o,
              color: isAccent ? accentColor : color,
              textShadow: isAccent
                ? `0 10px 44px ${hexA(accentColor, 0.5)}`
                : '0 10px 40px rgba(0,0,0,0.5)',
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};
