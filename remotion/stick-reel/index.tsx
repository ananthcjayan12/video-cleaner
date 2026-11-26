import { Composition, registerRoot } from 'remotion';
import { Reel, demoScenes } from './Reel';

registerRoot(() => (
  <Composition
    id="ReelStudio"
    component={Reel}
    durationInFrames={360}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{ scenes: demoScenes, words: [], duration: 12 }}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.max(30, Math.ceil(props.duration * 30)) })}
  />
));
