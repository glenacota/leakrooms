import { engine } from './engine.js';
import { voices } from './voices.js';
import { ambience } from './ambience.js';

/* Assign methods AFTER state: the original literal declares `drone: null`
   and later a `drone()` method, so the method must win. Object.assign in
   this order keeps drone (and every other voice) a function. */
export const Audio_ = engine;
Object.assign(Audio_, voices, ambience);
