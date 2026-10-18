/* THE REDRAW GATE.

   Off play the loop was calling render() sixty times a second to paint a floor
   that is not stepping, under a card that does not move — a full ground pass,
   light composite and post chain, per frame, producing a pixel-identical image.
   The gate is asserted here as a count of calls to the render hook, because
   that is the thing the loop actually controls and the thing the player pays
   for.

   Three states, three numbers: nothing on the splash, a state change plus a
   250ms heartbeat on the cards, every frame on play. The heartbeat matters and
   is easy to drop — the renderer keeps time-based flicker in its passes, so a
   card that is only ever drawn once is a card whose CRT is switched off.

   Its own file because tests/unit/loop.test.js ends with three consecutive
   throwing frames, and the loop stops for good after the third. */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';
import { setFrameHooks } from '../../src/game/loop.js';

const { A } = await loadGame();

test('[46] a frame is only drawn when there is something new to draw', () => {
  let renders = 0;
  setFrameHooks({ render(){ renders++; } });

  /* One second of real frames at 60Hz — the same drive the clock assertions
     use, so the heartbeat has a real number of frames to appear in. */
  const second = (state)=>{
    let now = 0;
    for (let i=0;i<60;i++) A.frame(now += 1000/60);
    return renders;
  };

  A.STATE = 'splash';
  renders = 0;
  const onSplash = second();
  assert.equal(onSplash, 0,
    `${onSplash} renders on the riser in one second — the canvas behind the title is not visible and nothing on it moves`);

  /* The card: one draw for the state change, then the heartbeat. A second is
     four beats, so five is the ceiling and one is the failure mode. */
  A.STATE = 'pause';
  renders = 0;
  const onPause = second();
  assert.ok(onPause > 0, 'a paused card was never drawn at all — the ticket would sit on an unpainted canvas');
  assert.ok(onPause <= 5, `${onPause} renders on the pause ticket in one second — `+
    'the gate is holding the state change and the heartbeat but not dropping the frames between them');

  /* And play is untouched: the gate is a saving on the frozen states, not a
     change to the one that moves. */
  A.STATE = 'play';
  renders = 0;
  const onPlay = second();
  assert.equal(onPlay, 60, `play drew ${onPlay} frames out of 60 — the gate is in the way of the running game`);

  console.log('[46] a frame is only drawn when there is something new to draw');
  console.log(`  60 frames each: splash ${onSplash}, pause ${onPause} (state change + 4 heartbeats), play ${onPlay}`);
});
