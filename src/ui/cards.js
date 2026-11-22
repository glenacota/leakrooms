import { FLOOR_CLOCK } from '../config/tuning.js';
import { clearCard, clockText, DEATH_CAUSE, STATE } from '../game/run.js';
import { emit, on, EVENT } from '../util/events.js';

// Fictional invoice rates: placeholders for the contractor's paperwork, not game currency.
const LEAK_RATE = 100, FLOOR_RATE = 40, DEATH_COST = 75;

/* The win sheet and the termination sheet share their parts: the stamp, the order heading, 
   the run table and the invoice. Only the copy and the invoice lines differ between them. */
function stamp(text){ return `<div class="end-stamp">${text}</div>`; }

function elapsed(time){
  return `${Math.floor(time/60)}:${String(Math.floor(time%60)).padStart(2,'0')}`;
}

function orderHeading(terms){
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return `<div class="end-order-heading"><div>
        <h1>WORK ORDER 88D</h1>
        <p>DATE: <b>${date}</b></p>
        <p>TERMS: <b>${terms}</b></p>
      </div></div>`;
}

/* One row per floor reached. A floor the crew did not finish shows its last attempt. */
function runRows(runHistory, floors){
  const rows = [];
  for (let floor = 0; floor < floors; floor++){
    const attempts = runHistory.filter(entry => entry.floor === floor);
    const shown = attempts.find(entry => !entry.died) ?? attempts[attempts.length - 1];
    const lost = attempts.filter(entry => entry.died).length;
    rows.push(`<tr><th scope="row">${floor+1}</th><td>${shown.sealed}/${shown.total}</td><td>${lost}</td><td>${clockText(shown.clockLeft)}</td></tr>`);
  }
  return rows.join('');
}

function runSection(time, rows){
  return `<section class="end-section">
      <h3>RUN REPORT</h3>
      <p>Overall Time: <b>${elapsed(time)}</b></p>
      <table class="end-table">
        <thead><tr><th scope="col">FLOOR</th><th scope="col">REPAIR</th><th scope="col">FATALITIES</th><th scope="col">AIR LEFT</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function invoiceSection(lines, total){
  const rows = lines.map(([label, value]) => `<tr><th scope="row">${label}</th><td>${value}</td></tr>`).join('');
  return `<section class="end-section">
      <h3>INVOICE <span class="end-unit">CREDITS</span></h3>
      <table class="end-invoice">
        <tbody>${rows}<tr class="end-total"><th scope="row">TOTAL</th><td>${total}</td></tr></tbody>
      </table>
    </section>`;
}

function winReport({ sealed, deaths, floors, time, terms, runHistory }){
  const leakPay = sealed * LEAK_RATE;
  const floorPay = floors * FLOOR_RATE;
  const lostPay = deaths * DEATH_COST;
  return `
    <section class="end-section end-order">
      ${stamp('COMPLETED')}
      ${orderHeading(terms)}
      <p class="end-signoff">CLIENT FEEDBACK: <b>"We appreciate the orderly handling of the assignment"</b>.</p>
    </section>
    ${runSection(time, runRows(runHistory, floors))}
    ${invoiceSection([
      [`Leaks sealed (${sealed} × ${LEAK_RATE})`, leakPay],
      [`Floors walked back (${floors} × ${FLOOR_RATE})`, floorPay],
      [`Equipment lost (${deaths} × ${DEATH_COST})`, `−${lostPay}`],
    ], leakPay + floorPay - lostPay)}`;
}

/* Shown when the last crew member is lost. Floors are paid only when walked back,
   so the invoice has no floor line. */
function overReport({ sealed, deaths, floors, time, terms, runHistory }){
  const leakPay = sealed * LEAK_RATE;
  const lostPay = deaths * DEATH_COST;
  return `
    <section class="end-section end-order">
      ${stamp('FAILED')}
      ${orderHeading(terms)}
      <p class="end-signoff">CLIENT FEEDBACK: <b>"Stop charging us for people who aren't coming back."</b></p>
    </section>
    ${runSection(time, runRows(runHistory, floors))}
    ${invoiceSection([
      [`Leaks sealed (${sealed} × ${LEAK_RATE})`, leakPay],
      [`Equipment lost (${deaths} × ${DEATH_COST})`, `−${lostPay}`],
    ], leakPay - lostPay)}
    <section class="end-section">
      <h3>SEVERANCE: NONE</h3>
      <p>We regret the loss of our valued personnel. Their contributions will be remembered. Employees are reminded that basic safety protocols exist for a reason.</p>
    </section>`;
}

/** Binds the text shown on the dead, win, and floor-clear cards. */
export function bindCards(){
  const winStats = document.getElementById('end-stats');
  winStats.addEventListener('animationend', event => {
    if (event.animationName === 'end-stamp' && STATE === 'win') emit(EVENT.sfx, 'stamp');
  });
  on(EVENT.dead, ({ lives, cause, report }) => {
    const title = document.getElementById('dead-title');
    const sub = document.getElementById('dead-sub');
    const subMsg = document.getElementById('dead-sub-message');
    const btn = document.getElementById('btn-retry');
    const tape = document.getElementById('dead-tape');
    const over = document.getElementById('dead-over');
    document.getElementById('dead-wrap').scrollTop = 0;
    if (lives > 0){
      tape.hidden = false;
      over.hidden = true;
      if (cause === DEATH_CAUSE.CAUGHT) title.textContent = 'FATAL ATTACK';
      else if (cause === DEATH_CAUSE.CLOCK) title.textContent = "RESPIRATORY FAILURE";
      btn.textContent = 'SEND NEXT CREW MEMBER';
      sub.textContent = `CREW COUNT: ${lives}`;
      subMsg.textContent = `We mourn the loss of a valued employee.\nThe position will be filled at the earliest feasible date.`;
    } else {
      tape.hidden = true;
      over.hidden = false;
      if (report) document.getElementById('dead-stats').innerHTML = overReport(report);
      btn.textContent = 'START OVER';
    }
  });
  on(EVENT.win, report => {
    document.getElementById('win-wrap').scrollTop = 0;
    winStats.innerHTML = winReport(report);
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      emit(EVENT.sfx, 'stamp');
  });
  on(EVENT.clearShow, () => {
    const el = id => document.getElementById(id);
    el('clear-clock').textContent = clockText(clearCard.clock);
    el('clear-floor').textContent = clearCard.floor+1;
    el('clear-leaks').textContent = clearCard.leaks;
    el('clear-forms').textContent = clearCard.lifeforms;
    el('clear-sub').textContent = clearCard.clock >= FLOOR_CLOCK*0.34
      ? 'GOOD WORK. MANAGEMENT NOTICES.'
      : 'SEALED. MANAGEMENT HAS NO COMMENT.';
  });
  on(EVENT.reset, armed => {
    const b = document.getElementById('btn-reset-run');
    if (b) b.textContent = armed ? 'TAP AGAIN — LOSES THE SHIFT' : 'RESTART SHIFT';
  });
}
