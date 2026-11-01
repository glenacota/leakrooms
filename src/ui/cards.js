import { FLOOR_CLOCK } from '../config/tuning.js';
import { clearCard, clockText, DEATH_CAUSE } from '../game/run.js';
import { on } from '../util/events.js';

/** Binds the text shown on the dead, win, and floor-clear cards. */
export function bindCards(){
  on('dead', ({ lives, cause }) => {
    const title = document.getElementById('dead-title');
    const sub = document.getElementById('dead-sub');
    const btn = document.getElementById('btn-retry');
    if (lives > 0){
      if (cause === DEATH_CAUSE.CAUGHT) title.textContent = 'CAUGHT';
      else if (cause === DEATH_CAUSE.CLOCK) title.textContent = "TIME'S UP";
      btn.textContent = 'TRY AGAIN';
      sub.textContent = `${lives} LIVES LEFT • SEALED LEAKS STAY SEALED`;
    } else {
      title.textContent = 'SHIFT OVER';
      btn.textContent = 'START OVER';
      sub.textContent = 'OUT OF LIVES';
    }
  });
  on('win', ({ sealed, deaths, noises, floors, time }) => {
    document.getElementById('win-stats').innerHTML =
      `You sealed <b>${sealed}</b> leaks and got back through the door on all <b>${floors}</b> floors.<br>Deaths: <b>${deaths}</b> &nbsp; Noise made: <b>${noises}</b><br>Time: <b>${Math.floor(time/60)}:${String(Math.floor(time%60)).padStart(2,'0')}</b>`;
  });
  on('clear:show', () => {
    const el = id => document.getElementById(id);
    el('clear-clock').textContent = clockText(clearCard.clock);
    el('clear-floor').textContent = clearCard.floor+1;
    el('clear-leaks').textContent = clearCard.leaks;
    el('clear-forms').textContent = clearCard.lifeforms;
    el('clear-sub').textContent = clearCard.clock >= FLOOR_CLOCK*0.34
      ? 'GOOD WORK. MANAGEMENT NOTICES.'
      : 'SEALED. MANAGEMENT HAS NO COMMENT.';
  });
  on('reset', armed => {
    const b = document.getElementById('btn-reset-run');
    if (b) b.textContent = armed ? 'TAP AGAIN — LOSES THE RUN' : 'RESTART RUN';
  });
}
