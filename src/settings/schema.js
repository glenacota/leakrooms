import { DIFFICULTIES, WATER_TINTS } from '../config/presets.js';

/* Every setting in one place: its default, its type, and its allowed range.
   The store checks values against this and does not trust whatever is in
   localStorage: an old save, a hand-edited value or a half-written one falls
   back to the default for THAT FIELD and leaves the rest alone. */
export const SETTINGS_SPEC = {
  difficulty:     { default:'normal', type:'enum', values:Object.keys(DIFFICULTIES) },
  master:         { default:0.7, type:'range', min:0, max:1 },
  /* M is a toggle, not a slider position, so it is a bool and has no control in
     the settings panel. It is a hotkey, and the only place it shows is the message
     it raises when you press it. It is saved like everything else, so the game
     stays muted after a reload. */
  muted:          { default:false, type:'bool' },
  waterHue:       { default:'slate', type:'enum', values:Object.keys(WATER_TINTS) },
  waterContrast:  { default:1.0, type:'range', min:0.4, max:2 },
  /* The continuous audio beds (hum, hiss, noise-floor, leak gurgle, drone, title
     ambience) at a level independent of the one-shot SFX. The beds are atmosphere;
     the one-shots are the information channel. A player who wants the info without
     the drone has no way to separate them with only the master slider. */
  ambience:       { default:0.6, type:'range', min:0, max:1 },
  /* The VHS/tape post-pass strength, as a fraction of VHS_PASS. 1.0 is the full
     tape look; 0 strips the scanlines, grain, tracking band and chroma ghost.
     This is a look setting, not a gameplay one: it never touches the noise table,
     the lightmap or the vision cone. */
  crt:            { default:1.0, type:'range', min:0, max:1 },
  /* Whether the #flashnote overlay shows at all. The sudden bright text is a
     photosensitivity trigger; a player who needs it off turns it off here. The
     opacity is a constant, so the toggle is on/off and not a dimmer. */
  flash:          { default:true, type:'bool' },
  /* The touch settings. They only show in touch mode, but they are stored like
     the rest, so a player who plays on both keeps them. How much of the HUD panel
     shows on touch: 'auto' fades it when nothing needs reading (ui/touch-hud-rules.js),
     'always' keeps it up, 'minimal' wakes it for noise and the clock only. */
  touchHud:       { default:'auto', type:'enum', values:['auto','always','minimal'] },
  /* Which side of the screen the MOVE stick is on. The radar button takes the
     other side. */
  touchSide:      { default:'left', type:'enum', values:['left','right'] },
  /* Short buzzes for the sounds that mean danger, on phones that can vibrate.
     It is separate from mute: a player can have the sound off and still feel it. */
  haptics:        { default:true, type:'bool' },
};

export const SETTINGS_DEFAULTS = Object.fromEntries(
  Object.entries(SETTINGS_SPEC).map(([k, s]) => [k, s.default]));

export const SETTINGS_SCHEMA = Object.fromEntries(
  Object.entries(SETTINGS_SPEC).map(([k, { default: _, ...rule }]) => [k, rule]));

export const SETTINGS_KEY = 'leakrooms.settings.v1';


// True if `v` is an allowed value for the setting called `key`.
export function settingsValid(key, v){
  const s = SETTINGS_SCHEMA[key];
  if (!s) return false;
  if (s.type === 'enum') return s.values.indexOf(v) >= 0;
  if (s.type === 'bool') return typeof v === 'boolean';
  if (s.type === 'range') return typeof v === 'number' && Number.isFinite(v)
                            && v >= s.min && v <= s.max;
  return false;
}
