import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA, SETTINGS_KEY, settingsValid } from './schema.js';
import { DIFFICULTIES } from '../config/presets.js';
import { emit, EVENT } from '../util/events.js';

export let SETTINGS = Object.assign({}, SETTINGS_DEFAULTS);

export function currentTerms(){ return DIFFICULTIES[SETTINGS.difficulty]; }

/* Storage failures and partial saves must not prevent startup. Only valid
   fields from the saved data override fresh defaults. */
export function loadSettings(){
  SETTINGS = makeDefaultSettings();
  let savedJson = null;
  try { savedJson = localStorage.getItem(SETTINGS_KEY); } catch(e){ return SETTINGS; }
  if (!savedJson) return SETTINGS;
  let savedSettings = null;
  try { savedSettings = JSON.parse(savedJson); } catch(e){ return SETTINGS; }
  if (!savedSettings || typeof savedSettings !== 'object' || Array.isArray(savedSettings)) return SETTINGS;
  for (const k of Object.keys(SETTINGS_SCHEMA)){
    if (Object.prototype.hasOwnProperty.call(savedSettings, k) && settingsValid(k, savedSettings[k])){
      SETTINGS[k] = savedSettings[k];
    }
  }
  return SETTINGS;
}

export function saveSettings(){
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS)); return true; }
  catch(e){ return false; }
}

/* Resetting difficulty mid-floor would change the clock and repair time, so
   the pause screen keeps the current terms. */
export function resetSettings(opts){
  const difficulty = (opts && opts.keepTerms) ? SETTINGS.difficulty : null;
  SETTINGS = makeDefaultSettings();
  if (difficulty) SETTINGS.difficulty = difficulty;
  emit(EVENT.settingsChanged, '*');
  saveSettings();
}

export function setOption(key, value){
  if (!settingsValid(key, value)) return false;
  SETTINGS[key] = value;
  emit(EVENT.settingsChanged, key);
  saveSettings();
  return true;
}

function makeDefaultSettings(){
  return Object.assign({}, SETTINGS_DEFAULTS);
}