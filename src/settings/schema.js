import { DIFFICULTIES, WATER_TINTS } from '../config/presets.js';

export const SETTINGS_DEFAULTS = {
  difficulty: 'normal',
  master: 0.7,
  /* M is a toggle, not a slider position, so it is stored as a bool and has no
     control in the settings panel. It is a hotkey, and the only place it shows
     is the message it raises when you press it. It is saved like everything
     else, so the game stays muted after a reload. */
  muted: false,
  waterHue: 'slate',
  waterContrast: 1.0,
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