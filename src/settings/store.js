import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA, SETTINGS_KEY, settingsValid } from './schema.js';
import { emit } from '../util/events.js';

export let SETTINGS = Object.assign({}, SETTINGS_DEFAULTS);

/* Read the store. EVERY failure path returns defaults for the affected field
   and never throws: localStorage is absent in the headless suite, throws on
   some file:// origins, and can be disabled entirely in private browsing. A
   settings system is never allowed to be the reason the game does not start. */
export function loadSettings(){
  /* Always load over DEFAULTS rather than over whatever is live. The first
     version overlaid onto the current SETTINGS, which meant the result
     depended on WHEN it was called: a field absent from the blob kept
     whatever value it happened to hold, so loading a partial blob after a
     Hard run left you Hard. Loading is a total function of the blob and
     nothing else. */
  SETTINGS = Object.assign({}, SETTINGS_DEFAULTS);
  let raw = null;
  try { raw = localStorage.getItem(SETTINGS_KEY); } catch(e){ return SETTINGS; }
  if (!raw) return SETTINGS;
  let obj = null;
  try { obj = JSON.parse(raw); } catch(e){ return SETTINGS; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return SETTINGS;
  for (const k of Object.keys(SETTINGS_SCHEMA)){
    if (Object.prototype.hasOwnProperty.call(obj, k) && settingsValid(k, obj[k])){
      SETTINGS[k] = obj[k];
    }
  }
  return SETTINGS;
}

export function saveSettings(){
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS)); return true; }
  catch(e){ return false; }
}

/* RESET SETTINGS. `keepTerms` exists for one caller: the pause ticket's RESET
   button, which lives on the page of a run that was clocked in on a stamped set
   of terms. Terms are stamped once, at the door, for the whole shift — so
   resetting them from a page of that run moved the floor clock and the repair
   time out from under the player mid-run, and the button that says "reset
   settings" did it silently. Every other caller gets the clean slate. */
export function resetSettings(opts){
  const terms = (opts && opts.keepTerms) ? SETTINGS.difficulty : null;
  SETTINGS = Object.assign({}, SETTINGS_DEFAULTS);
  if (terms) SETTINGS.difficulty = terms;
  /* The 'settings:changed' listener in game.js raises waterDirty, which repacks the
     water image; nothing to call from here. */
  emit('settings:changed', '*');
  saveSettings();
}

export function setOption(key, value){
  if (!settingsValid(key, value)) return false;
  SETTINGS[key] = value;
  /* packWet bakes the tint into the pixels, so a new tint is a stale image even
     though G.wetArr has not moved. The handler raises waterDirty for the tint
     keys; here we just announce the change. */
  emit('settings:changed', key);
  saveSettings();
  return true;
}

// re-export schema helpers for convenience
export { SETTINGS_DEFAULTS, SETTINGS_SCHEMA, SETTINGS_KEY, settingsValid };
