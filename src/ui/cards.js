import { FLOOR_CLOCK } from '../config/tuning.js';
import { clearCard, clockText, DEATH_CAUSE, STATE } from '../game/run.js';
import { emit, on } from '../util/events.js';

// Fictional invoice rates: placeholders for the contractor's paperwork, not game currency.
const LEAK_RATE = 100, FLOOR_RATE = 40, DEATH_COST = 75;

function winReport({ sealed, deaths, noises, floors, time, terms, runHistory }){
  const rows = [];
  for (let floor = 0; floor < floors; floor++){
    const attempts = runHistory.filter(entry => entry.floor === floor);
    const completed = attempts.find(entry => !entry.died);
    const lost = attempts.filter(entry => entry.died).length;
    rows.push(`<tr><th scope="row">${floor+1}</th><td>${completed.sealed}/${completed.total}</td><td>${lost}</td><td>${clockText(completed.clockLeft)}</td></tr>`);
  }
  const leakPay = sealed * LEAK_RATE;
  const floorPay = floors * FLOOR_RATE;
  const lostPay = deaths * DEATH_COST;
  const elapsed = `${Math.floor(time/60)}:${String(Math.floor(time%60)).padStart(2,'0')}`;
  return `
    <section class="win-section win-order">
      <div class="win-order-heading"><div>
        <span class="win-stamp">COMPLETED</span>
        <h1>WORK ORDER 88D</h1>
        <p>CLIENT: <b>ASYNC</b><br>LOCATION: <b>BACKROOMS, SECTOR D / FLOORS 1–5</b></p>
        <p>TERMS: <b>${terms}</b></p>
      </div></div>
      <p class="win-signoff">CLIENT FEEDBACK: <b>"We appreciate your cooperation and the orderly handling of the assignment"</b>.</p>
    </section>
    <section class="win-section">
      <h2>RUN REPORT</h2>
      <p class="win-summary">You sealed <b>${sealed}</b> leaks and got back through the door on all <b>${floors}</b> floors.<br>
      Fatalities on duty: <b>${deaths}</b><br>
      Time: <b>${elapsed}</b></p>
      <table class="win-table">
        <thead><tr><th scope="col">FLOOR</th><th scope="col">SEALED</th><th scope="col">DEATHS</th><th scope="col">CLOCK LEFT</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </section>
    <section class="win-section">
      <h2>INVOICE <span class="win-unit">CREDITS</span></h2>
      <table class="win-invoice">
        <tbody>
          <tr><th scope="row">Leaks sealed (${sealed} × ${LEAK_RATE})</th><td>${leakPay}</td></tr>
          <tr><th scope="row">Floors walked back (${floors} × ${FLOOR_RATE})</th><td>${floorPay}</td></tr>
          <tr><th scope="row">Equipment lost (${deaths} × ${DEATH_COST})</th><td>−${lostPay}</td></tr>
          <tr class="win-total"><th scope="row">TOTAL</th><td>${leakPay + floorPay - lostPay}</td></tr>
        </tbody>
      </table>
      <p class="win-denied">RAISE REQUEST: DENIED</p>
    </section>`;
}

/** Binds the text shown on the dead, win, and floor-clear cards. */
export function bindCards(){
  const winStats = document.getElementById('win-stats');
  winStats.addEventListener('animationend', event => {
    if (event.animationName === 'win-stamp' && STATE === 'win') emit('sfx', 'stamp');
  });
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
  on('win', report => {
    document.getElementById('win-wrap').scrollTop = 0;
    winStats.innerHTML = winReport(report);
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      emit('sfx', 'stamp');
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
    if (b) b.textContent = armed ? 'TAP AGAIN — LOSES THE SHIFT' : 'RESTART SHIFT';
  });
}
