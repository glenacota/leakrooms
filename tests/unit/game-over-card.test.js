import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { emit } from '../../src/util/events.js';
import { readCss, readHtml } from '../helpers/src-text.js';

const { A } = await loadGame();
const report = {
  sealed: 3, deaths: 2, noises: 9, floors: 2, time: 70, terms: 'NORMAL',
  runHistory: [
    { floor: 0, sealed: 2, total: 2, clockLeft: 50, died: false },
    { floor: 1, sealed: 1, total: 3, clockLeft: 0, died: true },
    { floor: 1, sealed: 0, total: 3, clockLeft: 0, died: true },
  ],
};

test('the last crew member lost shows the termination sheet and hides the tape', () => {
  A.STATE = 'dead';
  emit('dead', { lives: 0, cause: 'caught', report });
  const stats = document.getElementById('dead-stats').innerHTML;
  assert.equal(document.getElementById('dead-tape').hidden, true);
  assert.equal(document.getElementById('dead-over').hidden, false);
  assert.match(stats, /FAILED/);
  assert.match(stats, /<b>Terms:<\/b> NORMAL/);
  assert.match(stats, /<b>Shift time:<\/b> 1:10/);
  assert.match(stats, /Leaks sealed<\/th><td>3<\/td><td>100<\/td><td>300/);
  assert.match(stats, /<th scope="row" class="end-cost">Casualties Costs<\/th><td class="end-cost">2<\/td><td class="end-cost">150<\/td><td class="end-cost">−300/);
  assert.match(stats, /<th scope="row" class="end-cost">Incomplete Deliverable Fee<\/th><td class="end-cost">1<\/td><td class="end-cost">300<\/td><td class="end-cost">−300/);
  assert.match(readCss(), /\.end-invoice-details \.end-cost\s*\{\s*color:\s*var\(--danger\);\s*text-shadow:0\s0\sblack\s*\}/);
  assert.match(stats, /<th scope="row" colspan="3"><span>TOTAL<\/span><\/th><td class="end-invoice-total"><span>−300 ₵<\/span><\/td>/);
  assert.doesNotMatch(stats, /Floors walked back/);
  assert.doesNotMatch(stats, /Early-completion premium/);
  assert.match(stats, /CLIENT FEEDBACK/);
  assert.match(stats, /HR NOTE/);
  assert.equal(document.getElementById('btn-retry').textContent, 'TRY AGAIN');
});

test('a death with crew left keeps the tape card and no termination sheet', () => {
  emit('dead', { lives: 2, cause: 'caught', report });
  assert.equal(document.getElementById('dead-tape').hidden, false);
  assert.equal(document.getElementById('dead-over').hidden, true);
  assert.equal(document.getElementById('btn-retry').textContent, 'SEND NEXT CREW MEMBER');
});

test('termination sheet copy avoids the words the player must not see', () => {
  emit('dead', { lives: 0, cause: 'caught', report });
  const text = document.getElementById('dead-stats').innerHTML.replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(text, /\b(levels?|difficulty|fix(?:es|ing)?|lives?)\b/i);
});

test('the termination sheet sits inside the death screen and the sheet is hidden by its attribute', () => {
  const html = readHtml();
  const dead = html.slice(html.indexOf('id="screen-dead"'), html.indexOf('id="screen-win"'));
  assert.ok(dead.includes('id="dead-over"'));
  assert.match(dead, /class="order end-paper"/);
  assert.match(dead, /OR PRESS <b>ESC<\/b> TO EXIT TO MENU/);
  assert.equal((dead.match(/<button\b/g) || []).length, 1);
  assert.match(readCss(), /\.order\.end-paper\[hidden\][^{]*\{\s*display:\s*none/);
});
