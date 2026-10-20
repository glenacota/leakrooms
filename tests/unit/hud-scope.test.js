import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';

const { A, G, calls } = await loadGame();
const buildFloor = A.buildFloor;
const update = A.update;

/* ============ TEST: the HUD scope

   The scope is the panel's noise instrument, and it replaced a bar that
   carried three things at once: the noise you were making, the standing
   hiss of the open pipes, and a tick at the last loud moment. A scope
   carries the same three, but the invariants that make it honest are
   arithmetic, not pixels:

     - the scale is the game's, not the drawing's
     - the trace's peak reaches the LOUD line exactly at the threshold
     - past LOUD the trace is the alarm colour, not a warmer shade
*/

const scope = await import('../../src/render/hud-scope.js');
const { scopeState, selfColor, traceHeight, LOUD_BAND, paintScope } = scope;
const { LOUD, NOISE_FS } = await import('../../src/config/constants.js');

test('the scope reads the floor state, not its own idea of it', () => {
  buildFloor(0, 1234);
  update(1/60);

  G.selfNoise = 0;
  G.leakTotal = 0;
  G.noisePeak = 0;
  let st = scopeState();
  assert.equal(st.self, 0, 'a silent player draws a silent trace');
  assert.equal(st.pipes, 0, 'no open pipes, no hiss');
  assert.equal(st.loud, false, 'silence is not loud');

  G.selfNoise = NOISE_FS;          // the wrench: the loudest thing there is
  G.leakTotal = NOISE_FS * 0.5;
  G.noisePeak = NOISE_FS;
  st = scopeState();
  assert.equal(st.self, 1, 'full-scale noise is not drawn as full scale');
  assert.equal(st.pipes, 0.5, 'the pipes are on their own scale');
  assert.equal(st.peak, 1, 'the peak hold is on the same scale');
  assert.equal(st.loud, true, 'the wrench is above LOUD');

  /* Out of range is clamped, not wrapped: a wave drawn past the dial
     would be a wave drawn through the bezel. */
  G.selfNoise = NOISE_FS * 4;
  assert.equal(scopeState().self, 1, 'the trace is not clamped to the dial');
  G.selfNoise = -1;
  assert.equal(scopeState().self, 0, 'a negative level is not a level');
});

test('the trace reaches the LOUD line exactly at the threshold', () => {
  /* The band is where the dashed lines sit, and the trace's height is
     where its peak lands. If those two came from different numbers the
     instrument would lie: a wave could touch the line while it was still
     quiet, which is the one reading that must never be wrong. */
  assert.ok(LOUD_BAND > 0, 'the LOUD band is flat');
  assert.equal(traceHeight(LOUD/NOISE_FS), LOUD_BAND,
    'the trace does not meet the LOUD line at the threshold');
  assert.equal(traceHeight(0), 0, 'silence has no height');
  assert.ok(traceHeight(1) > traceHeight(LOUD/NOISE_FS),
    'full scale is not above the threshold');
  /* And it is a straight line: a louder wave is a taller wave. */
  assert.equal(traceHeight(0.5), traceHeight(1)/2, 'the axis is not linear');
});

test('past LOUD the trace is the alarm colour, and below it it is a shade', () => {
  assert.equal(selfColor(LOUD), '#ff4a30', 'the threshold is not the alarm colour');
  assert.equal(selfColor(LOUD + 0.2), '#ff4a30', 'above the threshold it cools down again');
  /* Below the threshold the colour walks from pale to red, so the trace
     is already telling you it is getting worse before it is too late. */
  const quiet = selfColor(0);
  const mid   = selfColor(LOUD/2);
  const loud  = selfColor(LOUD*0.95);
  assert.notEqual(quiet, mid, 'the colour never changes');
  assert.notEqual(mid, loud, 'the colour never changes');
  assert.ok(/^rgb\(/.test(quiet), 'a mixed colour is not a colour');
  /* Red means red: the channel that carries the alarm has to be the one
     that grows. */
  const rgbOf = s => s.replace(/^rgb\(|\)$/g,'').split(',').map(Number);
  const q = rgbOf(quiet), m = rgbOf(mid), l = rgbOf(loud);
  assert.ok(m[0] < q[0] && l[0] < m[0], 'the red channel never grows — the trace never gets warmer');
});

test('the scope paints without a floor and without throwing', () => {
  /* A frame can arrive before the first floor is built, and the panel is
     on screen from the moment a run starts. */
  assert.doesNotThrow(() => paintScope(0), 'the scope throws with no floor');
  buildFloor(0, 1234);
  G.selfNoise = LOUD;
  G.leakTotal = NOISE_FS * 0.4;
  G.noisePeak = NOISE_FS * 0.8;
  const before = calls.list.length;
  assert.doesNotThrow(() => paintScope(1600), 'the scope throws with a floor');
  assert.ok(calls.list.length > before, 'the scope drew nothing at all');
});
