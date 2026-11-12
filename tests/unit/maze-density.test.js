import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { connectComponents, genMaze, mazeParams } from '../../src/sim/maze.js';
import { labelRegions } from '../../src/sim/regions.js';
import { mulberry32 } from '../../src/util/rng.js';

const W = 76;
const SEEDS = 30;

test('[DENSITY] component tunnels preserve legacy ordering', () => {
  const cases = [
    {
      input: [[4,4],[5,4],[4,5],[5,6]],
      output: [[4,4],[5,4],[4,5],[4,6],[5,6]],
    },
    {
      input: [[2,2],[3,2],[2,3],[3,3],[9,4],[9,5],[10,5]],
      output: [[2,2],[3,2],[2,3],[3,3],[3,4],[4,4],[5,4],[6,4],[7,4],[8,4],[9,4],[3,5],[4,5],[5,5],[6,5],[7,5],[8,5],[9,5],[10,5]],
    },
    {
      input: [[3,3],[4,3],[5,3],[3,4],[5,4],[3,5],[4,5],[5,5],[11,7],[12,7],[11,8],[12,8],[7,11],[8,11]],
      output: [[3,3],[4,3],[5,3],[3,4],[5,4],[3,5],[4,5],[5,5],[5,6],[5,7],[6,7],[7,7],[8,7],[9,7],[10,7],[11,7],[12,7],[5,8],[6,8],[7,8],[8,8],[9,8],[10,8],[11,8],[12,8],[11,9],[11,10],[7,11],[8,11],[9,11],[10,11],[11,11]],
    },
  ];
  for (const {input, output} of cases) {
    const grid = new Uint8Array(W * W);
    for (const [x, y] of input) grid[y * W + x] = 1;
    connectComponents(grid);
    const actual = Array.from(grid.keys()).filter(i => grid[i]).map(i => [i % W, Math.floor(i / W)]);
    assert.deepEqual(actual, output);
  }
});

test('[DENSITY] seeded layouts, regions and RNG draws remain stable', () => {
  const cases = [
    [0, 1, 1284, '24588a89a30a4f36983ada65318d47d212e7c1bab1f4dc42c02022ce2da30b1b', 'b9ae95d18bffcfd093241782f3bc8c0f352d00a9263b96410e9423350cc97e10'],
    [0, 42, 1379, '393ed6fd76bbc79cc011bbdc9938bdc8eabb4a7493ae6066e3f7ce5d4c1f2cde', '5d9692dc8374286dad0c84ed26f2db61ce0a1a52abdb1da7c0c04de7e2d92f64'],
    [0, 4242, 1272, 'bc74f654b7fc3c95e2adf56ef8a6942322bff4352ab7b87fe485315fa878e87d', 'c9e8173d9278afb7f5307ebb222c8ac13d84cb83770e7dbdc782712ad91f0346'],
    [0.5, 1, 1269, '63a9fc186c8649d684232ae4fbff290005e2d53ef1c0a9ceabffea3e4496724d', 'ce54fab78944248abd2fdb7c48f24ae9305d5ff29d3c6c326852862c0b91326c'],
    [0.5, 42, 1291, '694d60bc8db9f841f49550e2cd4e351dc9a3b92263889438c643cd2e9d269030', '5393df7789a4bdec3a3c22af0f83d3ffff46be5e43f192964b028dcc467a8c7d'],
    [0.5, 4242, 1220, 'f1f423d7c952dbfb2a2032adfe5931418fb0db05939b0cdf953a60609607ae19', 'a63c703938cc17627dec937df2fca65131e653d3b5af2fd1f0cb10c820cc5167'],
    [1, 1, 1102, '7b75aba5b7047afb9e8dcceb945b37dbc4ca7498050b03d9977f6302965fd67d', '5779e2ddb97705129531d12e2b8ff5b914642c55ef5b8aacaaa3a53ceaa9cc21'],
    [1, 42, 1124, 'ebb9bdb684ea3b0733f94ab181627e52fb06866aad617a6d6908e20afc4ad251', 'bb60be295bf64658bb7c2aab7a6f2accb89481a00ca73594a4e19d74a1e5f1ca'],
    [1, 4242, 1157, '210675766b5fe2d210c812f440852f1812ec317184a24ff9474fcee366bda30c', 'da13f6ad2365aa55d8799329e908fcb314f9ab937d3e45b4369de915dd5e7ad1'],
  ];
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  for (const [density, seed, expectedDraws, mazeHash, regionHash] of cases) {
    const random = mulberry32(seed);
    let draws = 0;
    const maze = genMaze(() => { draws++; return random(); }, density);
    const regions = labelRegions(maze);
    const context = `density ${density} seed ${seed}`;
    assert.equal(draws, expectedDraws, context);
    assert.equal(hash({grid: [...maze.grid], rooms: maze.rooms, shortcuts: maze.shortcuts}), mazeHash, context);
    assert.equal(hash({regionOf: [...regions.regionOf], regionAdj: regions.regionAdj, regionCount: regions.regionCount}), regionHash, context);
  }
});

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
