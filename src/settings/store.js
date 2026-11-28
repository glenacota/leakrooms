import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA, SETTINGS_KEY, settingsValid } from './schema.js';
import { DIFFICULTIES } from '../config/presets.js';
import { emit, EVENT } from '../util/events.js';

export let SETTINGS = Object.assign({}, SETTINGS_DEFAULTS);

let shakeExplicit = false;
let motionPreference = null;
let motionPreferenceListener = null;
let motionPreferenceFactory = null;

export function currentTerms(){ return DIFFICULTIES[SETTINGS.difficulty]; }

/* Storage failures and partial saves must not prevent startup. Only valid
   fields from the saved data override fresh defaults. */
export function loadSettings(){
  shakeExplicit = false;
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
      if (k === 'shake') shakeExplicit = true;
    }
  }
  return SETTINGS;
}

export function saveSettings(){
  const saved = { ...SETTINGS };
  if (!shakeExplicit) delete saved.shake;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved)); return true; }
  catch(e){ return false; }
}

/* Resetting difficulty mid-floor would change the clock and repair time, so
   the pause screen keeps the current terms. */
export function resetSettings(opts){
  const difficulty = (opts && opts.keepTerms) ? SETTINGS.difficulty : null;
  shakeExplicit = false;
  SETTINGS = makeDefaultSettings();
  if (difficulty) SETTINGS.difficulty = difficulty;
  emit(EVENT.settingsChanged, '*');
  saveSettings();
}

export function setOption(key, value){
  if (!settingsValid(key, value)) return false;
  if (key === 'shake') shakeExplicit = true;
  SETTINGS[key] = value;
  emit(EVENT.settingsChanged, key);
  saveSettings();
  return true;
}

function makeDefaultSettings(){
  bindMotionPreference();
  const defaults = Object.assign({}, SETTINGS_DEFAULTS);
  if (motionPreference?.matches) defaults.shake = 'off';
  return defaults;
}

function bindMotionPreference(){
  const factory = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia : null;
  if (factory === motionPreferenceFactory) return;
  if (motionPreference && motionPreferenceListener){
    if (typeof motionPreference.removeEventListener === 'function')
      motionPreference.removeEventListener('change', motionPreferenceListener);
    else if (typeof motionPreference.removeListener === 'function')
      motionPreference.removeListener(motionPreferenceListener);
  }
  motionPreferenceFactory = factory;
  motionPreference = factory ? factory.call(window, '(prefers-reduced-motion: reduce)') : null;
  motionPreferenceListener = null;
  if (!motionPreference) return;

  motionPreferenceListener = () => {
    if (shakeExplicit) return;
    const shake = motionPreference.matches ? 'off' : 'full';
    if (SETTINGS.shake === shake) return;
    SETTINGS.shake = shake;
    emit(EVENT.settingsChanged, 'shake');
  };
  if (typeof motionPreference.addEventListener === 'function')
    motionPreference.addEventListener('change', motionPreferenceListener);
  else if (typeof motionPreference.addListener === 'function')
    motionPreference.addListener(motionPreferenceListener);
}