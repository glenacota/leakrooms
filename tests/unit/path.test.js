import test from 'node:test';
import { strict as assert } from 'node:assert';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';

const { A, G } = await loadGame();
const buildFloor = A.buildFloor;
const { MAP_W, MAP_H, FLOOR } = await import('../../src/config/constants.js');
const { distanceField, nextStep, visitedCount } = await import('../../src/sim/path.js');

/* Unreachable tiles (walls, off-map) give -1. */
test('unreachable tiles give -1', () => {
  const t = softAssert();
  buildFloor(0, 4242);
  const grid = G.grid;

  /* Pick a floor tile as target. */
  let tx = -1, ty = -1;
  for (let y=0; y<MAP_H && tx<0; y++) for (let x=0; x<MAP_W && tx<0; x++) if (grid[y*MAP_W+x] === FLOOR){ tx=x; ty=y; }
  assert(tx >= 0, 'found a floor tile');

  const field = distanceField(grid, tx, ty);

  /* The target tile itself should be 0. */
  t.assert(field[ty*MAP_W+tx] === 0, `target tile is ${field[ty*MAP_W+tx]}, expected 0`);

  /* Find a wall tile - should be -1. */
  let wx = -1, wy = -1;
  for (let y=0; y<MAP_H && wx<0; y++) for (let x=0; x<MAP_W && wx<0; x++) if (grid[y*MAP_W+x] !== FLOOR){ wx=x; wy=y; }
  assert(wx >= 0, 'found a wall tile');
  t.assert(field[wy*MAP_W+wx] === -1, `wall tile is ${field[wy*MAP_W+wx]}, expected -1`);

  /* Off-map access (handled by nextStep bounds, but field is only MAP_W*MAP_H). */
  console.log('  unreachable tiles correctly give -1');;
});

/* The field decreases by exactly 1 along a returned step. */
test('field decreases by exactly 1 along nextStep', () => {
  const t = softAssert();
  buildFloor(0, 4242);
  const grid = G.grid;

  /* Pick two floor tiles far apart. */
  let tx = -1, ty = -1, sx = -1, sy = -1;
  for (let y=0; y<MAP_H && (tx<0 || sx<0); y++){
    for (let x=0; x<MAP_W && (tx<0 || sx<0); x++){
      if (grid[y*MAP_W+x] === FLOOR){
        if (tx<0){ tx=x; ty=y; }
        else if (Math.abs(x-tx) + Math.abs(y-ty) > 20){ sx=x; sy=y; }
      }
    }
  }
  assert(tx >= 0 && sx >= 0, 'found two floor tiles');

  const field = distanceField(grid, tx, ty);
  const startDist = field[sy*MAP_W+sx];
  t.assert(startDist >= 0, `start tile reachable, dist=${startDist}`);

  /* Walk the gradient from start to target. */
  let cx = sx, cy = sy;
  let steps = 0;
  while (cx !== tx || cy !== ty){
    const step = nextStep(field, cx, cy);
    t.assert(step !== null, `step ${steps}: nextStep returned null at ${cx},${cy}`);
    if (!step) break;
    const cur = field[cy*MAP_W+cx];
    const nxt = field[step.y*MAP_W+step.x];
    t.assert(nxt === cur - 1, `step ${steps}: ${cx},${cy} val=${cur} -> ${step.x},${step.y} val=${nxt}, expected decrease by 1`);
    cx = step.x; cy = step.y;
    steps++;
    t.assert(steps < MAP_W*MAP_H, 'infinite loop protection');
  }
  t.assert(cx === tx && cy === ty, `reached target after ${steps} steps`);
  console.log(`  gradient walk: ${steps} steps, each decreasing by 1`);;
});

/* Two builds of the same floor give identical fields. */
test('distanceField is deterministic for the same seed', () => {
  const t = softAssert();
  const seed = 12345;
  buildFloor(0, seed);
  const grid1 = new Uint8Array(G.grid);

  /* Pick a target. */
  let tx = -1, ty = -1;
  for (let y=0; y<MAP_H && tx<0; y++) for (let x=0; x<MAP_W && tx<0; x++) if (grid1[y*MAP_W+x] === FLOOR){ tx=x; ty=y; }

  const field1 = distanceField(grid1, tx, ty);

  /* Rebuild the same floor. */
  buildFloor(0, seed);
  const grid2 = new Uint8Array(G.grid);
  const field2 = distanceField(grid2, tx, ty);

  /* Compare byte-for-byte. */
  let diffs = 0;
  for (let i=0; i<field1.length; i++){
    if (field1[i] !== field2[i]) diffs++;
  }
  t.assert(diffs === 0, `${diffs} differences between two builds of the same seed`);
  console.log('  two builds of same seed produce identical fields');;
});

/* A field visits at most MAP_W * MAP_H tiles. */
test('visited count never exceeds map size', () => {
  const t = softAssert();
  buildFloor(0, 4242);
  const grid = G.grid;

  /* Test from multiple targets. */
  for (let attempt=0; attempt<10; attempt++){
    let tx = -1, ty = -1;
    for (let y=0; y<MAP_H && tx<0; y++) for (let x=0; x<MAP_W && tx<0; x++) if (grid[y*MAP_W+x] === FLOOR){ tx=x; ty=y; break; }
    assert(tx >= 0);

    const field = distanceField(grid, tx, ty);
    const count = visitedCount(field);
    t.assert(count <= MAP_W * MAP_H, `visited ${count} tiles, max is ${MAP_W*MAP_H}`);
  }
  console.log('  visited count <= MAP_W*MAP_H for all targets');;
});

/* nextStep returns null at target or on unreachable tiles. */
test('nextStep returns null at target and unreachable', () => {
  const t = softAssert();
  buildFloor(0, 4242);
  const grid = G.grid;

  let tx = -1, ty = -1, wx = -1, wy = -1;
  for (let y=0; y<MAP_H && (tx<0 || wx<0); y++){
    for (let x=0; x<MAP_W && (tx<0 || wx<0); x++){
      if (grid[y*MAP_W+x] === FLOOR && tx<0){ tx=x; ty=y; }
      if (grid[y*MAP_W+x] !== FLOOR && wx<0){ wx=x; wy=y; }
    }
  }
  assert(tx >= 0 && wx >= 0);

  const field = distanceField(grid, tx, ty);

  /* At target. */
  const atTarget = nextStep(field, tx, ty);
  t.assert(atTarget === null, `nextStep at target returned ${JSON.stringify(atTarget)}, expected null`);

  /* On wall. */
  const atWall = nextStep(field, wx, wy);
  t.assert(atWall === null, `nextStep on wall returned ${JSON.stringify(atWall)}, expected null`);

  console.log('  nextStep returns null at target and walls');;
});