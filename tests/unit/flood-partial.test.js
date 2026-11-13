import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';

/* Sealing one pipe while another is still open. Before this, the recession
   waited for the LAST pipe, so sealing one of four changed nothing on the floor.
   Now a sealed pipe's own front pulls back toward it, and the water that only
   that pipe was reaching dries. Water an open pipe still reaches stays wet. */

const { A, G } = await loadGame();
A.setHeadless(true, false);
const W = 76;
const run = (secs) => { for (let i = 0; i < secs * 4; i++) A.tickFlood(0.25); };

/* How far inside the water a tile is, measured by the leak whose front reaches
   it most deeply. Negative means no leak reaches the tile. */
function margin(i) {
  let m = -1;
  G.leakFront.forEach((f, k) => {
    const field = G.leakWaterDist[k];
    if (f > 0 && field && field[i] >= 0 && field[i] <= f) m = Math.max(m, f - field[i]);
  });
  return m;
}

function floorWithTwoLeaks() {
  for (let f = 0; f < A.LEVELS_N; f++) {
    for (const seed of [60606, 20250812, 1234, 777]) {
      A.buildFloor(f, seed);
      if (G.leaks.length >= 2) return;
    }
  }
  throw new Error('no generated floor has two leaks to test with');
}

test('sealing one of two pipes dries only the water it alone was feeding', () => {
  floorWithTwoLeaks();
  run(60);
  const a = 0, b = 1;
  const LA = G.leaks[a], LB = G.leaks[b];
  assert.ok(!LA.fixed && !LB.fixed, 'both pipes must start open');
  const spotA = LA.sy * W + LA.sx, spotB = LB.sy * W + LB.sx;
  assert.ok(G.wetArr[spotA] > 0.5 && G.wetArr[spotB] > 0.5, 'both standing spots should be wet before the seal');

  const wetBefore = new Set();
  for (let i = 0; i < W * W; i++) if (G.grid[i] === 1 && G.wetArr[i] > 0.5) wetBefore.add(i);

  A.sealLeak(LA);
  assert.equal(G.openLeaks, 1, 'one pipe should still be open');

  /* The sealed pipe's front backs off toward it at LEAK_RETREAT, not at the
     WET_FALL pace of a single tile. Measured over one second so the front is
     still moving. */
  const f0 = G.leakFront[a];
  assert.ok(f0 > 3, `the sealed pipe's front is only ${f0.toFixed(2)} tiles out; the window cannot measure a rate`);
  run(1);
  const drop = f0 - G.leakFront[a];
  assert.ok(Math.abs(drop - 1 / A.LEAK_RETREAT) < 0.01,
    `the sealed front receded ${drop.toFixed(3)} tiles in 1s, want ${(1 / A.LEAK_RETREAT).toFixed(3)}`);

  run(60);

  /* The open pipe still floods its own standing spot. */
  assert.ok(G.wetArr[spotB] > 0.5, 'the open pipe\'s standing spot dried, but its pipe is still open');
  /* The sealed pipe's standing spot is dry: nothing reaches it any more. */
  assert.ok(G.wetArr[spotA] < 0.05, `the sealed pipe's standing spot is still at ${G.wetArr[spotA].toFixed(2)}`);
  assert.ok(G.floodCover > 0, 'the open pipe should keep the floor partly flooded');

  /* Some water really did go: a tile that was wet before the seal and that no
     open pipe reaches now. Without this the invariant below could pass vacuously. */
  let abandoned = 0;
  for (const i of wetBefore) if (margin(i) < 0) abandoned++;
  assert.ok(abandoned > 0, 'sealing a pipe dried nothing that only it was feeding');

  /* The whole floor agrees with the fronts. A tile no front reaches must be
     dry, not stranded at a partial wetness. A tile well inside a front must be
     wet. */
  let stranded = 0, missing = 0;
  for (let i = 0; i < W * W; i++) {
    if (G.grid[i] !== 1) continue;
    const m = margin(i), w = G.wetArr[i];
    if (m < 0 && w > 0.05) stranded++;
    if (m >= 3 && w < 0.5) missing++;
  }
  assert.equal(stranded, 0, `${stranded} tiles no pipe reaches are still wet`);
  assert.equal(missing, 0, `${missing} tiles inside an open pipe's water are dry`);
});

test('with every pipe open, each front is the same and the flood is unchanged', () => {
  floorWithTwoLeaks();
  run(20);
  const open = G.leakFront.filter((_, k) => !G.leaks[k].fixed);
  assert.ok(open.length >= 2, 'expected at least two open fronts');
  for (const f of open) assert.equal(f, open[0], 'open pipes should share one front until a seal');
  assert.equal(G.wetFront, open[0], 'the scalar waterline is the furthest front');
});
