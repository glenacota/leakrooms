/* ============================================================
   THE PAUSE SCREEN
   The pause screen is the work order ticket with the run's live numbers
   written on it. It has two pages:
     settings  volume and water look (where a pause always lands)
     briefing  a reprint of the work order text

   Settings take effect immediately. There is no apply button, because the
   values are cheap and reversible and a delayed apply makes people wonder
   whether the change was saved.

   STATE stays 'pause' the whole time. Only pausePage changes between pages,
   so the clock stays frozen and there is no second state machine to keep in
   step.
   ============================================================ */

import { FLOORS } from '../config/tuning.js';
import { currentTerms } from '../settings/store.js';
import { G } from '../sim/state.js';
import { clockText, disarmReset, STATE, transition } from '../game/run.js';
import { livesHTML } from './hud.js';

export let pausePage = 'settings';      // 'settings' | 'briefing'

/**
 * Switches the visible page and updates the tabs. Also disarms RESET GAME,
 * so an armed reset does not survive the player moving to another page.
 *
 * @param {'settings'|'briefing'} page
 */
export function setPausePage(page){
  pausePage = page;
  disarmReset();
  for (const b of document.querySelectorAll('[data-pause-page]'))
    b.classList.toggle('hidden', b.dataset.pausePage !== page);
  for (const t of document.querySelectorAll('[data-pause-tab]'))
    t.setAttribute('aria-selected', String(t.dataset.pauseTab === page));
}

// ESC or ENTER: pauses a running game, or resumes a paused one.
export function togglePause(){
  if (STATE==='play'){
    /* transition() handles everything a state change needs: the screen, the
       HUD, held keys, and (through the 'state' event) the audio beds and the
       audio context. */
    transition('pause');
    setPausePage('settings');
    /* The run's numbers on the ticket, so pausing does not cost the player
       their bearings. Every id below is in index.html — see test [45]. */
    const set = (id, html)=>{ const el = document.getElementById(id); if (el) el.innerHTML = html; };
    const sealed = G.pipes - G.leaksOpen;

    set('pause-level',   `${G.floor+1}/${FLOORS}`);
    set('pause-clock',   clockText(G.clock));
    set('pause-pipes',  `${sealed}/${G.pipes}`);
    set('pause-lives', livesHTML());
    // The difficulty is shown as a fact. It cannot be changed from here.
    set('pause-terms',  currentTerms().label);
  }
  else if (STATE==='pause'){ disarmReset(); transition('play'); }
}