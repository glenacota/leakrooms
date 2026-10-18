import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';

/* loadGame() installs the real keydown handler the test drives; it has to run
   before the test body, and static imports hoist above any other module code */
const { A, G } = await loadGame();

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

/* ---- the four ways input used to be wrong -------------------------------
   A held key the browser forgot to release, a keyboard layout that does not
   put W where the player pressed it, and a shortcut the OS and the game both
   answering. None of them need a browser to see: they are all visible from the
   key state and the run state, so they are driven through the real handler. */
const KEY = { repeat:false, metaKey:false, ctrlKey:false, altKey:false, preventDefault(){} };
const pressCode = (key, code, extra={}) => global.window._h.keydown({ ...KEY, key, code, ...extra });

test('[UI] losing the window releases the keys and pauses the run', () => {
  const t = softAssert();
console.log('[UI] losing the window releases the keys and pauses the run');
{
  A.buildFloor(0, 4242);
  A.hideAll(); A.STATE = 'play';
  pressCode('w', 'KeyW');
  t.assert(!!A.keys['w'], 'W could not be held at all — this file cannot test anything else');

  const blur = global.window._h.blur;
  t.assert(typeof blur === 'function', 'no blur handler was registered');
  blur();
  t.assert(!A.keys['w'],
    'W is still held after the window lost focus — the player comes back sprinting into a wall with NOISE up');
  t.assert(A.STATE === 'pause',
    `blur during play left STATE '${A.STATE}', want 'pause' — a run nobody is watching keeps burning the clock`);

  /* ...and the pause itself is not a second event: a blur while already paused
     must not toggle anything back, which is what a blind toggle would do. */
  blur();
  t.assert(A.STATE === 'pause', `a second blur left STATE '${A.STATE}', want 'pause'`);
  console.log('  blur: keys released, run paused, and a second blur changes nothing');
}
  t.done();
});

test('[UI] the movement cluster follows the key, not the character', () => {
  const t = softAssert();
console.log('[UI] the movement cluster follows the key, not the character');
{
  A.hideAll(); A.STATE = 'play';

  /* A layout where the key labelled Z sits where QWERTY puts W: the character is
     z, the physical key is KeyW, and the game must move. */
  pressCode('z', 'KeyZ');
  t.assert(!A.keys['w'], 'pressing KeyZ moved the player north — the character was read instead of the key');

  pressCode('z', 'KeyW');
  t.assert(!!A.keys['w'],
    `KeyW with key 'z' left keys.w at ${A.keys['w']} — the movement cluster is still reading e.key, so it is ZQSD on a German keyboard`);

  /* An event with no character at all must not throw inside the handler. */
  let err = null;
  try { global.window._h.keydown({ code:'KeyW', ...KEY, key:undefined }); }
  catch (e){ err = e; }
  t.assert(!err, `a keydown with no key threw: ${err && err.message}`);
  console.log('  KeyZ does not move, KeyW does whatever the character says, no character is not a crash');
}
  t.done();
});

test('[UI] a shortcut the browser owns is not also a game key', () => {
  const t = softAssert();
console.log('[UI] a shortcut the browser owns is not also a game key');
{
  A.buildFloor(0, 4242);
  A.hideAll(); A.STATE = 'play';
  G.radar = false; G.batt = 100;

  pressCode('r', 'KeyR', { ctrlKey:true });
  t.assert(!G.radar, 'Ctrl+R turned the radar on — the reload shortcut also fires the game key');

  const muted = A.SETTINGS.muted;
  pressCode('m', 'KeyM', { metaKey:true });
  t.assert(A.SETTINGS.muted === muted, 'Cmd+M muted — that shortcut belongs to the OS');

  /* The control: the same key with no modifier still works. */
  pressCode('r', 'KeyR');
  t.assert(!!G.radar, 'R on its own does not toggle the radar — the guard is swallowing ordinary keys');
  console.log('  Ctrl+R and Cmd+M reach the browser only; plain R still fires the radar');
}
  t.done();
});
