/* ============================================================
   THE PAUSE SCREEN
   Pausing opens the binder in pause mode: a RUN page with the live numbers of
   the shift, then the same FIELD MANUAL and SETTINGS pages as before the
   shift. A pause lands on RUN.

   Settings take effect immediately. There is no apply button, because the
   values are cheap and reversible and a delayed apply makes people wonder
   whether the change was saved.

   STATE stays 'pause' the whole time. Only the binder tab changes, so the
   clock stays frozen and there is no second state machine to keep in step.
   ============================================================ */

import { FLOORS } from '../config/tuning.js';
import { currentTerms } from '../settings/store.js';
import { G } from '../sim/state.js';
import { clockText, disarmReset, STATE, transition, runHistory } from '../game/run.js';
import { livesHTML } from './hud.js';
import { openBinder } from './binder.js';

// ESC or ENTER: pauses a running game, or resumes a paused one.
export function togglePause(){
  if (STATE==='play'){
    /* transition() handles everything a state change needs: the screen, the
       HUD, held keys, and (through the 'state' event) the audio beds and the
       audio context. */
    transition('pause');
    openBinder('pause', 'run');
    /* The run's numbers on the RUN page, so pausing does not cost the player
       their bearings. Every id below is in index.html. */
    const set = (id, html)=>{ const el = document.getElementById(id); if (el) el.innerHTML = html; };
    const sealed = G.totalLeaks - G.openLeaks;

    set('pause-floor',  `${G.floor+1}/${FLOORS}`);
    set('pause-clock',   clockText(G.clock));
    set('pause-leaks',  `${sealed}/${G.totalLeaks}`);
    set('pause-lives', livesHTML());
    // The terms are shown as a fact. They cannot be changed from here.
    set('pause-terms',  currentTerms().label);
    /* The timeline: how each floor of this run went, plus the floor in
       progress. runHistory is run-wide and cleared when a new run starts. */
    const timeline = document.getElementById('pause-timeline');
    if (timeline) timeline.innerHTML = renderTimeline();
  }
  else if (STATE==='pause'){ disarmReset(); transition('play'); }
}

/* Builds the timeline rows: every finished floor attempt from runHistory,
   then the floor currently in progress. Each row shows floor, result,
   leaks sealed this floor, and clock left. */
function renderTimeline(){
  const row = (floor, ok, sealed, total, clockLeft, now)=>{
    const label = now ? 'now' : (ok ? 'sealed' : 'died');
    const cls = now ? 'now' : (ok ? 'ok' : 'bad');
    return `
<div class="run-timeline-row${now?' now':''}">
  <span class="run-timeline-floor">${floor}</span>
  <span class="run-timeline-status ${cls}">${label}</span>
  <span class="run-timeline-leaks">${sealed}/${total}</span>
  <span class="run-timeline-clock">${clockText(clockLeft)} left</span>
</div>`;
  };

  const rows = [];
  for (const e of runHistory){
    rows.push(row(e.floor+1, !e.died, e.sealed, e.total, e.clockLeft, false));
  }
  /* The floor in progress is not in runHistory yet, so show it from G. */
  if (G){
    const sealed = G.totalLeaks - G.openLeaks;
    rows.push(row(G.floor+1, null, sealed, G.totalLeaks, G.clock, true));
  }
  return rows.join('');
}
