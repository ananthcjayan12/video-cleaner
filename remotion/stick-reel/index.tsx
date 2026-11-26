import {Composition, registerRoot} from "remotion";
import {Reel, demoScenes} from "./Reel";

registerRoot(() => <Composition id="ReelStudio" component={Reel} durationInFrames={2000}
  fps={30} width={1080} height={1920} defaultProps={{scenes:demoScenes,words:[],duration:2000/30}}
  calculateMetadata={({props}) => ({durationInFrames:Math.ceil(props.duration*30)})}/>);
