import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';
import { G, setFloorState } from '../../src/sim/state.js';

const { A } = await loadGame();

/* G is the contract every module reads: a field added to, or dropped from, the
   floor's state is a change to that contract. The whole key set is pinned
   here, so a new domain object or buffer cannot arrive silently. */
/* The key set is pinned as a sorted list. The order is derived from the domain
   factories, so only membership is a contract, and a reorder should not fail. */
const PINNED_KEYS = [
  'arng', 'at', 'ambientNoise', 'batt', 'batteries', 'battPulseT', 'clock', 'coneArr', 'coneFace',
  'coneRadar', 'coneX', 'coneY', 'descend', 'ended', 'exitTiles', 'fixtures', 'floodCover', 'floor',
  'grid', 'inB', 'leakDist', 'leakPower', 'leakTotal', 'leaks', 'lifeforms', 'lightArr',
  'loreRng', 'los', 'maskArr', 'maskTgt', 'nearest', 'noise', 'noisePeak', 'notes', 'openLeaks', 'plumber', 'radar',
  'radarRattleT', 'regionAdj', 'regionCount', 'regionOf', 'rooms', 'scopeDirty', 'seed', 'seenBy',
  'selfNoise', 'stat', 'time', 'totalLeaks', 'visArr', 'visFadeT', 'visFrom',
  'visRegion', 'visScratch', 'visStep', 'visTgt', 'wallIdx', 'wantVision',
  'atLeak', 'wet', 'wetArr', 'wetByDist', 'wetEdgeD', 'wetFloor', 'wetFront',
  'wetIndexAtDist', 'wetMaxDist', 'wetSum', 'waterDist', 'leakFront', 'leakWaterDist',
];

test('a built floor exposes exactly the state G owns', () => {
  A.buildFloor(0, 1234);
  assert.deepEqual([...Object.keys(G)].sort(), [...PINNED_KEYS].sort());
});

test('state installation rejects a field claimed by two domains', () => {
  A.buildFloor(0, 1234);
  const previousFloor = G.floor;

  assert.throws(
    () => setFloorState({ first: { field: 1 }, second: { field: 2 } }),
    /State key "field" has multiple domain owners/,
  );
  assert.equal(G.floor, previousFloor, 'duplicate ownership replaced the installed floor');
});

test('internal state fields stay owned but out of the flat key list', () => {
  A.buildFloor(0, 1234);
  assert.equal(typeof G.clockAnnounced, 'boolean');
  assert.equal('clockAnnounced' in G, true);
  assert.equal(Object.keys(G).includes('clockAnnounced'), false);
  assert.equal(Object.getOwnPropertyDescriptor(G, 'clockAnnounced').enumerable, false);
});

test('the flat facade rejects writes to keys without a domain owner', () => {
  A.buildFloor(0, 1234);
  assert.throws(() => { G.unowned = true; }, /unowned or computed G key "unowned"/);
  assert.throws(() => { G.gfx = {}; }, /unowned or computed G key "gfx"/);
});
