/* ============================================================
   THE BINDER
   One screen, two modes. Before a shift it is the clock-in binder (WORK ORDER,
   FIELD MANUAL, SETTINGS). While paused it is the same binder with a RUN page
   in place of the work order. The manual and settings pages are the same
   markup in both modes, so they cannot drift apart.

   The mode only picks which tabs show and whether the screen offers BEGIN or
   RESUME. STATE ('binder' or 'pause') stays the single source of truth for
   whether the clock runs.
   ============================================================ */

import { disarmReset } from '../game/run.js';
import { manualSeen } from '../settings/manual-seen.js';

export const SHIFT_TABS = ['order', 'manual', 'settings'];
export const PAUSE_TABS = ['run', 'manual', 'settings'];

export let binderMode = 'shift';        // 'shift' | 'pause'
export let binderTab = 'order';

const tabsFor = mode => mode === 'pause' ? PAUSE_TABS : SHIFT_TABS;

/**
 * Opens the binder in a mode on a tab. The caller shows the screen.
 *
 * @param {'shift'|'pause'} mode
 * @param {string} [tab] first tab of the mode when omitted or not valid there
 */
export function openBinder(mode, tab){
  binderMode = mode;
  const screen = document.getElementById('screen-binder');
  if (screen) screen.dataset.binderMode = mode;
  for (const t of document.querySelectorAll('[data-binder-for]'))
    t.classList.toggle('hidden', t.dataset.binderFor !== mode);
  setBinderTab(tab);
  // The first shift ends the manual with a way on; later visits do not need it.
  const next = document.getElementById('manual-next');
  if (next) next.classList.toggle('hidden', !(mode === 'shift' && !manualSeen()));
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
    p.classList.toggle('hidden', p.dataset.binderPage !== binderTab);
  for (const t of document.querySelectorAll('[data-binder-tab]'))
    t.setAttribute('aria-selected', String(t.dataset.binderTab === binderTab));
}

/** Turns one tab left (-1) or right (+1), wrapping at the ends. @param {number} delta */
export function stepBinderTab(delta){
  const list = tabsFor(binderMode);
  const at = Math.max(0, list.indexOf(binderTab));
  setBinderTab(list[(at + delta + list.length) % list.length]);
}
