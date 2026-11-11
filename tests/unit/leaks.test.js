import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_W } from '../../src/config/constants.js';
import { firstOpenLeakWithin, hasOpenLeaks, nearestOpenLeak, openLeakSpots, restoreSealed, tickLeakNoise } from '../../src/sim/leaks.js';
import { on } from '../../src/util/events.js';

test('open leak queries use the stored count and open standing tiles', () => {
  const state = {
    openLeaks: 2,
    leaks: [
      { sx: 2, sy: 3, fixed: true },
      { sx: 4, sy: 5, fixed: false },
      { sx: 5, sy: 5, fixed: false }
    ]
  };
  assert.equal(hasOpenLeaks(state), true);
  assert.deepEqual(openLeakSpots(state), [5*MAP_W+4, 5*MAP_W+5]);
  assert.equal(firstOpenLeakWithin(state, 4.5, 5.5, 1.1), state.leaks[1]);
  assert.equal(firstOpenLeakWithin(state, 5.4, 5.5, 1), state.leaks[1]);
  assert.equal(firstOpenLeakWithin(state, 3.5, 5.5, 1), null);
  assert.deepEqual(nearestOpenLeak(state, 5.5, 5.5), { leak: state.leaks[2], distance: 0 });
  assert.deepEqual(nearestOpenLeak(state, 5, 5.5), { leak: state.leaks[1], distance: 0.5 });
  state.openLeaks = 0;
  assert.equal(hasOpenLeaks(state), false);
  state.leaks.forEach(L => { L.fixed = true; });
  assert.deepEqual(openLeakSpots(state), []);
  assert.equal(firstOpenLeakWithin(state, 4.5, 5.5, 1), null);
  assert.equal(nearestOpenLeak(state, 4.5, 5.5), null);
});

test('drip and leak bed distance use the nearest open standing spot', () => {
  const state = {
    leaks: [
      { x: 9, y: 5, sx: 10, sy: 5, fixed: false },
      { x: 13, y: 5, sx: 12, sy: 5, fixed: false },
      { x: 10, y: 5, sx: 11, sy: 5, fixed: true }
    ],
    openLeaks: 2,
    plumber: { x: 10.5, y: 5.5, dripT: 0 },
    lifeforms: [],
    floodCover: 0,
    noise: 0,
    noisePeak: 0,
    ambientNoise: 0
  };
  const sounds = [];
  const unsubscribe = on('sfx', (...args) => sounds.push(args));
  try {
    tickLeakNoise(state, 1/60);
    assert.equal(state.leakDist, 0);
    assert.equal(state.plumber.dripT, 0.28);
    assert.deepEqual(sounds, [['drip', 1]]);

    state.plumber.x = 11.5;
    state.plumber.dripT = 0;
    tickLeakNoise(state, 1/60);
    assert.equal(state.leakDist, 1);
    assert.equal(state.plumber.dripT, 0.28 + 1/14*1.5);
    assert.deepEqual(sounds[1], ['drip', 1 - 1/14]);

    state.plumber.x = 26.5;
    state.plumber.dripT = 0;
    tickLeakNoise(state, 1/60);
    assert.equal(state.leakDist, 99);
    assert.equal(state.plumber.dripT, 0);
    assert.equal(sounds.length, 2);

    state.openLeaks = 0;
    state.leaks.forEach(L => { L.fixed = true; });
    tickLeakNoise(state, 1/60);
    assert.equal(state.leakDist, 99);
    assert.equal(state.leakPower, 0);
    assert.equal(state.leakTotal, 0);
  } finally {
    unsubscribe();
  }
});

test('restoreSealed restores flags and count without seal events', () => {
  const state = {
    openLeaks: 99,
    leaks: [
      { fixed: false, fixedAt: 12, repair: 4 },
      { fixed: false, fixedAt: 5, repair: 2 },
      { fixed: false, fixedAt: 7, repair: 3 }
    ]
  };
  const events = [];
  const unsubscribe = ['sfx', 'flash', 'stat', 'waterChanged'].map(type =>
    on(type, (...args) => events.push([type, ...args])));
  try {
    restoreSealed(state, [true, false, true]);
    assert.deepEqual(state.leaks, [
      { fixed: true, fixedAt: 0, repair: 0 },
      { fixed: false, fixedAt: 5, repair: 2 },
      { fixed: true, fixedAt: 0, repair: 0 }
    ]);
    assert.equal(state.openLeaks, 1);
    assert.deepEqual(events, []);
    restoreSealed(state, [false, true]);
    assert.equal(state.openLeaks, 0);
    assert.deepEqual(events, []);
  } finally {
    unsubscribe.forEach(off => off());
  }
});
