import test from 'node:test';
import assert from 'node:assert/strict';
import { genMaze, mazeParams } from '../../src/sim/maze.js';
import { mulberry32 } from '../../src/util/rng.js';

const W = 76;
const SEEDS = 30;

function largestSquare(grid) {
  const d = new Int16Array(W * W);
  let m = 0;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!grid[i]) continue;
    d[i] = (x && y) ? 1 + Math.min(d[i - 1], d[i - W], d[i - W - 1]) : 1;
    if (d[i] > m) m = d[i];
  }
  return m;
}

function connected(grid) {
  const start = grid.findIndex(v => v);
  const seen = new Uint8Array(grid.length);
  const stack = [start];
  seen[start] = 1;
  let n = 0;
  while (stack.length) {
    const i = stack.pop(); n++;
    for (const j of [i - 1, i + 1, i - W, i + W])
      if (j >= 0 && j < grid.length && grid[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
  }
  return n === grid.reduce((a, v) => a + (v ? 1 : 0), 0);
}

test('[DENSITY] mazeParams clamps and interpolates', () => {
  assert.deepEqual(mazeParams(-5), mazeParams(0));
  assert.deepEqual(mazeParams(9), mazeParams(1));
  assert.ok(mazeParams(1).maxRoom < mazeParams(0).maxRoom);
  assert.ok(mazeParams(1).openMax < mazeParams(0).openMax);
  assert.ok(mazeParams(1).shortcuts < mazeParams(0).shortcuts);
});

test('[DENSITY] every density stays connected', () => {
  for (const d of [0, 0.5, 1])
    for (let s = 1; s <= SEEDS; s++)
      assert.ok(connected(genMaze(mulberry32(s), d).grid), `density ${d} seed ${s}`);
});

test('[DENSITY] higher density shrinks the open squares', () => {
  const mean = d => {
    let t = 0;
    for (let s = 1; s <= SEEDS; s++) t += largestSquare(genMaze(mulberry32(s), d).grid);
    return t / SEEDS;
  };
  const lo = mean(0), hi = mean(1);
  assert.ok(lo <= 12, `density 0 mean ${lo}`);
  assert.ok(hi <= 8, `density 1 mean ${hi}`);
  assert.ok(hi < lo);
});
