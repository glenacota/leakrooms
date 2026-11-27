import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { emit, on } from '../../src/util/events.js';
import { readCss, readHtml } from '../helpers/src-text.js';

const { A, els } = await loadGame();
const report = {
  sealed: 12, deaths: 2, noises: 17, floors: 5, time: 125.9, terms: 'RELAXED', parTime: 1200,
  runHistory: [
    { floor: 0, sealed: 1, total: 1, clockLeft: 120, died: false },
    { floor: 1, sealed: 1, total: 2, clockLeft: 0, died: true },
    { floor: 1, sealed: 2, total: 2, clockLeft: 90.2, died: false },
    { floor: 2, sealed: 3, total: 3, clockLeft: 60, died: false },
    { floor: 3, sealed: 2, total: 3, clockLeft: 0, died: true },
    { floor: 3, sealed: 3, total: 3, clockLeft: 30, died: false },
    { floor: 4, sealed: 3, total: 3, clockLeft: 10, died: false },
  ],
};

test('win sheet reports totals, completed floors and itemized invoice', () => {
  A.STATE = 'win';
  emit('win', report);
  const html = els['end-stats'].innerHTML;
  assert.match(html, /WORK ORDER 88D/);
  assert.match(html, /COMPLETED/);
  assert.match(html, /CLIENT FEEDBACK/);
  assert.match(html, /<b>Shift time:<\/b> 2:05/);
  assert.match(html, /<b>Terms:<\/b> RELAXED/);
  assert.match(html, /Leaks sealed<\/th><td>12<\/td><td>100<\/td><td>1,200/);
  assert.match(html, /Floors secured<\/th><td>5<\/td><td>50<\/td><td>250/);
  assert.match(html, /Early-completion premium<\/th><td>1<\/td><td>269<\/td><td>269/);
  assert.match(html, /<th scope="row" class="end-cost">Casualties Costs<\/th><td class="end-cost">2<\/td><td class="end-cost">150<\/td><td class="end-cost">−300/);
  assert.doesNotMatch(html, /Incomplete Deliverable Fee/);
  assert.match(html, /<th scope="row" colspan="3"><span>TOTAL<\/span><\/th><td class="end-invoice-total"><span>1,419 ₵<\/span><\/td>/);
  assert.doesNotMatch(html.replace(/<[^>]+>/g, ' '), /\b(levels?|difficulty|fix(?:es|ing)?)\b/i);
});

test('invoice preserves a negative total and handles zero deaths', () => {
  A.STATE = 'win';
  emit('win', { ...report, sealed: 0, deaths: 8 });
  assert.match(els['end-stats'].innerHTML, /TOTAL<\/span><\/th><td class="end-invoice-total"><span>−681 ₵<\/span>/);
  emit('win', { ...report, deaths: 0 });
  assert.match(els['end-stats'].innerHTML, /<th scope="row" class="end-cost">Casualties Costs<\/th><td class="end-cost">0<\/td><td class="end-cost">150<\/td><td class="end-cost">−0/);
  assert.match(els['end-stats'].innerHTML, /TOTAL<\/span><\/th><td class="end-invoice-total"><span>1,719 ₵<\/span>/);
});

test('a new win returns the sheet to the top', () => {
  const winWrap = document.getElementById('win-wrap');
  winWrap.scrollTop = 500;
  A.STATE = 'win';
  emit('win', report);
  assert.equal(winWrap.scrollTop, 0);
});

test('stamp sounds at the landing, or immediately for reduced motion', () => {
  const sounds = [];
  const unsubscribe = on('sfx', name => { if (name === 'stamp') sounds.push(name); });
  A.STATE = 'win';
  emit('win', report);
  assert.equal(sounds.length, 0);
  els['end-stats']._fire('animationend', { animationName: 'other' });
  assert.equal(sounds.length, 0);
  els['end-stats']._fire('animationend', { animationName: 'end-stamp' });
  assert.equal(sounds.length, 1);
  A.STATE = 'splash';
  els['end-stats']._fire('animationend', { animationName: 'end-stamp' });
  assert.equal(sounds.length, 1);
  A.STATE = 'win';
  window.matchMedia = () => ({ matches: true });
  emit('win', report);
  assert.equal(sounds.length, 2);
  delete window.matchMedia;
  unsubscribe();
});

test('win sheet scrolls with the existing button and has a static reduced-motion stamp', () => {
  const html = readHtml();
  const win = html.slice(html.indexOf('id="screen-win"'), html.indexOf('id="screen-mobile"'));
  assert.ok(win.indexOf('id="end-stats"') < win.indexOf('id="btn-again"'));
  assert.equal((win.match(/<button\b/g) || []).length, 1);
  const css = readCss();
  assert.match(css, /\.order-wrap\s*\{[^}]*overflow-y:auto/s);
  assert.match(css, /\.order\.end-paper\s*\{\s*display:block/);
  assert.match(win, /class="order-wrap end-wrap"/);
  assert.match(win, /class="order end-paper"/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.end-stamp\s*\{\s*animation:none/s);
});