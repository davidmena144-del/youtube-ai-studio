import {Composition} from 'remotion';
import {StudioIntro} from './StudioIntro';
import {Sizzle} from './Sizzle';
import './fonts';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SizzleAR"
        component={Sizzle}
        durationInFrames={1800}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          withAudio: false,
          audioSrc: 'vo.mp3',
          lang: 'ar' as const,
        }}
      />
      <Composition
        id="Sizzle"
        component={Sizzle}
        durationInFrames={1800}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          withAudio: false,
          audioSrc: 'vo.mp3',
          lang: 'en' as const,
        }}
      />
      <Composition
        id="StudioIntro"
        component={StudioIntro}
        durationInFrames={240}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          brand: 'YouTube AI Studio',
          tagline: 'Create · Edit · Publish — powered by AI',
        }}
      />
    </>
  );
};
