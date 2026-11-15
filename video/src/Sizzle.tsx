import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile} from 'remotion';
import {COLORS} from './theme';
import {ColdOpen, PromiseScene, ToolsScene, StatsScene, Outro} from './scenes';

export type SizzleProps = {
  withAudio: boolean;
  audioSrc: string;
};

// Scene timeline (30fps · 1800 frames · 60s)
const S = {
  cold: {from: 0, dur: 150},
  promise: {from: 150, dur: 270},
  tools: {from: 420, dur: 690},
  stats: {from: 1110, dur: 360},
  outro: {from: 1470, dur: 330},
};

export const Sizzle: React.FC<SizzleProps> = ({withAudio, audioSrc}) => {
  return (
    <AbsoluteFill style={{backgroundColor: COLORS.bg}}>
      {withAudio ? <Audio src={staticFile(audioSrc)} volume={1} /> : null}

      <Sequence from={S.cold.from} durationInFrames={S.cold.dur}>
        <ColdOpen dur={S.cold.dur} />
      </Sequence>

      <Sequence from={S.promise.from} durationInFrames={S.promise.dur}>
        <PromiseScene dur={S.promise.dur} />
      </Sequence>

      <Sequence from={S.tools.from} durationInFrames={S.tools.dur}>
        <ToolsScene dur={S.tools.dur} />
      </Sequence>

      <Sequence from={S.stats.from} durationInFrames={S.stats.dur}>
        <StatsScene dur={S.stats.dur} />
      </Sequence>

      <Sequence from={S.outro.from} durationInFrames={S.outro.dur}>
        <Outro dur={S.outro.dur} />
      </Sequence>
    </AbsoluteFill>
  );
};
