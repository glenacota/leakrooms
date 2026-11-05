import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';

/* The cue manager lives in src/ui/hud.js: flash(payload) / flashReset(),
   the CAT tier table, the single hold slot, the info wait-then-drop, and the
   danger-once-then-icon rule. It is pure apart from setTimeout holds, so the
   test boots the game (to install the DOM stubs and load the hud module),
   then replaces setTimeout/clearTimeout with a controllable registry and runs
   timers by hand instead of waiting for real milliseconds. */
const { els } = await loadGame();
const { flash, flashReset } = await import('../../src/ui/hud.js');

const flashText = () => els['flashnote'].textContent;
const flashCat  = () => els['flashnote'].dataset.cat;
const hasClass  = (c) => els['flashnote'].classList.contains(c);

/* ---- controllable timers ---------------------------------------------- */

const origSetTimeout = global.setTimeout;
const origClearTimeout = global.clearTimeout;
let timers = null;

function installTimers(){
  timers = new Map();
  let id = 0;
  global.setTimeout = (fn, ms) => { const i = ++id; timers.set(i, {fn, ms}); return i; };
  global.clearTimeout = (i) => timers.delete(i);
}
function uninstallTimers(){
  global.setTimeout = origSetTimeout;
  global.clearTimeout = origClearTimeout;
  timers = null;
}
function runTimer(i){
  const t = timers.get(i);
  if (!t) throw new Error(`no pending timer ${i}`);
  timers.delete(i);
  t.fn();
}
function pendingIds(){ return [...timers.keys()]; }

function withTimers(fn){
  installTimers();
  flashReset();                      // clean slate: dangerSaid, cur/held/waiting, and draw(null) clears the cue classes
  try { fn(); } finally { uninstallTimers(); }
}

test('cue-manager: danger interrupts info and the info is dropped, not re-shown', () => {
  const t = softAssert();
  withTimers(() => {
    flash({ cat: 'info', text: 'WAIT FOR ME' });
    t.assert(flashText().includes('WAIT FOR ME'), 'info shows first');

    flash({ cat: 'danger', text: 'IT SEES YOU' });
    t.assert(flashText().includes('IT SEES YOU'), 'danger interrupts info');
    t.assert(!flashText().includes('WAIT FOR ME'), 'info text is replaced');

    t.assert(pendingIds().length === 1, 'only the danger hold timer is pending');
    runTimer(pendingIds()[0]);              // danger hold 2800 ms → done()
    t.assert(flashText() === '', 'screen cleared after danger hold; info was not held');
  });
});

test('cue-manager: a holdable cue displaced by danger re-shows from the hold slot', () => {
  const t = softAssert();
  withTimers(() => {
    flash({ cat: 'alert', text: 'DOOR LOCKED' });
    t.assert(flashText().includes('DOOR LOCKED'), 'alert shows first');

    flash({ cat: 'danger', text: 'IT SEES YOU' });
    t.assert(flashText().includes('IT SEES YOU'), 'danger interrupts alert');

    runTimer(pendingIds()[0]);              // danger hold 2800 ms → done()
    t.assert(flashText().includes('DOOR LOCKED'), 'alert re-shown from the hold slot');

    runTimer(pendingIds()[0]);              // alert hold 3400 ms → done()
    t.assert(flashText() === '', 'screen cleared after the alert hold');
  });
});

test('cue-manager: the single hold slot keeps the higher-priority holdable cue', () => {
  const t = softAssert();
  withTimers(() => {
    flash({ cat: 'guide', text: 'FOLLOW THE WET FLOOR' }); // cur = guide (tier 3)
    flash({ cat: 'danger', text: 'DANGER' });               // guide displaced into the slot
    flash({ cat: 'alert', text: 'ALERT' });                 // alert outranks guide for the slot

    runTimer(pendingIds()[0]);                              // danger done → re-show alert
    t.assert(flashText().includes('ALERT'), 'alert re-shown from the hold slot');
    t.assert(!flashText().includes('FOLLOW THE WET FLOOR'), 'guide lost the slot to the higher alert');

    runTimer(pendingIds()[0]);                              // alert done → done()
    t.assert(flashText() === '', 'screen cleared');
  });
});

test('cue-manager: info waits up to 1.5 s then drops while a higher cue is showing', () => {
  const t = softAssert();
  withTimers(() => {
    flash({ cat: 'danger', text: 'DANGER' });   // hold 2800 ms
    flash({ cat: 'info', text: 'HINT' });       // waits 1500 ms behind danger

    t.assert(flashText().includes('DANGER'), 'danger still showing');
    t.assert(!flashText().includes('HINT'), 'info not shown yet');
    t.assert(pendingIds().length === 2, 'danger hold + info wait timers pending');

    runTimer(pendingIds()[1]);                  // info's 1500 ms wait expires first
    t.assert(flashText().includes('DANGER'), 'danger still showing; info dropped silently');

    runTimer(pendingIds()[0]);                  // danger hold → done(), nothing waiting
    t.assert(flashText() === '', 'screen cleared');
  });
});

test('cue-manager: info shows when a higher cue frees within its 1.5 s wait', () => {
  const t = softAssert();
  withTimers(() => {
    flash({ cat: 'alert', text: 'ALERT' });   // hold 3400 ms
    flash({ cat: 'info', text: 'HINT' });     // waits behind alert

    t.assert(flashText().includes('ALERT'), 'alert showing, info waiting');

    runTimer(pendingIds()[0]);                // alert done → done() starts the waiting info
    t.assert(flashText().includes('HINT'), 'info shown once the slot freed');
    t.assert(pendingIds().length === 1, 'only the info hold timer is pending');

    runTimer(pendingIds()[0]);                // info hold → done()
    t.assert(flashText() === '', 'screen cleared');
  });
});

test('cue-manager: danger speaks once per run, then icon-only on repeat', () => {
  const t = softAssert();
  withTimers(() => {
    flash({ cat: 'danger', text: 'IT SEES YOU' });
    t.assert(flashText().includes('IT SEES YOU'), 'first danger speaks its text');
    t.assert(!hasClass('icon'), 'first danger is not icon-only');

    runTimer(pendingIds()[0]);                // danger hold → done()
    flash({ cat: 'danger', text: 'IT SEES YOU' });
    t.assert(flashText().includes('IT SEES YOU'), 'repeat danger still carries the text');
    t.assert(hasClass('icon'), 'repeat danger shows icon-only');

    runTimer(pendingIds()[0]);                // icon-only hold → done()
    t.assert(!hasClass('icon'), 'icon class cleared when the cue clears');
  });
});

test('cue-manager: flashReset clears the danger-once memory', () => {
  const t = softAssert();
  withTimers(() => {
    flash({ cat: 'danger', text: 'DANGER' });
    runTimer(pendingIds()[0]);                // first danger done
    flash({ cat: 'danger', text: 'DANGER' });
    t.assert(hasClass('icon'), 'repeat danger is icon-only before reset');

    flashReset();
    flash({ cat: 'danger', text: 'DANGER' });
    t.assert(!hasClass('icon'), 'after reset, danger speaks again');

    runTimer(pendingIds()[0]);
    t.assert(flashText() === '', 'screen cleared after the reset danger');
  });
});

test('cue-manager: a string payload is treated as an info cue', () => {
  const t = softAssert();
  withTimers(() => {
    flash('PLAIN TEXT');
    t.assert(flashText().includes('PLAIN TEXT'), 'string payload shows');
    t.assert(flashCat() === 'info', 'string payload maps to the info category');

    runTimer(pendingIds()[0]);
    t.assert(flashText() === '', 'info hold expires');
  });
});

test('cue-manager: lore is holdable and re-shows after a higher cue', () => {
  const t = softAssert();
  withTimers(() => {
    flash({ cat: 'lore', text: 'THE NOTE SAYS KEEP MOVING' }); // hold 5200 ms
    flash({ cat: 'danger', text: 'IT SEES YOU' });              // lore displaced

    runTimer(pendingIds()[0]);                                  // danger done → lore
    t.assert(flashText().includes('THE NOTE SAYS KEEP MOVING'), 'lore re-shown after danger');
  });
});
