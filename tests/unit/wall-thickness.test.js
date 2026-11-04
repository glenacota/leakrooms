import test from 'node:test';
import assert from 'node:assert/strict';
import { genMaze } from '../../src/sim/maze.js';
import { mulberry32 } from '../../src/util/rng.js';
import { FLOOR, MAP_H, MAP_W, MIN_WALL, WALL } from '../../src/config/constants.js';

const runLen = (grid, x, y, dx, dy) => {
  const at = (a, b) => a < 0 || b < 0 || a >= MAP_W || b >= MAP_H ? FLOOR : grid[b*MAP_W + a];
  let n = 1;
  for (let i=1; at(x+dx*i, y+dy*i) === WALL; i++) n++;
  for (let i=1; at(x-dx*i, y-dy*i) === WALL; i++) n++;
  return n;
};

test('no wall anywhere is thinner than MIN_WALL tiles', () => {
  for (let seed=1; seed<=60; seed++){
    const { grid } = genMaze(mulberry32(seed));
    for (let y=1; y<MAP_H-1; y++) for (let x=1; x<MAP_W-1; x++){
      if (grid[y*MAP_W+x] !== WALL) continue;
      assert.ok(runLen(grid, x, y, 1, 0) >= MIN_WALL && runLen(grid, x, y, 0, 1) >= MIN_WALL,
        `seed ${seed}: wall at ${x},${y} is thinner than ${MIN_WALL} tiles`);
    }
  }
});

test('the floor stays one connected area', () => {
  for (let seed=1; seed<=60; seed++){
    const { grid } = genMaze(mulberry32(seed));
    const start = grid.indexOf(FLOOR);
    const seen = new Uint8Array(grid.length), stack = [start];
    seen[start] = 1;
    let reached = 0;
    while (stack.length){
      const c = stack.pop(); reached++;
      const x = c % MAP_W, y = (c / MAP_W) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nx = x+dx, ny = y+dy;
        if (nx<0 || ny<0 || nx>=MAP_W || ny>=MAP_H) continue;
        const n = ny*MAP_W + nx;
        if (grid[n] === FLOOR && !seen[n]){ seen[n] = 1; stack.push(n); }
      }
    }
    const total = grid.reduce((s, v) => s + (v === FLOOR ? 1 : 0), 0);
    assert.equal(reached, total, `seed ${seed}: floor is split`);
  }
});
