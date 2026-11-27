import { SCORE } from '../config/constants.js';
import { FLOOR_CLOCK } from '../config/tuning.js';
import { clearCard, clockText, DEATH_CAUSE, STATE } from '../game/run.js';
import { scoreRun } from '../game/score.js';
import { emit, on, EVENT } from '../util/events.js';

const el = id => document.getElementById(id);

function elapsed(time){
  return `${Math.floor(time/60)}:${String(Math.floor(time%60)).padStart(2,'0')}`;
}

function orderHeading(terms, copy, time){
  const now = new Date();
  const date = new Intl.DateTimeFormat(undefined, {
    day:'2-digit', month:'short', year:'numeric',
  }).format(now);
  return `<div class="end-order-heading">
        <div>
          <h3>LEAKROOMS Inc. - COMPLETION RECORD </h3>
          <h2>WORK ORDER 88D</h2>
        </div>
        <span class="end-stamp">${copy.stamp}</span>
      </div>
      <div class="end-metadata">
        <b>Delivery date:</b> <time datetime="${now.toISOString()}">${date}</time>
        &middot; <b>Terms:</b> ${terms} &middot; <b>Shift time:</b> ${elapsed(time)}
      </div>
      <div class="end-quotes">
        <p class="end-signoff"><b>CLIENT FEEDBACK:</b> “${copy.client}”</p>
        <p class="end-signoff"><b>HR NOTE:</b> “${copy.management}”</p>
      </div>`;
}

function invoiceSection(lines, total){
  const rows = lines.map(({description, qty, rate, amount, isCost}) => `
    <tr><th scope="row"${isCost ? ' class="end-cost"' : ''}>${description}</th><td${isCost ? ' class="end-cost"' : ''}>${qty}</td><td${isCost ? ' class="end-cost"' : ''}>${rate}</td><td${isCost ? ' class="end-cost"' : ''}>${formatCredits(amount)}</td></tr>
  `).join('');
  return `<section class="end-section end-invoice">
      <h3>CREDITS ₵</h3>
      <table class="end-invoice-details">
        <thead><tr><th scope="col">Description</th><th scope="col">Qty</th><th scope="col">Rate</th><th scope="col">Amount</th></tr></thead>
        <tbody>${rows}<tr class="end-total"><th scope="row" colspan="3"><span>TOTAL</span></th><td class="end-invoice-total"><span>${formatCredits(total)} ₵</span></td></tr></tbody>
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
    management: "Employees are reminded that safety protocols exist for a reason.",
  },
};

function endReport(report, won){
  const copy = won ? END_COPY.won : END_COPY.lost;
  
  const score = scoreRun(report, won);
  const lines = [{
    description: `Leaks sealed`,
    qty: report.sealed,
    rate: SCORE.LEAK_PAY,
    amount: score.leaks,
  }];
  if (won){
    lines.push({
      description: `Floors secured`,
      qty: report.floors,
      rate: SCORE.FLOOR_PAY,
      amount: score.floors,
    });
    lines.push({
      description: `Early-completion premium`,
      qty: 1,
      rate: score.premium,
      amount: score.premium,
    });
  }
  
  lines.push({
    description: `Casualties Costs`,
    qty: report.deaths,
    rate: SCORE.CASUALTY_COST,
    amount: -score.casualties,
    isCost: true,
  });
  if (!won) lines.push({
    description: `Incomplete Deliverable Fee`,
    qty: 1,
    rate: SCORE.BREACH_FEE,
    amount: -score.breach,
    isCost: true,
  });
   
  return `
    <section class="end-section end-order">
      ${orderHeading(report.terms, copy, report.time)}
    </section>
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

function formatCredits(amount){
  const formatted = new Intl.NumberFormat('en-US').format(Math.abs(amount));
  return amount < 0 || Object.is(amount, -0) ? `−${formatted}` : formatted;
}
