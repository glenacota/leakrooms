import test from 'node:test';
import { strict as assert } from 'node:assert';
import { buildFloor, getStaticLevel } from '../../src/game/floor.js';
import { G } from '../../src/sim/state.js';
import { EVENT, on } from '../../src/util/events.js';

test('a floor can be built and retried without a DOM or renderer', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  buildFloor(0, 1234);
  const leaks = G.leaks;
  assert.ok(leaks.length > 0);
  leaks[0].fixed = true;
  buildFloor(0, 1234);
  assert.notEqual(G.leaks, leaks);
  assert.equal(G.leaks[0].fixed, false);
});

test('floor preparation precedes state installation and floorBuilt follows it', () => {
  buildFloor(0, 1235);
  const oldLeaks = G.leaks;
  const level = getStaticLevel(1236, 1);
  const calls = [];
  const offPreparing = on(EVENT.floorPreparing, (key, inputs) => {
    calls.push('preparing');
    assert.equal(key, '1236:1');
    assert.equal(inputs, level);
    assert.equal(G.leaks, oldLeaks);
  });
  const offBuilt = on(EVENT.floorBuilt, () => {
    calls.push('built');
    assert.notEqual(G.leaks, oldLeaks);
  });
  try {
    buildFloor(1, 1236);
    assert.deepEqual(calls, ['preparing', 'built']);
  } finally {
    offPreparing();
    offBuilt();
  }
});

test('a preparation failure propagates without replacing state or emitting floorBuilt', () => {
  buildFloor(0, 1237);
  const oldLeaks = G.leaks;
  const error = new Error('preparation failed');
  let built = false;
  const offPreparing = on(EVENT.floorPreparing, () => { throw error; });
  const offBuilt = on(EVENT.floorBuilt, () => { built = true; });
  try {
    assert.throws(() => buildFloor(1, 1238), err => err === error);
    assert.equal(G.leaks, oldLeaks);
    assert.equal(built, false);
  } finally {
    offPreparing();
    offBuilt();
  }
});
