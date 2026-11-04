import test from 'node:test';
import assert from 'node:assert/strict';
import { genMaze } from '../../src/sim/maze.js';
import { labelRegions } from '../../src/sim/regions.js';
import { FLOOR, MAP_H, MAP_W } from '../../src/config/constants.js';
import { mulberry32 } from '../../src/util/rng.js';

test('an open 3x3 block of floor is never split across regions', () => {
  for (let seed=1; seed<=60; seed++){
    const { grid, rooms } = genMaze(mulberry32(seed));
    const { regionOf } = labelRegions({ grid, rooms });
    for (let y=1; y<MAP_H-1; y++) for (let x=1; x<MAP_W-1; x++){
      const c = y*MAP_W + x;
      let open = true;
      for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) if (grid[c + dy*MAP_W + dx] !== FLOOR) open = false;
      if (!open) continue;
      for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++)
        assert.equal(regionOf[c + dy*MAP_W + dx], regionOf[c], `seed ${seed} at ${x},${y}`);
    }
  }
});
