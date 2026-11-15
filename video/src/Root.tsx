import {Composition} from 'remotion';
import {StudioIntro} from './StudioIntro';
import {Sizzle} from './Sizzle';

export const RemotionRoot: React.FC = () => {
  return (
    <>
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
