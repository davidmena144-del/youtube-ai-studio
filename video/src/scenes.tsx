import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {COLORS, FONT, MONO} from './theme';
import {
  envelope,
  GlowBG,
  Grain,
  hexA,
  KineticWords,
  PlayGlyph,
  useSpring,
  Vignette,
  EASE_OUT,
} from './lib';

/* ------------------------------------------------------------------ */
/* Scene 1 — Cold open / logo                                          */
/* ------------------------------------------------------------------ */
export const ColdOpen: React.FC<{dur: number}> = ({dur}) => {
  const frame = useCurrentFrame();
  const glyph = useSpring(8, 13);
  const bgIn = interpolate(frame, [0, 24], [0, 1], {extrapolateRight: 'clamp'});
  const flash = interpolate(frame, [44, 52, 70], [0, 0.5, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const out = interpolate(frame, [dur - 18, dur], [1, 0], {extrapolateLeft: 'clamp'});
  const scale = interpolate(frame, [0, dur], [1.08, 1.0], {easing: EASE_OUT});

  return (
    <AbsoluteFill style={{backgroundColor: COLORS.bg, opacity: out}}>
      <AbsoluteFill style={{transform: `scale(${scale})`, opacity: bgIn}}>
        <GlowBG intensity={1.1} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{justifyContent: 'center', alignItems: 'center', flexDirection: 'column', fontFamily: FONT}}
      >
        <div
          style={{
            opacity: interpolate(frame, [6, 22], [0, 1], {extrapolateRight: 'clamp'}),
            transform: `scale(${interpolate(glyph, [0, 1], [0.5, 1])}) rotate(${interpolate(
              glyph,
              [0, 1],
              [-14, 0],
            )}deg)`,
            marginBottom: 44,
            filter: 'drop-shadow(0 18px 55px rgba(255,46,76,0.4))',
          }}
        >
          <PlayGlyph size={132} />
        </div>
        <div style={{display: 'flex', gap: 26, fontSize: 128, fontWeight: 800, letterSpacing: -2}}>
          {['YouTube', 'AI', 'Studio'].map((w, i) => {
            const p = useSpringAt(26 + i * 7);
            return (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  transform: `translateY(${interpolate(p, [0, 1], [120, 0])}px)`,
                  opacity: interpolate(frame, [26 + i * 7, 42 + i * 7], [0, 1], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                  }),
                  color: w === 'AI' ? COLORS.accent : COLORS.ink,
                  textShadow: w === 'AI' ? `0 10px 44px ${hexA(COLORS.accent, 0.5)}` : '0 10px 40px rgba(0,0,0,.5)',
                }}
              >
                {w}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{backgroundColor: COLORS.accent, opacity: flash, mixBlendMode: 'screen'}} />
      <Vignette />
      <Grain />
    </AbsoluteFill>
  );
};

// helper used inside map (hooks must be stable → small wrapper)
function useSpringAt(delay: number) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  // inline spring to avoid import cycle quirks
  return Math.min(
    1,
    Math.max(
      0,
      1 - Math.exp(-Math.max(0, frame - delay) / 8) * Math.cos(Math.max(0, frame - delay) / 9),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Scene 2 — The promise                                               */
/* ------------------------------------------------------------------ */
export const PromiseScene: React.FC<{dur: number}> = ({dur}) => {
  const frame = useCurrentFrame();
  const op = envelope(frame, dur, 16, 16);
  const subO = interpolate(frame, [70, 100], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const subY = interpolate(frame, [70, 100], [24, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT});
  return (
    <AbsoluteFill style={{opacity: op}}>
      <GlowBG hue={COLORS.accent} intensity={0.9} />
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'column',
          fontFamily: FONT,
          padding: '0 140px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: 26,
            letterSpacing: 10,
            fontWeight: 700,
            color: COLORS.muted,
            textTransform: 'uppercase',
            marginBottom: 36,
            opacity: interpolate(frame, [4, 22], [0, 1], {extrapolateRight: 'clamp'}),
          }}
        >
          One&nbsp;idea&nbsp;→&nbsp;One&nbsp;studio
        </div>
        <KineticWords
          text="From idea to a published video — in minutes."
          fontSize={104}
          accentWord="minutes"
          delay={10}
          stagger={5}
        />
        <div
          style={{
            opacity: subO,
            transform: `translateY(${subY}px)`,
            marginTop: 40,
            fontSize: 34,
            fontWeight: 500,
            color: COLORS.muted,
          }}
        >
          Script, design, build, render — in one AI-native pipeline.
        </div>
      </AbsoluteFill>
      <Vignette />
      <Grain />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* Scene 3 — The 5-tool workflow                                       */
/* ------------------------------------------------------------------ */

const TOOLS = [
  {n: '01', title: 'Script & Ideas', desc: 'Describe a concept. The AI drafts a tight, scroll-stopping script.', tag: 'script.md', color: COLORS.accent3, Visual: MVScript},
  {n: '02', title: 'Design System', desc: 'A living DESIGN.md keeps every frame perfectly on brand.', tag: 'DESIGN.md', color: COLORS.accent2, Visual: MVDesign},
  {n: '03', title: 'Image → Code', desc: 'Turn any screenshot or sketch into production-ready UI code.', tag: 'Stitch', color: COLORS.accent, Visual: MVImageToCode},
  {n: '04', title: 'Motion & Render', desc: 'Motion, titles and transitions — rendered to MP4 in one click.', tag: 'Remotion', color: '#18B26B', Visual: MVRender},
  {n: '05', title: 'Auto QA', desc: 'Automated browser checks catch every glitch before you ship.', tag: 'Playwright', color: COLORS.accent2, Visual: MVQA},
];

export const ToolsScene: React.FC<{dur: number}> = ({dur}) => {
  const frame = useCurrentFrame();
  const op = envelope(frame, dur, 16, 16);
  const cardDur = dur / TOOLS.length;
  const active = Math.min(TOOLS.length - 1, Math.floor(frame / cardDur));

  return (
    <AbsoluteFill style={{opacity: op}}>
      <GlowBG hue={TOOLS[active].color} hue2={COLORS.accent2} intensity={0.7} />
      {/* header */}
      <div
        style={{
          position: 'absolute',
          top: 96,
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 22,
          fontFamily: FONT,
        }}
      >
        <span style={{fontSize: 24, letterSpacing: 8, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase'}}>
          How&nbsp;it&nbsp;works
        </span>
        <div style={{display: 'flex', gap: 10}}>
          {TOOLS.map((t, i) => (
            <div
              key={i}
              style={{
                width: i === active ? 34 : 10,
                height: 10,
                borderRadius: 6,
                background: i === active ? t.color : 'rgba(255,255,255,0.18)',
                transition: 'none',
              }}
            />
          ))}
        </div>
      </div>

      {TOOLS.map((t, i) => {
        const start = i * cardDur;
        const f = frame - start;
        if (f < -10 || f > cardDur + 10) return null;
        const inX = interpolate(f, [0, 16], [140, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT});
        const outX = interpolate(f, [cardDur - 14, cardDur], [0, -140], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
        const o = interpolate(f, [0, 14, cardDur - 12, cardDur], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
        const Visual = t.Visual;
        return (
          <AbsoluteFill
            key={i}
            style={{
              justifyContent: 'center',
              alignItems: 'center',
              opacity: o,
              transform: `translateX(${inX + outX}px)`,
            }}
          >
            <div style={{display: 'flex', alignItems: 'center', gap: 80, width: 1540, fontFamily: FONT}}>
              {/* left text */}
              <div style={{width: 560}}>
                <div style={{fontSize: 120, fontWeight: 800, color: hexA(t.color, 0.9), letterSpacing: -4, lineHeight: 1}}>
                  {t.n}
                </div>
                <div style={{fontSize: 60, fontWeight: 800, color: COLORS.ink, letterSpacing: -1.5, marginTop: 8}}>
                  {t.title}
                </div>
                <div style={{fontSize: 30, fontWeight: 500, color: COLORS.muted, marginTop: 22, lineHeight: 1.4}}>
                  {t.desc}
                </div>
                <div
                  style={{
                    marginTop: 30,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 18px',
                    borderRadius: 999,
                    border: `1px solid ${hexA(t.color, 0.5)}`,
                    background: hexA(t.color, 0.1),
                    fontFamily: MONO,
                    fontSize: 24,
                    color: COLORS.ink,
                  }}
                >
                  <span style={{width: 10, height: 10, borderRadius: 999, background: t.color}} />
                  {t.tag}
                </div>
              </div>
              {/* right visual panel */}
              <Panel accent={t.color}>
                <Visual f={f} color={t.color} />
              </Panel>
            </div>
          </AbsoluteFill>
        );
      })}
      <Vignette />
      <Grain />
    </AbsoluteFill>
  );
};

const Panel: React.FC<{accent: string; children: React.ReactNode}> = ({accent, children}) => (
  <div
    style={{
      width: 760,
      height: 460,
      borderRadius: 24,
      background: `linear-gradient(160deg, ${COLORS.panel2}, ${COLORS.panel})`,
      border: `1px solid ${COLORS.border}`,
      boxShadow: `0 40px 120px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px ${hexA(accent, 0.06)}`,
      overflow: 'hidden',
      position: 'relative',
      padding: 36,
    }}
  >
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(60% 40% at 80% 0%, ${hexA(accent, 0.14)}, transparent 70%)`,
      }}
    />
    <div style={{position: 'relative', height: '100%'}}>{children}</div>
  </div>
);

/* ---- mini visuals ---- */
function MVScript({f, color}: {f: number; color: string}) {
  const widths = [92, 78, 85, 60, 70];
  return (
    <div style={{height: '100%', display: 'flex', flexDirection: 'column', gap: 20, justifyContent: 'center', fontFamily: MONO}}>
      <div style={{fontSize: 22, color: COLORS.dim, marginBottom: 6}}>// ai is writing…</div>
      {widths.map((w, i) => {
        const grow = interpolate(f, [18 + i * 14, 40 + i * 14], [0, w], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
        const last = i === widths.length - 1;
        const cursorOn = f % 16 < 8;
        return (
          <div key={i} style={{display: 'flex', alignItems: 'center', gap: 8}}>
            <div style={{height: 20, width: `${grow}%`, borderRadius: 6, background: i === 0 ? hexA(color, 0.85) : 'rgba(255,255,255,0.22)'}} />
            {last && grow > 0 && cursorOn && <div style={{width: 3, height: 26, background: color}} />}
          </div>
        );
      })}
    </div>
  );
}

function MVDesign({f, color}: {f: number; color: string}) {
  const sw = [COLORS.accent, COLORS.accent2, COLORS.accent3, '#18B26B', COLORS.ink];
  return (
    <div style={{height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 34, fontFamily: FONT}}>
      <div style={{display: 'flex', gap: 16}}>
        {sw.map((c, i) => {
          const p = interpolate(f, [10 + i * 7, 26 + i * 7], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          return <div key={i} style={{width: 92, height: 92, borderRadius: 16, background: c, transform: `scale(${p})`, boxShadow: `0 10px 30px ${hexA(c, 0.4)}`}} />;
        })}
      </div>
      <div style={{display: 'flex', alignItems: 'baseline', gap: 20, opacity: interpolate(f, [40, 58], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
        <span style={{fontSize: 120, fontWeight: 800, color: COLORS.ink, letterSpacing: -4}}>Aa</span>
        <div style={{fontFamily: MONO, fontSize: 22, color: COLORS.muted, lineHeight: 1.6}}>
          <div>Display / 800</div>
          <div>Body / 500</div>
          <div style={{color}}>tokens · on-brand</div>
        </div>
      </div>
    </div>
  );
}

function MVImageToCode({f, color}: {f: number; color: string}) {
  const arrow = 0.5 + 0.5 * Math.sin(f / 6);
  const tokens = [
    [color, 46], ['#3C6EFF', 30], [COLORS.ink, 60],
    [COLORS.muted, 40], ['#18B26B', 52], [color, 34],
  ] as const;
  return (
    <div style={{height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 26}}>
      <div style={{width: 230, height: 300, borderRadius: 16, background: `linear-gradient(150deg, ${hexA(color, 0.9)}, ${hexA(COLORS.accent2, 0.7)})`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 20px 50px rgba(0,0,0,0.5)'}}>
        <PlayGlyph size={70} color={COLORS.ink} />
      </div>
      <div style={{fontSize: 56, color: COLORS.ink, opacity: 0.4 + arrow * 0.6, transform: `translateX(${arrow * 6}px)`}}>→</div>
      <div style={{width: 300, height: 300, borderRadius: 16, background: '#0A0C12', border: `1px solid ${COLORS.border}`, padding: 20, fontFamily: MONO, display: 'flex', flexDirection: 'column', gap: 13, justifyContent: 'center'}}>
        {tokens.map(([c, w], i) => {
          const grow = interpolate(f, [24 + i * 8, 40 + i * 8], [0, w as number], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          return (
            <div key={i} style={{display: 'flex', gap: 8, paddingLeft: i % 3 === 1 ? 22 : 0}}>
              <div style={{height: 14, width: 14, borderRadius: 4, background: c as string}} />
              <div style={{height: 14, width: `${grow}%`, borderRadius: 4, background: 'rgba(255,255,255,0.18)'}} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MVRender({f, color}: {f: number; color: string}) {
  const clips = [COLORS.accent, COLORS.accent2, COLORS.accent3];
  const playhead = interpolate(f, [10, 90], [0, 100], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const prog = interpolate(f, [30, 100], [0, 100], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const done = prog >= 100;
  return (
    <div style={{height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 30, fontFamily: MONO}}>
      <div style={{position: 'relative', height: 120, display: 'flex', flexDirection: 'column', gap: 12}}>
        {[0, 1].map((row) => (
          <div key={row} style={{display: 'flex', gap: 10, height: 52}}>
            {clips.map((c, i) => (
              <div key={i} style={{flex: [2, 3, 1.5][(i + row) % 3], borderRadius: 8, background: hexA(c, 0.8), boxShadow: `inset 0 0 0 1px ${hexA(c, 0.4)}`}} />
            ))}
          </div>
        ))}
        <div style={{position: 'absolute', top: -6, bottom: -6, left: `${playhead}%`, width: 3, background: COLORS.ink, boxShadow: '0 0 12px rgba(255,255,255,0.8)'}} />
      </div>
      <div>
        <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 22, color: COLORS.muted, marginBottom: 10}}>
          <span>{done ? 'render complete' : 'rendering…'}</span>
          <span style={{color: done ? '#18B26B' : color}}>{done ? 'studio.mp4 ✓' : `${Math.round(prog)}%`}</span>
        </div>
        <div style={{height: 16, borderRadius: 10, background: 'rgba(255,255,255,0.1)', overflow: 'hidden'}}>
          <div style={{height: '100%', width: `${prog}%`, borderRadius: 10, background: done ? '#18B26B' : `linear-gradient(90deg, ${color}, ${COLORS.accent3})`}} />
        </div>
      </div>
    </div>
  );
}

function MVQA({f, color}: {f: number; color: string}) {
  const checks = ['Accessibility · AA', 'Keyboard & focus', 'No layout shift', 'Links & forms OK'];
  return (
    <div style={{height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18, fontFamily: FONT}}>
      {checks.map((c, i) => {
        const on = f > 20 + i * 16;
        const p = interpolate(f, [20 + i * 16, 34 + i * 16], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
        return (
          <div key={i} style={{display: 'flex', alignItems: 'center', gap: 18, opacity: 0.3 + p * 0.7}}>
            <div style={{width: 40, height: 40, borderRadius: 10, background: on ? '#18B26B' : 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${0.8 + p * 0.2})`, boxShadow: on ? '0 8px 24px rgba(24,178,107,0.4)' : 'none'}}>
              <span style={{color: COLORS.ink, fontSize: 24, fontWeight: 800}}>✓</span>
            </div>
            <span style={{fontSize: 30, fontWeight: 600, color: on ? COLORS.ink : COLORS.muted}}>{c}</span>
          </div>
        );
      })}
      <div style={{marginTop: 10, fontFamily: MONO, fontSize: 22, color: f > 95 ? '#18B26B' : COLORS.dim}}>
        {f > 95 ? '→ all checks passed' : '→ running…'}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 4 — Stats                                                     */
/* ------------------------------------------------------------------ */
const STATS = [
  {value: 10, suffix: '×', label: 'faster to publish', color: COLORS.accent},
  {value: 60, suffix: 's', label: 'idea → rendered video', color: COLORS.accent2},
  {value: 100, suffix: '%', label: 'on-brand frames', color: COLORS.accent3},
  {value: 1, prefix: '', suffix: '-click', label: 'export to MP4', color: '#18B26B'},
];

export const StatsScene: React.FC<{dur: number}> = ({dur}) => {
  const frame = useCurrentFrame();
  const op = envelope(frame, dur, 16, 18);
  return (
    <AbsoluteFill style={{opacity: op}}>
      <GlowBG hue={COLORS.accent2} hue2={COLORS.accent} intensity={0.75} />
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', flexDirection: 'column', fontFamily: FONT}}>
        <div
          style={{
            fontSize: 26, letterSpacing: 9, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', marginBottom: 56,
            opacity: interpolate(frame, [6, 24], [0, 1], {extrapolateRight: 'clamp'}),
          }}
        >
          Built&nbsp;for&nbsp;speed
        </div>
        <div style={{display: 'flex', gap: 34}}>
          {STATS.map((s, i) => {
            const d = 14 + i * 9;
            const p = interpolate(frame, [d, d + 24], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT});
            const count = Math.round(interpolate(frame, [d, d + 40], [0, s.value], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));
            return (
              <div
                key={i}
                style={{
                  width: 380, padding: '44px 34px', borderRadius: 24,
                  background: `linear-gradient(160deg, ${COLORS.panel2}, ${COLORS.panel})`,
                  border: `1px solid ${COLORS.border}`,
                  boxShadow: `0 30px 90px rgba(0,0,0,0.5), 0 0 0 1px ${hexA(s.color, 0.08)}`,
                  transform: `translateY(${interpolate(p, [0, 1], [50, 0])}px) scale(${interpolate(p, [0, 1], [0.92, 1])})`,
                  opacity: p,
                }}
              >
                <div style={{fontSize: 112, fontWeight: 800, letterSpacing: -4, color: s.color, lineHeight: 1}}>
                  {s.prefix ?? ''}{count}
                  <span style={{fontSize: 64}}>{s.suffix}</span>
                </div>
                <div style={{marginTop: 18, fontSize: 28, fontWeight: 500, color: COLORS.muted}}>{s.label}</div>
                <div style={{marginTop: 22, height: 8, borderRadius: 6, background: 'rgba(255,255,255,0.08)', overflow: 'hidden'}}>
                  <div style={{height: '100%', width: `${p * 100}%`, background: s.color, borderRadius: 6}} />
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      <Vignette />
      <Grain />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* Scene 5 — CTA / outro                                               */
/* ------------------------------------------------------------------ */
const STEPS = ['Script.', 'Design.', 'Build.', 'Render.', 'Ship.'];

export const Outro: React.FC<{dur: number}> = ({dur}) => {
  const frame = useCurrentFrame();
  const op = envelope(frame, dur, 14, 2);

  // Phase 1: flashing steps (0 - 110). Phase 2: lockup (110 - end).
  const stepIdx = Math.floor(frame / 20);
  const lockIn = interpolate(frame, [116, 140], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT});
  const glyphP = interpolate(frame, [120, 150], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT});
  const ctaP = interpolate(frame, [168, 192], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT});
  const pulse = 0.5 + 0.5 * Math.sin(frame / 7);

  const showSteps = frame < 112;

  return (
    <AbsoluteFill style={{opacity: op}}>
      <GlowBG hue={COLORS.accent} intensity={1.0} />
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', flexDirection: 'column', fontFamily: FONT}}>
        {showSteps ? (
          <div style={{display: 'flex', gap: 30, fontSize: 92, fontWeight: 800, letterSpacing: -2}}>
            {STEPS.map((s, i) => {
              const shown = i <= stepIdx;
              const isCurrent = i === stepIdx;
              return (
                <span
                  key={i}
                  style={{
                    color: shown ? (isCurrent ? COLORS.accent : COLORS.ink) : 'rgba(255,255,255,0.12)',
                    opacity: shown ? 1 : 0.4,
                    transform: `translateY(${shown ? 0 : 16}px) scale(${isCurrent ? 1.04 : 1})`,
                    textShadow: isCurrent ? `0 10px 44px ${hexA(COLORS.accent, 0.55)}` : 'none',
                  }}
                >
                  {s}
                </span>
              );
            })}
          </div>
        ) : (
          <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: lockIn}}>
            <div style={{transform: `scale(${interpolate(glyphP, [0, 1], [0.6, 1])})`, marginBottom: 34, filter: 'drop-shadow(0 18px 55px rgba(255,46,76,0.45))'}}>
              <PlayGlyph size={104} />
            </div>
            <div style={{fontSize: 108, fontWeight: 800, letterSpacing: -2, display: 'flex', gap: 22}}>
              <span style={{color: COLORS.ink}}>YouTube</span>
              <span style={{color: COLORS.accent, textShadow: `0 10px 44px ${hexA(COLORS.accent, 0.5)}`}}>AI</span>
              <span style={{color: COLORS.ink}}>Studio</span>
            </div>
            <div style={{marginTop: 24, fontSize: 32, fontWeight: 500, letterSpacing: 2, color: COLORS.muted}}>
              Create&nbsp;·&nbsp;Edit&nbsp;·&nbsp;Publish
            </div>
            <div
              style={{
                marginTop: 46,
                opacity: ctaP,
                transform: `translateY(${interpolate(ctaP, [0, 1], [20, 0])}px)`,
                padding: '20px 46px',
                borderRadius: 999,
                background: COLORS.accent,
                color: COLORS.ink,
                fontSize: 32,
                fontWeight: 700,
                boxShadow: `0 20px 60px ${hexA(COLORS.accent, 0.35 + pulse * 0.25)}`,
              }}
            >
              Start building today →
            </div>
            <div style={{marginTop: 30, fontFamily: MONO, fontSize: 24, color: COLORS.dim, opacity: ctaP}}>
              github.com / youtube-ai-studio
            </div>
          </div>
        )}
      </AbsoluteFill>
      <Vignette />
      <Grain />
    </AbsoluteFill>
  );
};
