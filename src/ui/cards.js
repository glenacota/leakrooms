import { SCORE } from '../config/constants.js';
import { FLOOR_CLOCK } from '../config/tuning.js';
import { clearCard, clockText, DEATH_CAUSE, STATE } from '../game/run.js';
import { scoreRun } from '../game/score.js';
import { emit, on, EVENT } from '../util/events.js';

const el = id => document.getElementById(id);

// Unlike clockText, this rounds down: elapsed time should never read longer than it was.
function elapsed(time){
  return `${Math.floor(time/60)}:${String(Math.floor(time%60)).padStart(2,'0')}`;
}

function orderHeading(terms, copy){
  const now = new Date();
  const date = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return `<div class="end-order-heading"><div>
        <h2>SHIFT OVER: Completion Protocol</h2>
        <h1>WORK ORDER 88D</h1>
        <p>DELIVERY DATE: <b>${date}</b> &uarr; TERMS: <b>${terms}</b></p>
        <br/>
        <p class="end-signoff">CLIENT FEEDBACK: <b>"${copy.client}"</b></p>
        <p class="end-signoff">MANAGEMENT NOTE: <b>"${copy.management}"</b></p>
      </div></div>`;
}

/* One row per floor reached. A floor the crew did not finish shows its last attempt. */
function runRows(runHistory, floors){
  return Array.from({ length: floors }, (_, floor) => {
    const attempts = runHistory.filter(entry => entry.floor === floor);
    const shown = attempts.find(entry => !entry.died) ?? attempts[attempts.length - 1];
    const lost = attempts.filter(entry => entry.died).length;
    return `<tr><th scope="row">${floor+1}</th><td>${shown.sealed}/${shown.total}</td><td>${lost}</td><td>${clockText(shown.clockLeft)}</td></tr>`;
  }).join('');
}

function runSection(time, rows){
  return `<section class="end-section">
      <h3>REPORT</h3>
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

const END_COPY = {
  won: {
    stamp: 'COMPLETED',
    client: 'We appreciate the orderly handling of the assignment.',
    management: 'Salary raise rejected.',
  },
  lost: {
    stamp: 'FAILED',
    client: "Stop charging us for people who aren't coming back.",
    management: "Employees are reminded that basic safety protocols exist for a reason.",
  },
};

function endReport(report, won){
  const copy = won ? END_COPY.won : END_COPY.lost;
  
  const score = scoreRun(report, won);
  const lines = [[`Leaks sealed (${report.sealed} × ${SCORE.LEAK_PAY})`, score.leaks]];
  if (won){
    lines.push([`Floors secured (${report.floors} × ${SCORE.FLOOR_PAY})`, score.floors]);
    lines.push(['Early-completion premium', score.premium]);
  }
  
  lines.push([`Casualties \(insurance, equipment\) (${report.deaths} × ${SCORE.CASUALTY_COST})`, `−${score.casualties}`]);
  if (!won) lines.push(['Continuity clause breach (assignment incomplete)', `−${score.breach}`]);
   
  return `
    <section class="end-section end-order">
      <div class="end-stamp">${copy.stamp}</div>
      ${orderHeading(report.terms, copy)}
    </section>
    ${runSection(report.time, runRows(report.runHistory, report.floors))}
    ${invoiceSection(lines, score.total)}`;
}

/** Binds the text shown on the dead, win, and floor-clear cards. */
export function bindCards(){
  const winStats = el('end-stats');
  winStats.addEventListener('animationend', event => {
    if (event.animationName === 'end-stamp' && STATE === 'win') emit(EVENT.sfx, 'stamp');
  });
  on(EVENT.dead, ({ lives, cause, report }) => {
    const title = el('dead-title');
    const sub = el('dead-sub');
    const subMsg = el('dead-sub-message');
    const btn = el('btn-retry');
    const tape = el('dead-tape');
    const over = el('dead-over');
    el('dead-wrap').scrollTop = 0;
    if (lives > 0){
      tape.hidden = false;
      over.hidden = true;
      if (cause === DEATH_CAUSE.CAUGHT) title.textContent = 'FATAL ATTACK';
      else if (cause === DEATH_CAUSE.CLOCK) title.textContent = 'RESPIRATORY FAILURE';
      btn.textContent = 'SEND NEXT CREW MEMBER';
      sub.textContent = `CREW COUNT: ${lives}`;
      subMsg.textContent = 'We mourn the loss of a valued employee.\nThe position will be filled at the earliest feasible date.';
    } else {
      tape.hidden = true;
      over.hidden = false;
      if (report) el('dead-stats').innerHTML = endReport(report, false);
      btn.textContent = 'TRY AGAIN';
    }
  });
  on(EVENT.win, report => {
    el('win-wrap').scrollTop = 0;
    winStats.innerHTML = endReport(report, true);
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      emit(EVENT.sfx, 'stamp');
  });
  on(EVENT.clearShow, () => {
    el('clear-clock').textContent = clockText(clearCard.clock);
    el('clear-floor').textContent = clearCard.floor+1;
    el('clear-leaks').textContent = clearCard.leaks;
    el('clear-forms').textContent = clearCard.lifeforms;
    el('clear-sub').textContent = clearCard.clock >= FLOOR_CLOCK*0.34
      ? 'GOOD WORK. MANAGEMENT NOTICES.'
      : 'SEALED. MANAGEMENT HAS NO COMMENT.';
  });
  on(EVENT.reset, armed => {
    const b = el('btn-reset-run');
    if (b) b.textContent = armed ? 'TAP AGAIN — LOSES THE SHIFT' : 'RESTART SHIFT';
  });
}
