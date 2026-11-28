import test from 'node:test';
import { strict as assert } from 'node:assert';
import { DOOR, MAP, NOISE } from '../../src/config/constants.js';
import { tickDoor } from '../../src/sim/door.js';
import { on, EVENT } from '../../src/util/events.js';

test('starting the door sound emits a loud camera cue', () => {
  const cues = [];
  const off = on(EVENT.cameraShake, cue => cues.push(cue));
  const state = {
    plumber: { x:1.5, y:1.5 },
    openLeaks: 0,
    exitTiles: [{ x:1, y:1, open:0, facing:'S' }],
    descend: 0,
    noise: 0,
    noisePeak: 0,
    selfNoise: 0,
    ambientNoise: 0,
    lifeforms: [],
    grid: new Uint8Array(MAP.WIDTH_TILES * MAP.HEIGHT_TILES),
  };

  tickDoor(state, 1/60);
  off();
  assert.deepEqual(cues, ['loud']);
});

test('door completion emits camera cue before cycling', () => {
  const events = [];
  const offShake = on(EVENT.cameraShake, cue => events.push(['shake', cue]));
  const offCycle = on(EVENT.doorCycled, () => events.push(['cycle']));
  const state = {
    plumber: { x:1.5, y:1.5 },
    openLeaks: 0,
    exitTiles: [{ x:1, y:1, open:0, facing:'S' }],
    descend: DOOR.HOLD_SECONDS - 0.1,
    noise: 0,
    noisePeak: 0,
    selfNoise: NOISE.LOUD,
    ambientNoise: 0,
    lifeforms: [],
    grid: new Uint8Array(MAP.WIDTH_TILES * MAP.HEIGHT_TILES),
  };

  const continued = tickDoor(state, 0.1);
  offShake();
  offCycle();
  assert.equal(continued, false);
  assert.deepEqual(events, [['shake','door'],['cycle']]);
});
