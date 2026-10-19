/* A throwing frame must not kill the loop: the player would get a frozen floor
   with a clock still burning and nothing on screen to say what happened. The
   next frame is armed before the work runs, three consecutive failures stop the
   loop, and the card that comes up is the one the shell's handlers raise. */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';

/* boot() wires the real fatal hook, so this asserts the shipped boundary rather
   than a hook the test installed itself. */
const { A } = await loadGame();
const { setFrameHooks } = await import('../../src/game/loop.js');

test('a throwing frame is caught, reported, and stops the loop', () => {
  let armed = 0;
  global.requestAnimationFrame = ()=>{ armed++; return 0; };
  /* In play, or the hook below is never called: the loop no longer draws on the
     riser or the cards, so a boundary asserted against a frame the loop has
     decided not to paint would be asserting about nothing. */
  A.STATE = 'play';
  setFrameHooks({ render(){ throw new Error('render blew up'); } });

  const fatal = document.getElementById('fatal');
  assert.ok(fatal.classList.contains('hidden'), 'the fatal card starts up — it must be hidden until something breaks');

  /* One throwing frame still schedules the next one. A loop that armed at the
     end of the frame would leave the count at zero. */
  A.frame(1000);
  assert.ok(armed >= 1, `a throwing frame armed ${armed} successor frames — the loop dies with the first exception`);

  A.frame(1000 + 1000/60);
  assert.ok(fatal.classList.contains('hidden'), 'the fatal card came up after two failures — one bad frame is not fatal');

  /* ...and the third is. */
  A.frame(1000 + 2*(1000/60));
  assert.equal(fatal.classList.contains('hidden'), false, 'three consecutive failing frames and nothing was shown to the player');

  /* Having given up, it stays given up: no fourth frame is requested, so the
     loop cannot keep throwing into the console forever. */
  const after = armed;
  A.frame(1000 + 3*(1000/60));
  assert.equal(armed, after, 'the loop armed another frame after it had already given up');

  console.log(`  ${armed} successor frames armed, card up on the third failure, nothing armed after it`);
});