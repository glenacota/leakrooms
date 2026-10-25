import { DIFFICULTIES, WATER_TINTS } from '../config/presets.js';

export const SETTINGS_DEFAULTS = {
  difficulty: 'normal',
  master: 0.7,
  /* M is a toggle, not a slider position, so it is a bool and has no control in
     the settings panel. It is a hotkey, and the only place it shows is the message
     it raises when you press it. It is saved like everything else, so the game
     stays muted after a reload. */
  muted: false,
  waterHue: 'slate',
  waterContrast: 1.0,
  /* The continuous audio beds (hum, hiss, noise-floor, leak gurgle, drone, title
     ambience) at a level independent of the one-shot SFX. The beds are atmosphere;
     the one-shots are the information channel. A player who wants the info without
     the drone has no way to separate them with only the master slider. */
  ambience: 0.6,
  /* The VHS/tape post-pass strength, as a fraction of VHS_PASS. 1.0 is the full
     tape look; 0 strips the scanlines, grain, tracking band and chroma ghost.
     This is a look setting, not a gameplay one: it never touches the noise table,
     the lightmap or the vision cone. */
  crt: 1.0,
  /* Whether the #flashnote overlay shows at all. The sudden bright text is a
     photosensitivity trigger; a player who needs it off turns it off here. The
     opacity is a constant, so the toggle is on/off and not a dimmer. */
  flash: true,
  /* The touch settings. They only show in touch mode, but they are stored like
     the rest, so a player who plays on both keeps them. How much of the HUD panel
     shows on touch: 'auto' fades it when nothing needs reading (ui/touch-hud-rules.js),
     'always' keeps it up, 'minimal' wakes it for noise and the clock only. */
  touchHud: 'auto',
  /* Which side of the screen the MOVE stick is on. The radar button takes the
     other side. */
  touchSide: 'left',
  /* Short buzzes for the sounds that mean danger, on phones that can vibrate.
     It is separate from mute: a player can have the sound off and still feel it. */
  haptics: 'on',
};

/* Every field, its type, and its allowed range. The store checks values against
   this and does not trust whatever is in localStorage: an old save, a hand-edited
   value or a half-written one falls back to the default for THAT FIELD and leaves
   the rest alone. */
export const SETTINGS_SCHEMA = {
  difficulty:     { type:'enum', values:Object.keys(DIFFICULTIES) },
  master:         { type:'range', min:0, max:1 },
  muted:          { type:'bool' },
  waterHue:       { type:'enum', values:Object.keys(WATER_TINTS) },
  waterContrast:  { type:'range', min:0.4, max:2 },
  ambience:       { type:'range', min:0, max:1 },
  crt:            { type:'range', min:0, max:1 },
  flash:          { type:'bool' },
  touchHud:       { type:'enum', values:['auto','always','minimal'] },
  touchSide:      { type:'enum', values:['left','right'] },
  haptics:        { type:'enum', values:['on','off'] },
};

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