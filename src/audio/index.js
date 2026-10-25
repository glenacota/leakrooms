import { engine } from './engine.js';
import { voices } from './voices.js';
import { ambience } from './ambience.js';

/* Puts the audio together: the engine (context, graph, volume, mute) with the
   one-shot voices and the title-screen bed added on top. */
export const Audio_ = engine;
Object.assign(Audio_, voices, ambience);