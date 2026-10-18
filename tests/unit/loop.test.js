/* The frame loop's error boundary.

   frame() used to request its own successor on its LAST line, so a throw
   anywhere in the frame — the step, the render, the shell's afterUpdate — killed
   the loop and the player got a frozen floor and a clock still burning, with
   nothing on screen to say what happened. Three things are asserted here, and
   they are the three halves of the fix: the successor is armed BEFORE the work,
   three consecutive failures stop the loop and raise the card, and the card is
   the same one the shell's window handlers raise. */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';

/* boot() wires the real fatal hook, so this asserts the shipped boundary rather
   than a hook the test installed itself. */
const { A } = await loadGame();
const { setFrameHooks } = await import('../../src/game/loop.js');

test('[40] the loop survives a throwing frame and gives up loudly', () => {
  let armed = 0;
  global.requestAnimationFrame = ()=>{ armed++; return 0; };
  /* In PLAY, or the hook below is never called: the loop no longer draws on the
     riser or the cards (see loop-redraw.test.js), and a boundary asserted
     against a frame the loop has decided not to paint would be asserting about
     nothing. */
  A.STATE = 'play';
  setFrameHooks({ render(){ throw new Error('render blew up'); } });

  const fatal = document.getElementById('fatal');
  assert.ok(fatal.classList.contains('hidden'), 'the fatal card starts up — it must be hidden until something breaks');

  /* One throwing frame still schedules the next one. This is the assertion the
     old loop could not pass: it armed at the end, so the count stayed at 0. */
  A.frame(1000);
  assert.ok(armed >= 1, `a throwing frame armed ${armed} successor frames — the loop dies with the first exception`);

  A.frame(1000 + 1000/60);
  assert.ok(fatal.classList.contains('hidden'), 'the fatal card came up after two failures — one bad frame is not fatal');

  /* ...and the third is. */
  A.frame(1000 + 2*(1000/60));
  assert.equal(fatal.classList.contains('hidden'), false, 'three consecutive failing frames and nothing was shown to the player');

  /* And having given up, it stays given up: no fourth frame is requested, so
     the loop cannot keep throwing into the console forever. */
  const after = armed;
  A.frame(1000 + 3*(1000/60));
  assert.equal(armed, after, 'the loop armed another frame after it had already given up');

  console.log('[40] the loop survives a throwing frame and gives up loudly');
  console.log(`  ${armed} successor frames armed, card up on the third failure, nothing armed after it`);
});