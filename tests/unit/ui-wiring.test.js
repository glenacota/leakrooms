/* Every control the shell ships is wired, and every wired handler runs clean.

   A handler that names something it never imported only throws when the line
   runs, so a wiring test that only checks `typeof handler === 'function'`
   misses it entirely. The DOM stub is backed by index.html, so this asserts on
   the wiring the game really builds rather than on what it can reach without
   a document. */
import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';
import { readHtml } from '../helpers/src-text.js';

const { A } = await loadGame();

/* The buttons the markup declares, read from the file rather than hard-coded,
   so adding a button to index.html without wiring it fails here rather than in
   front of a player. */
const SHIPPED = [...readHtml().matchAll(/<button[^>]*id="([^"]+)"/g)].map(m => m[1]);
const el = id => document.getElementById(id);

test('the shell ships no dead control', () => {
  const t = softAssert();

  t.assert(SHIPPED.length >= 9, `only ${SHIPPED.length} buttons found in the markup — the parse is wrong`);
  const unwired = SHIPPED.filter(id => typeof el(id).onclick !== 'function');
  t.assert(unwired.length === 0,
    `these buttons have no handler: ${unwired.join(', ')}`);

  /* The controls the panel builds rather than the markup carrying: the
     segmented rows and the sliders are constructed at boot out of the
     [data-opt] rows in the ticket, so "a button exists" is not the same claim
     as "the row was built". */
  for (const row of document.querySelectorAll('.seg[data-opt]')){
    t.assert(row.childNodes.length > 0,
      `segmented row ${row.id || row.dataset.opt} produced no buttons`);
    for (const b of row.querySelectorAll('button')){
      t.assert(typeof b.onclick === 'function',
        `a button in row ${row.id || row.dataset.opt} ("${b.textContent}") has no handler`);
    }
  }
  for (const input of document.querySelectorAll('input[type=range][data-opt]')){
    t.assert(input._has('input'), `slider ${input.id || input.dataset.opt} has no input listener`);
  }
  for (const tab of document.querySelectorAll('[data-pause-tab]')){
    t.assert(typeof tab.onclick === 'function', `pause tab ${tab.id} has no handler`);
  }

  /* And the one that matters most: calling every handler must not throw. An
     unimported name only raises when the line runs, so this is the assertion
     that would have caught all four of the step-32 misses. */
  const failures = [];
  for (const id of SHIPPED){
    const node = el(id);
    if (typeof node.onclick !== 'function') continue;
    try { node.click(); }
    catch (e){ failures.push(`${id}: ${e.message}`); }
  }
  t.assert(failures.length === 0, `a wired handler threw:\n    ${failures.join('\n    ')}`);

  console.log(`[35] the shell ships no dead control`);
  console.log(`  ${SHIPPED.length} shipped buttons, all wired, all invoked without throwing`);
  t.done();
});

test('[36] the controls change what they claim to change', () => {
  const t = softAssert();

  /* A slider writes through to the store, not to its own value attribute. */
  const master = document.querySelectorAll('input[type=range][data-opt]')
    .find(i => i.dataset.opt === 'master');
  master.value = '0.25';
  master._fire('input');
  t.assert(A.SETTINGS.master === 0.25,
    `the master slider set ${master.value} and the store reads ${A.SETTINGS.master}`);

  /* A segmented row sets its key and repaints the pressed state everywhere the
     key appears — the work order stamp and the ticket both read this one value. */
  const hueRow = document.querySelectorAll('.seg[data-opt]').find(r => r.dataset.opt === 'waterHue');
  const teal = hueRow.querySelectorAll('button').find(b => b.dataset.value === 'teal');
  teal.click();
  t.assert(A.SETTINGS.waterHue === 'teal', `clicking TEAL left waterHue at ${A.SETTINGS.waterHue}`);
  t.assert(teal.getAttribute('aria-pressed') === 'true', 'the clicked tint did not mark itself pressed');
  t.assert(el('note-difficulty').textContent.length > 0, 'the terms note is empty after a change');

  /* The binder is one screen with pages: the tab decides which is up. */
  A.STATE = 'binder'; A.openBinder('shift', 'order');
  const manual = el('tab-binder-manual');
  manual.click();
  const shown = document.querySelectorAll('[data-binder-page]').filter(p => !p.classList.contains('hidden'));
  t.assert(shown.length === 1 && shown[0].dataset.binderPage === 'manual',
    `after clicking FIELD MANUAL the visible pages are [${shown.map(p => p.dataset.binderPage).join(', ')}]`);
  t.assert(manual.getAttribute('aria-selected') === 'true', 'the manual tab did not select itself');

  /* The terms chooser is always open on the work order page: a term button writes the store. */
  const termsRow = document.querySelectorAll('.seg[data-opt]').find(r => r.dataset.opt === 'difficulty');
  termsRow.querySelectorAll('button').find(b => b.dataset.value === 'hard').click();
  t.assert(A.SETTINGS.difficulty === 'hard', `clicking HARD left difficulty at ${A.SETTINGS.difficulty}`);

  console.log(`[36] the controls change what they claim to change`);
  console.log('  slider -> store, tint -> note, tab -> page, terms -> store');
  t.done();
});

/* The title is a menu. A click on an entry opens the binder on that entry's
   page, and a click on the background does nothing. On the binder, only the
   BEGIN SHIFT button starts the run. This prevents a reflex double-tap from
   skipping the work order. */
test('[37] the title menu opens the binder, and only BEGIN SHIFT starts the run', () => {
  const t = softAssert();

  A.setManualSeen(true);
  A.hideAll(); A.STATE='splash'; A.show('splash');
  el('screen-splash')._fire('click', { target:{ closest: ()=>null } });
  t.assert(A.STATE==='splash', `clicking the title background left STATE at '${A.STATE}' — only the menu should leave the title`);

  el('menu-clock-in').click();
  t.assert(A.STATE==='binder' && A.binderTab==='order',
    `CLOCK IN left STATE '${A.STATE}' on tab '${A.binderTab}' — a returning player should land on the work order`);

  el('screen-binder')._fire('click', { target:{ closest: ()=>null } });
  t.assert(A.STATE==='binder', `clicking the binder background advanced to '${A.STATE}'`);

  el('btn-start').click();
  t.assert(A.STATE==='play', `clicking btn-start left STATE at '${A.STATE}'`);

  console.log('[37] the title menu opens the binder, and only BEGIN SHIFT starts the run');
  t.done();
});
