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
  assert.match(html, /CLIENT FEEDBACK: <b>"We appreciate the orderly handling of the assignment\."<\/b>/);
  assert.match(html, /Time: <b>2:05<\/b>/);
  assert.match(html, /TERMS: <b>RELAXED<\/b>/);
  assert.equal((html.match(/<th scope="row">[1-5]<\/th>/g) || []).length, 5);
  assert.match(html, /<th scope="row">2<\/th><td>2\/2<\/td><td>1<\/td><td>1:31<\/td>/);
  assert.match(html, /Leaks sealed \(12 × 100\)<\/th><td>1200/);
  assert.match(html, /Floors secured \(5 × 50\)<\/th><td>250/);
  assert.match(html, /Early-completion premium<\/th><td>269/);
  assert.match(html, /Casualties \(insurance, equipment\) \(2 × 150\)<\/th><td>−300/);
  assert.doesNotMatch(html, /Continuity clause breach/);
  assert.match(html, /TOTAL<\/th><td>1419/);
  assert.doesNotMatch(html.replace(/<[^>]+>/g, ' '), /\b(levels?|difficulty|fix(?:es|ing)?)\b/i);
});

test('invoice preserves a negative total and handles zero deaths', () => {
  A.STATE = 'win';
  emit('win', { ...report, sealed: 0, deaths: 8 });
  assert.match(els['end-stats'].innerHTML, /TOTAL<\/th><td>-681/);
  emit('win', { ...report, deaths: 0 });
  assert.match(els['end-stats'].innerHTML, /Casualties \(insurance, equipment\) \(0 × 150\)<\/th><td>−0/);
  assert.match(els['end-stats'].innerHTML, /TOTAL<\/th><td>1719/);
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
