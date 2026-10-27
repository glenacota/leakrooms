/* Refresh-aware adaptive resolution. The thresholds are fractions of an
   estimated refresh interval; until the estimate exists they fall back to the
   old 20 ms / 12 ms fixed behaviour, so a 60 Hz desktop is unchanged. The
   refresh estimate is computed once from the first 120 play frames, so each
   scenario resets the adaptive state first. While estimating, the drop/raise
   decision is suspended so a 30 fps capped display is not mistaken for slow. */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';
import { adaptResolution, resetAdaptiveForTests, getRefreshMs } from '../../src/render/adaptive.js';
import { setRenderScaleIdx } from '../../src/render/canvas.js';

const { A } = await loadGame();

/* Drive N frames, `ms` apart, and count drops and raises. The first 120
   frames are spent estimating the refresh interval, so no decision is made
   during them. */
function drive(ms, n){
  let now = performance.now();
  let drops = 0, raises = 0;
  for (let i = 0; i < n; i++){
    now += ms;
    const r = adaptResolution(now);
    if (r === 'drop') drops++;
    else if (r === 'raise') raises++;
  }
  return { drops, raises };
}

test('[ADAPTIVE] desktop path unchanged: same drop and raise points at 16.7 ms', () => {
  resetAdaptiveForTests();
  A.STATE = 'play';
  setRenderScaleIdx(0);

  /* 60 Hz frames: estimation completes at 16.7 ms, then neither the 20 ms
     drop point nor the 12 ms raise point is crossed, so nothing changes. */
  const steady = drive(16.7, 300);
  assert.equal(steady.drops, 0, `60 Hz dropped ${steady.drops} times`);
  assert.equal(steady.raises, 0, `60 Hz raised ${steady.raises} times`);
  assert.ok(Math.abs(getRefreshMs() - 16.7) < 0.1, `60 Hz estimates a 16.7 ms refresh`);

  /* A genuinely slow 21 ms average still drops, same as before. */
  resetAdaptiveForTests();
  setRenderScaleIdx(0);
  const slow = drive(21, 300);
  assert.ok(slow.drops > 0, '21 ms frames did not drop the resolution');

  /* From scale 1, an 11 ms average raises back, same as before. */
  resetAdaptiveForTests();
  setRenderScaleIdx(1);
  const fast = drive(11, 400);
  assert.ok(fast.raises > 0, '11 ms frames did not raise the resolution');
});

test('[ADAPTIVE] deltas clustered at 33.3 ms never drop (30 fps cap is not slow)', () => {
  resetAdaptiveForTests();
  A.STATE = 'play';
  setRenderScaleIdx(0);
  const capped = drive(33.3, 400);
  assert.equal(capped.drops, 0, `30 fps capped frames dropped ${capped.drops} times`);
  assert.equal(capped.raises, 0, `30 fps capped frames raised ${capped.raises} times`);
  assert.equal(getRefreshMs(), 33.3, 'a 30 fps cap is not estimated as 16.7 ms');
});

test('[ADAPTIVE] irregular 25 to 40 ms deltas (a slow device) do drop', () => {
  resetAdaptiveForTests();
  A.STATE = 'play';
  setRenderScaleIdx(0);
  const deltas = [25, 40, 30, 35, 28, 42, 33, 26, 38, 31];
  let now = performance.now();
  let drops = 0;
  for (let i = 0; i < 400; i++){
    now += deltas[i % deltas.length];
    if (adaptResolution(now) === 'drop') drops++;
  }
  assert.ok(drops > 0, 'irregular slow-device frames did not drop the resolution');
  assert.ok(Math.abs(getRefreshMs() - 16.7) < 0.1, `irregular frames estimate a 16.7 ms refresh`);
});

test('[ADAPTIVE] 120 Hz deltas are treated as 16.7, not capped at 30', () => {
  resetAdaptiveForTests();
  A.STATE = 'play';
  setRenderScaleIdx(0);
  const fast = drive(8.33, 400);
  assert.ok(Math.abs(getRefreshMs() - 16.7) < 0.1, `120 Hz is not estimated as a 16.7 ms refresh`);
  assert.equal(fast.drops, 0, '120 Hz frames must not drop the resolution');
});

test('[ADAPTIVE] before the estimate exists, no resolution decision is made', () => {
  resetAdaptiveForTests();
  A.STATE = 'play';
  setRenderScaleIdx(0);
  /* The first 120 frames during play are the estimation window: no refresh
     estimate yet, and no drop/raise decision. */
  let now = performance.now();
  for (let i = 0; i < 119; i++){
    now += 16.7;
    adaptResolution(now);
  }
  assert.equal(getRefreshMs(), null, 'the refresh estimate must not exist before 120 samples');
  /* ...and on the 120th frame the estimate lands. */
  now += 16.7;
  adaptResolution(now);
  assert.ok(getRefreshMs() !== null, 'the refresh estimate must exist after 120 samples');
});
