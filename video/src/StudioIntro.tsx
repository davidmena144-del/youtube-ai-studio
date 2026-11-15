import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const BG = '#05060A';
const INK = '#F5F5F7';
const MUTED = '#8A8F98';
const ACCENT = '#FF2E4C';

const FONT =
  '"Helvetica Neue", "Inter", system-ui, -apple-system, "Segoe UI", Arial, sans-serif';

export type StudioIntroProps = {
  brand: string;
  tagline: string;
};

/** Rounded play-triangle inside a ring. */
const PlayGlyph: React.FC<{size: number}> = ({size}) => {
  const r = size / 2;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <circle
        cx="50"
        cy="50"
        r="46"
        stroke={ACCENT}
        strokeWidth="3"
        opacity="0.9"
      />
      <circle cx="50" cy="50" r="46" fill={ACCENT} opacity="0.08" />
      <path
        d="M41 34.5 L70 50 L41 65.5 Z"
        fill={INK}
        strokeLinejoin="round"
        strokeWidth="6"
        stroke={INK}
      />
      <title>Play</title>
      <desc>YouTube AI Studio play mark, radius {r}</desc>
    </svg>
  );
};

export const StudioIntro: React.FC<StudioIntroProps> = ({brand, tagline}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames, width} = useVideoConfig();

  const sp = (delay: number, damping = 200) =>
    spring({frame: frame - delay, fps, config: {damping, mass: 0.8, stiffness: 120}});

  // Global slow push-in for a cinematic settle.
  const sceneScale = interpolate(frame, [0, durationInFrames], [1.06, 1.0], {
    easing: Easing.out(Easing.cubic),
  });

  // Background reveal.
  const bgIn = interpolate(frame, [0, 28], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Breathing glow.
  const pulse = 0.5 + 0.5 * Math.sin((frame / fps) * 1.6);
  const glowDriftX = interpolate(frame, [0, durationInFrames], [-40, 40]);

  // Play glyph entrance.
  const glyphP = sp(12, 14);
  const glyphScale = interpolate(glyphP, [0, 1], [0.55, 1]);
  const glyphRot = interpolate(glyphP, [0, 1], [-12, 0]);
  const glyphOpacity = interpolate(frame, [10, 26], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Eyebrow.
  const eyebrowIn = interpolate(frame, [30, 48], [0, 1], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
  });

  // Wordmark words.
  const words = brand.split(' ');
  const wordDelay = 46;

  // Underline sweep.
  const underline = interpolate(frame, [80, 108], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });

  // Tagline.
  const tagP = sp(96, 220);
  const tagY = interpolate(tagP, [0, 1], [24, 0]);
  const tagO = interpolate(frame, [96, 120], [0, 1], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
  });

  // Single diagonal light sweep across the wordmark.
  const sweep = interpolate(frame, [64, 104], [-1, 2], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Gentle outro settle (nothing jarring; hold the final frame clean).
  const outroDim = interpolate(frame, [224, 240], [0, 0.12], {
    extrapolateLeft: 'clamp',
  });

  return (
    <AbsoluteFill style={{backgroundColor: BG}}>
      {/* Scene wrapper with push-in */}
      <AbsoluteFill
        style={{
          transform: `scale(${sceneScale})`,
          transformOrigin: 'center center',
        }}
      >
        {/* Crimson glow */}
        <AbsoluteFill
          style={{
            opacity: bgIn,
            background: `radial-gradient(60% 55% at ${50 + glowDriftX / 20}% 46%, rgba(255,46,76,${0.22 +
              pulse * 0.1}) 0%, rgba(255,46,76,0.05) 38%, rgba(5,6,10,0) 70%)`,
            transform: `translateX(${glowDriftX}px)`,
          }}
        />

        {/* Secondary cool rim light */}
        <AbsoluteFill
          style={{
            opacity: bgIn * 0.8,
            background:
              'radial-gradient(45% 40% at 78% 80%, rgba(60,110,255,0.10) 0%, rgba(5,6,10,0) 65%)',
          }}
        />

        {/* Center content */}
        <AbsoluteFill
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            flexDirection: 'column',
          }}
        >
          {/* Play glyph */}
          <div
            style={{
              opacity: glyphOpacity,
              transform: `scale(${glyphScale}) rotate(${glyphRot}deg)`,
              marginBottom: 46,
              filter: 'drop-shadow(0 18px 50px rgba(255,46,76,0.35))',
            }}
          >
            <PlayGlyph size={128} />
          </div>

          {/* Eyebrow */}
          <div
            style={{
              opacity: eyebrowIn,
              transform: `translateY(${interpolate(eyebrowIn, [0, 1], [10, 0])}px)`,
              fontFamily: FONT,
              fontSize: 26,
              letterSpacing: 10,
              fontWeight: 600,
              color: MUTED,
              textTransform: 'uppercase',
              marginBottom: 26,
            }}
          >
            AI&nbsp;Video&nbsp;Studio
          </div>

          {/* Wordmark */}
          <div
            style={{
              position: 'relative',
              display: 'flex',
              gap: 26,
              fontFamily: FONT,
              fontSize: 132,
              fontWeight: 800,
              letterSpacing: -2,
              lineHeight: 1,
              overflow: 'hidden',
              padding: '0 8px',
            }}
          >
            {words.map((w, i) => {
              const p = sp(wordDelay + i * 8, 180);
              const y = interpolate(p, [0, 1], [130, 0]);
              const o = interpolate(frame, [wordDelay + i * 8, wordDelay + i * 8 + 16], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              });
              const isAccent = w.toUpperCase() === 'AI';
              return (
                <span
                  key={i}
                  style={{
                    display: 'inline-block',
                    transform: `translateY(${y}px)`,
                    opacity: o,
                    color: isAccent ? ACCENT : INK,
                    textShadow: isAccent
                      ? '0 10px 40px rgba(255,46,76,0.45)'
                      : '0 10px 40px rgba(0,0,0,0.5)',
                  }}
                >
                  {w}
                </span>
              );
            })}

            {/* Light sweep */}
            <AbsoluteFill
              style={{
                pointerEvents: 'none',
                mixBlendMode: 'overlay',
                background:
                  'linear-gradient(105deg, rgba(255,255,255,0) 40%, rgba(255,255,255,0.75) 50%, rgba(255,255,255,0) 60%)',
                transform: `translateX(${sweep * 100}%)`,
                opacity: sweep > -0.9 && sweep < 1.9 ? 1 : 0,
              }}
            />
          </div>

          {/* Underline */}
          <div
            style={{
              marginTop: 30,
              width: 560,
              height: 4,
              borderRadius: 4,
              background: `linear-gradient(90deg, ${ACCENT}, rgba(255,46,76,0))`,
              transform: `scaleX(${underline})`,
              transformOrigin: 'left center',
              opacity: 0.95,
            }}
          />

          {/* Tagline */}
          <div
            style={{
              opacity: tagO,
              transform: `translateY(${tagY}px)`,
              fontFamily: FONT,
              fontSize: 32,
              fontWeight: 500,
              color: MUTED,
              marginTop: 34,
              letterSpacing: 0.5,
            }}
          >
            {tagline}
          </div>
        </AbsoluteFill>

        {/* Vignette */}
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            background:
              'radial-gradient(120% 120% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)',
          }}
        />

        {/* Film grain */}
        <AbsoluteFill style={{opacity: 0.06, mixBlendMode: 'overlay'}}>
          <svg width="100%" height="100%">
            <filter id="grain">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.9"
                numOctaves="2"
                seed={frame % 97}
                stitchTiles="stitch"
              />
            </filter>
            <rect width="100%" height="100%" filter="url(#grain)" />
          </svg>
        </AbsoluteFill>

        {/* Outro dim */}
        <AbsoluteFill
          style={{backgroundColor: '#000', opacity: outroDim, pointerEvents: 'none'}}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
