import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';
import { G } from '../../src/sim/state.js';

const { A } = await loadGame();

/* G is the contract every module reads: a field added to, or dropped from, the
   floor's state is a change to that contract. The whole key set is pinned
   here, so a new domain object or buffer cannot arrive silently. */
test('a built floor exposes exactly the state G owns', () => {
  A.buildFloor(0, 1234);
  assert.deepEqual(Object.keys(G), [
    'floor', 'seed', 'grid', 'at', 'inB', 'los', 'rooms', 'exitTiles', 'leaks', 'fixtures',
    'batteries', 'graffiti', 'openLeaks', 'totalLeaks', 'lightArr', 'lightCv', 'lightCtx', 'lightImg',
    'visArr', 'visFrom', 'visTgt', 'visScratch', 'maskArr', 'maskTgt', 'coneArr', 'maskCv',
    'maskCtx', 'maskImg', 'wallIdx', 'tilesCv', 'tilesCtx', 'wallsCv', 'wallsCtx', 'regionOf',
    'regionAdj', 'regionCount', 'visRegion', 'visStep', 'visFadeT', 'coneX', 'coneY', 'coneFace',
    'coneRadar', 'scopeDirty', 'wetArr', 'waterDist', 'wetByDist', 'wetFront', 'wetMaxDist',
    'wetSum', 'wetEdgeD', 'wetIndexAtDist', 'wetCv', 'wetCtx', 'wetImg', 'ended', 'arng',
    'dirty', 'lifeforms', 'plumber', 'batt', 'radar', 'radarRattleT', 'battPulseT', 'noise', 'noisePeak',
    'selfNoise', 'ambientNoise', 'descend', 'clock', 'time', 'seenBy', 'nearest', 'stat',
    'wetFloor', 'wet', 'floodCover', 'atLeak', 'leakPower', 'leakTotal', 'leakDist', 'gfx',
  ]);
});
