import { engine } from './engine.js';
import { voices } from './voices.js';
import { ambience } from './ambience.js';

/* Puts the audio together: the engine (context, graph, volume, mute) with the
   one-shot voices and the title-screen bed added on top. The methods are copied
   on AFTER the engine's own fields. The engine declares `drone: null` and the
   voices define a `drone()` method, and copying in this order makes the method
   win, so drone (and every other voice) stays a function. */
export const Audio_ = engine;
Object.assign(Audio_, voices, ambience);