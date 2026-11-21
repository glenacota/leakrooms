/* ============================================================
   THE BINDER
   One screen, two modes. Before a shift it is the start binder (WORK ORDER,
   FIELD MANUAL, SETTINGS). While paused it is the same binder with a RUN page
   in place of the work order. The manual and settings pages are the same
   markup in both modes, so they cannot drift apart.

   The mode only picks which tabs show and whether the screen offers BEGIN or
   RESUME. STATE ('binder' or 'pause') stays the single source of truth for
   whether the clock runs.
   ============================================================ */

import { disarmReset } from '../game/run.js';
import { on, EVENT } from '../util/events.js';
import { catchPresenting } from '../util/catch-presentation.js';
import { showScreen, hideScreens } from './dom.js';

const SCREEN_FOR_STATE = Object.freeze({
  splash: 'splash',
  binder: 'binder',
  pause: 'binder',
  clear: 'clear',
  dead: 'dead',
  win: 'win',
});

function showStateScreen(state){
  if (state === null){
    hideScreens();
    return;
  }
  if (!Object.hasOwn(SCREEN_FOR_STATE, state))
    throw new RangeError(`Unknown run state: ${state}`);
  /* The death card waits for the catch beat; revealDeath() shows it later. */
  if (state === 'dead' && catchPresenting()) return;
  const screenId = SCREEN_FOR_STATE[state];
  showScreen(screenId);
}

/* Wires the screen listener: maps each run state to its overlay screen. */
export function bindScreen(){
  on(EVENT.screen, showStateScreen);
}

export const SHIFT_TABS = ['order', 'manual', 'settings'];
export const PAUSE_TABS = ['run', 'manual', 'settings'];
export const BINDER_MODES = ['shift', 'pause'];

export let binderMode = 'shift';        // 'shift' | 'pause'
export let binderTab = 'order';

const tabsFor = mode => {
  if (!BINDER_MODES.includes(mode)) throw new RangeError(`Unknown binder mode: ${mode}`);
  return mode === 'pause' ? PAUSE_TABS : SHIFT_TABS;
};

/**
 * Opens the binder in a mode on a tab. The caller shows the screen.
 *
 * @param {'shift'|'pause'} mode
 * @param {string} [tab] first tab of the mode when omitted or not valid there
 */
export function openBinder(mode, tab){
  tabsFor(mode);
  binderMode = mode;
  const screen = document.getElementById('screen-binder');
  if (screen) screen.dataset.binderMode = mode;
  for (const t of document.querySelectorAll('[data-binder-tab]'))
    t.hidden = !!(t.dataset.binderFor && t.dataset.binderFor !== mode);
  setBinderTab(tab);
}

/**
 * Turns to a tab. Also disarms RESET GAME, so an armed reset does not survive
 * the player moving to another page.
 *
 * @param {string} [tab]
 */
export function setBinderTab(tab){
  const list = tabsFor(binderMode);
  binderTab = list.includes(tab) ? tab : list[0];
  disarmReset();
  for (const p of document.querySelectorAll('[data-binder-page]'))
    p.hidden = p.dataset.binderPage !== binderTab;
  for (const t of document.querySelectorAll('[data-binder-tab]')){
    const selected = t.dataset.binderTab === binderTab;
    t.setAttribute('aria-selected', String(selected));
    t.tabIndex = selected ? 0 : -1;
  }
}

/** Turns one tab left (-1) or right (+1), wrapping at the ends. @param {number} delta */
export function stepBinderTab(delta){
  const list = tabsFor(binderMode);
  const at = Math.max(0, list.indexOf(binderTab));
  setBinderTab(list[(at + delta + list.length) % list.length]);
}
