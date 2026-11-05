import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';
import { G, installFloorState } from '../../src/sim/state.js';

const { A } = await loadGame();

/* G is the contract every module reads: a field added to, or dropped from, the
   floor's state is a change to that contract. The whole key set is pinned
   here, so a new domain object or buffer cannot arrive silently. */
test('a built floor exposes exactly the state G owns', () => {
  A.buildFloor(0, 1234);
  assert.deepEqual(Object.keys(G), [
    'floor', 'seed', 'grid', 'at', 'inB', 'los', 'rooms', 'exitTiles', 'leaks', 'fixtures',
    'batteries', 'notes', 'loreRng', 'openLeaks', 'totalLeaks', 'lightArr', 'lightCv', 'lightCtx', 'lightImg',
    'visArr', 'visFrom', 'visTgt', 'visScratch', 'maskArr', 'maskTgt', 'coneArr', 'maskCv',
    'maskCtx', 'maskImg', 'wallIdx', 'tilesCv', 'tilesCtx', 'wallsCv', 'wallsCtx', 'regionOf',
    'regionAdj', 'regionCount', 'visRegion', 'visStep', 'visFadeT', 'coneX', 'coneY', 'coneFace',
    'coneRadar', 'scopeDirty', 'wantVision', 'wetArr', 'waterDist', 'wetByDist', 'wetFront', 'wetMaxDist',
    'wetSum', 'wetEdgeD', 'wetIndexAtDist', 'wetCv', 'wetCtx', 'wetImg', 'ended', 'arng',
    'dirty', 'lifeforms', 'plumber', 'batt', 'radar', 'radarRattleT', 'battPulseT', 'noise', 'noisePeak',
    'selfNoise', 'ambientNoise', 'descend', 'clock', 'time', 'seenBy', 'nearest', 'stat',
    'wetFloor', 'wet', 'floodCover', 'atLeak', 'leakPower', 'leakTotal', 'leakDist', 'gfx',
  ]);
});

test('state installation rejects keys without one matching domain owner', () => {
  A.buildFloor(0, 1234);
  const previousFloor = G.floor;

  assert.throws(
    () => installFloorState({ level: { floor: 1, extra: true } }),
    /G state keys do not match domains/,
  );
  assert.equal(G.floor, previousFloor, 'invalid state replaced the installed floor');

  assert.throws(
    () => installFloorState({ first: { field: 1 }, second: { field: 2 } }),
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
