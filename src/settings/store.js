import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA, SETTINGS_KEY, settingsValid } from './schema.js';
import { DIFFICULTIES } from '../config/presets.js';
import { emit } from '../util/events.js';

export let SETTINGS = Object.assign({}, SETTINGS_DEFAULTS);

/* The difficulty preset the run is on. SETTINGS.difficulty is validated against
   DIFFICULTIES on every load and write, so it always names a real preset. */
export function currentTerms(){ return DIFFICULTIES[SETTINGS.difficulty]; }

/* Reads the saved settings. Every failure path falls back to the defaults for
   the affected field and never throws: localStorage is missing in the test
   harness, throws on some file:// origins, and can be disabled in private
   browsing. The settings must never be the reason the game does not start. */
export function loadSettings(){
  /* Always start from the defaults, not from the live values. Otherwise the
     result would depend on when this is called: a field missing from the saved
     data would keep whatever it held, so loading a partial save after a HARD run
     would leave you on HARD. */
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

/* RESET SETTINGS. `keepTerms` is for the pause screen's RESET button only. That
   button sits on a run that was clocked in on a fixed difficulty, and resetting
   the difficulty mid-run would change the floor clock and repair time under the
   floor being played. Every other caller gets a clean slate. */
export function resetSettings(opts){
  const terms = (opts && opts.keepTerms) ? SETTINGS.difficulty : null;
  SETTINGS = Object.assign({}, SETTINGS_DEFAULTS);
  if (terms) SETTINGS.difficulty = terms;
  emit('settings:changed', '*');
  saveSettings();
}

export function setOption(key, value){
  if (!settingsValid(key, value)) return false;
  SETTINGS[key] = value;
  emit('settings:changed', key);
  saveSettings();
  return true;
}

// The schema lives in schema.js; importers read it from there.