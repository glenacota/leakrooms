import { Audio_ } from '../audio/index.js';
import { setState, startRun, STATE } from '../game/run.js';
import { openBinder } from './binder.js';
import { show } from './dom.js';

/* Starts or stops the ambient room sound to match the current state. It
   follows STATE and not the individual screens, because show() is also how the
   pause screen appears, and the title sound must not leak into the pause menu.

   The floor clear card counts as a menu: the room hum keeps playing under it.
   What stops there is the floor's own sound (the leak and noise beds), which
   is closed by the 'state' event. */
export function syncAmbience(){
  Audio_.ambience(STATE==='splash' || STATE==='binder' || STATE==='clear');
}

/* The title menu. Each entry opens the binder on its own page. */
export const TITLE_MENU = ['clock-in', 'manual', 'settings'];
export let menuIndex = 0;

function paintMenu(){
  TITLE_MENU.forEach((name, i)=>{
    const el = document.getElementById('menu-' + (name==='clock-in' ? 'clock-in' : name));
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

/** Opens the binder from the title for the selected (or given) menu entry. @param {string} [entry] */
export function activateMenu(entry){
  if (STATE!=='splash') return;
  if (entry) selectMenu(entry);
  const name = TITLE_MENU[menuIndex];
  const tab = name==='clock-in' ? 'order'
            : name==='manual' ? 'manual' : 'settings';
  setState('binder');
  openBinder('shift', tab);
  show('binder');
  syncAmbience();
}

/** BEGIN SHIFT: starts the run. */
export function beginShift(){
  startRun();
  syncAmbience();
}

// ESC: one step back (binder to title). Returns false when there is nothing behind the current screen.
export function backSplash(){
  if (STATE==='binder'){ setState('splash'); show('splash'); syncAmbience(); return true; }
  return false;
}
