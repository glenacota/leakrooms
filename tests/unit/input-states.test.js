import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';

/* loadGame() installs the real keydown handler the test drives; it has to run
   before the test body, and static imports hoist above any other module code */
const { A } = await loadGame();

/* ============ ENTER on every modal screen ================================
   MODAL_ACTION is a table of six callbacks and only one of them is the modal
   the name suggests: the other five sit on the same key, in the same branch of
   the handler, and a callback whose name is never imported is a ReferenceError
   the moment a player presses the key — not a dead key, a thrown one. So each
   screen gets ENTER pressed for real, and the throw is caught and named rather
   than left to abort the run. The clear card also asserts it descended, since
   a no-throw check alone passes on a callback that does nothing. */
test('[UI] ENTER on every modal screen runs its action without throwing', () => {
  const t = softAssert();
  console.log('[UI] ENTER on every modal screen runs its action without throwing');
  const keydown = global.window._h.keydown;
  t.assert(typeof keydown==='function', 'no keydown handler was registered');

  const pressEnter = () => keydown({ key:'Enter', repeat:false, metaKey:false,
                                     ctrlKey:false, altKey:false, preventDefault(){} });
  /* a thrown action is the failure this file exists for, so it is recorded
     against the screen that caused it */
  const enterOn = (st) => {
    A.hideAll(); A.STATE = st; A.show(st);
    let err = null;
    try { pressEnter(); } catch (e){ err = e; }
    t.assert(!err, `ENTER on the ${st} screen threw: ${err && err.message}`);
    return !err;
  };

  for (const st of ['splash','order','pause','dead','win']) enterOn(st);

  /* the clear card needs a real descent behind it: nextFloor() is what raises
     the card, and dismissClear() is the action ENTER is wired to */
  A.buildFloor(0, 4242);
  A.floorIdx = 0;
  A.STATE = 'play';
  A.nextFloor();
  t.assert(A.STATE==='clear', `nextFloor() left STATE '${A.STATE}', want 'clear'`);
  let clearErr = null;
  try { pressEnter(); } catch (e){ clearErr = e; }
  t.assert(!clearErr, `ENTER on the clear screen threw: ${clearErr && clearErr.message}`);
  t.assert(A.STATE==='play',
    `ENTER on the clear card left STATE '${A.STATE}', want 'play'`);

  console.log('  splash, order, pause, dead, win, clear — all six ENTER actions run');
  t.done();
});
