import { DIFFICULTIES, WATER_TINTS } from '../config/presets.js';
import { STICK } from '../config/constants.js';

export const SETTINGS_SPEC = {
  difficulty:     { default:'normal', type:'enum', values:Object.keys(DIFFICULTIES) },
  master:         { default:0.7, type:'range', min:0, max:1 },
  muted:          { default:false, type:'bool' },
  waterHue:       { default:'slate', type:'enum', values:Object.keys(WATER_TINTS) },
  waterContrast:  { default:1.0, type:'range', min:0.4, max:2 },
  /* The continuous audio beds (hum, hiss, noise-floor, leak gurgle, drone, title
     ambience) at a level independent of the SFX. */
  ambience:       { default:0.6, type:'range', min:0, max:1 },
  /* The VHS/tape post-pass strength, as a fraction of RENDER.VHS_PASS. 1.0 is the full
     tape look; 0 strips the scanlines, grain, tracking band and chroma ghost. */
  crt:            { default:1.0, type:'range', min:0, max:1 },
  // Whether the flash notes overlay shows at all
  flash:          { default:true, type:'bool' },
  // Illustrated tutorials appear during play when you encounter key mechanics
  tutorials:      { default:true, type:'bool' },
  /* The touch settings show only in touch mode, but they are stored like the rest, for
     players who play on both. How much of the HUD panel shows on touch: 'auto' fades it when 
     nothing needs reading, 'always' up, 'minimal' wakes it for noise and the clock only. */
  touchHud:       { default:'auto', type:'enum', values:['auto','always','minimal'] },
  // Which side of the screen the MOVE stick is on. The radar button takes the other side
  touchSide:      { default:'left', type:'enum', values:['left','right'] },
  /* Short buzzes for the sounds that mean danger, on phones that can vibrate.
     It is separate from mute: a player can have the sound off and still feel it. */
  haptics:        { default:true, type:'bool' },
  fullscreen:     { default:'auto', type:'enum', values:['auto','off'] },
  sprintPush:     { default:'normal', type:'enum', values:Object.keys(STICK.SPRINT_PRESETS) },
};

export const SETTINGS_DEFAULTS = Object.fromEntries(
  Object.entries(SETTINGS_SPEC).map(([k, s]) => [k, s.default]));

export const SETTINGS_SCHEMA = Object.fromEntries(
  Object.entries(SETTINGS_SPEC).map(([k, { default: _, ...rule }]) => [k, rule]));

export const SETTINGS_KEY = 'leakrooms.settings.v1';


// True if `v` is an allowed value for the setting called `key`
export function settingsValid(key, v){
  const s = SETTINGS_SCHEMA[key];
  if (!s) return false;
  if (s.type === 'enum') return s.values.indexOf(v) >= 0;
  if (s.type === 'bool') return typeof v === 'boolean';
  if (s.type === 'range') return typeof v === 'number' && Number.isFinite(v)
                            && v >= s.min && v <= s.max;
  return false;
}
