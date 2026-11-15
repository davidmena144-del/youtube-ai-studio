import {Composition} from 'remotion';
import {StudioIntro} from './StudioIntro';

export const RemotionRoot: React.FC = () => {
  return (
    <>
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
