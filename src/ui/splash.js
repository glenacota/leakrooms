import { Audio_ } from '../audio/index.js';
import { setState, startRun, STATE } from '../game/run.js';
import { openBinder } from './binder.js';

import { currentTerms } from '../settings/store.js';
import { openLeaderboard } from './leaderboard.js';
import { showScreen } from './dom.js';
import { on, EVENT } from '../util/events.js';

/* Starts or stops the ambient room sound to match the current state. */
export function syncAmbience(){
  Audio_.ambience(STATE==='splash' || STATE==='binder' || STATE==='clear');
}

/* The title menu. Each entry opens the binder on its own page. */
export const TITLE_MENU = ['start', 'leaderboard'];
export let menuIndex = 0;

function paintMenu(){
  TITLE_MENU.forEach((name, i)=>{
    const el = document.getElementById('menu-' + name);
    if (el){ el.classList.toggle('sel', i===menuIndex); el.setAttribute('aria-current', String(i===menuIndex)); }
  });
}

/** Moves the title menu selection, wrapping at the ends. @param {number} delta */
export function moveMenu(delta){
  menuIndex = (menuIndex + delta + TITLE_MENU.length) % TITLE_MENU.length;
  paintMenu();
}

/** Sets the title menu selection by name or index. @param {string|number} which */
export function selectMenu(which){
  const i = typeof which==='number' ? which : TITLE_MENU.indexOf(which);
  if (i >= 0){ menuIndex = i; paintMenu(); }
}

function openShiftBinder(tab){
  setState('binder');
  openBinder('shift', tab);
  showScreen('binder');
  syncAmbience();
}

/** Opens the binder from the title for the selected (or given) menu entry. @param {string} [entry] */
export function activateMenu(entry){
  if (STATE!=='splash') return;
  if (entry) selectMenu(entry);
  const name = TITLE_MENU[menuIndex];
  if (name === 'leaderboard') {
    openLeaderboard(currentTerms().label, 'splash');
  } else {
    const tab = name==='start' ? 'order' : name;
    openShiftBinder(tab);
  }
}

/** Returns to the start binder on the Order tab. */
export function returnToOrder(){
  openShiftBinder('order');
}

/** BEGIN MISSION: starts the run. */
export function beginShift(){
  startRun();
  syncAmbience();
}

// ESC returns from end and binder screens to the title.
export function backSplash(){
  if (STATE==='binder' || STATE==='dead' || STATE==='win'){
    setState('splash');
    showScreen('splash');
    syncAmbience();
    return true;
  }
  return false;
}

/* Wires the state listener for ambience: the room bed follows the run state. */
export function bindStateAmbience(){
  on(EVENT.state, () => syncAmbience());
}
