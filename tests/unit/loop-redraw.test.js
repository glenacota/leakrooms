/* The loop must not repaint sixty times a second to draw a floor that is not
   stepping, so the saving is measured as a count of render calls. Nothing on
   the splash, a state change plus a 250ms heartbeat on the cards, every frame
   on play. */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';
import { setFrameHooks } from '../../src/game/loop.js';

const { A } = await loadGame();

/* Its own file because tests/unit/loop.test.js ends with three consecutive
   throwing frames, and the loop stops for good after the third. */
test('a frame is only drawn when there is something new to draw', () => {
  let renders = 0;
  setFrameHooks({ render(){ renders++; } });

  /* One second of real frames at 60Hz, the same drive the clock assertions use,
     so the heartbeat has a real number of frames to appear in. */
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

  /* Play is untouched: the gate is a saving on the frozen states, not a change
     to the one that moves. */
  A.STATE = 'play';
  renders = 0;
  const onPlay = second();
  assert.equal(onPlay, 60, `play drew ${onPlay} frames out of 60 — the gate is in the way of the running game`);

  console.log(`  60 frames each: splash ${onSplash}, pause ${onPause} (state change + 4 heartbeats), play ${onPlay}`);
});
