import test from 'node:test';
import { fakeAudioContext } from '../helpers/stubs.js';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';

const { A, G, els } = await loadGame();

test('[retry-leaks] a life lost and a retry keeps the already-sealed pipes sealed', () => {
  const t = softAssert();
  const seed = 4242;
  A.RUN_SEED = seed;
  A.buildFloor(0, seed);
  A.STATE = 'play';
  A.lives = 3;
  A.floorIdx = 0;

  // Seal the first (and only) pipe on floor 0.
  const before = G.leaks.map(l => ({ x: l.x, y: l.y, sx: l.sx, sy: l.sy, fixed: l.fixed }));
  const target = G.leaks[0];
  A.sealLeak(target);
  const sealedCount = G.leaks.filter(l => l.fixed).length;
  t.assert(sealedCount === 1, `expected 1 sealed before death, got ${sealedCount}`);

  // Die by running out the clock.
  G.clock = 0.5;
  A.updateReal(1);
  t.assert(A.STATE === 'dead', `death did not happen (STATE=${A.STATE})`);
  t.assert(A.lives === 2, `death cost no life (lives=${A.lives})`);

  // Retry the floor.
  els['btn-retry'].click();
  t.assert(A.STATE === 'play', `retry did not return to play (STATE=${A.STATE})`);

  const afterFixed = G.leaks.filter(l => l.fixed).length;
  t.assert(afterFixed === sealedCount,
    `retry lost the sealed pipe: ${afterFixed} fixed, want ${sealedCount}`);
  t.assert(G.leaksOpen === G.leaks.length - sealedCount,
    `leaksOpen wrong after retry: ${G.leaksOpen}, want ${G.leaks.length - sealedCount}`);

  // Positions are stable across the rebuild.
  for (let i = 0; i < before.length; i++) {
    const a = before[i], b = G.leaks[i];
    t.assert(a.x === b.x && a.y === b.y && a.sx === b.sx && a.sy === b.sy,
      `pipe ${i} moved across retry`);
  }

  // A sealed pipe is no longer a flood source.
  const fixedPipe = G.leaks.find(l => l.fixed);
  const idx = fixedPipe.sy * 76 + fixedPipe.sx;
  t.assert(G.waterDist && G.waterDist[idx] === -1,
    `sealed pipe still feeds the flood (waterDist=${G.waterDist ? G.waterDist[idx] : 'n/a'})`);

  t.done();
});

test('[retry-leaks] sealing every pipe then dying keeps them all sealed on retry', () => {
  const t = softAssert();
  const seed = 7;
  A.RUN_SEED = seed;
  A.buildFloor(0, seed);
  A.STATE = 'play';
  A.lives = 3;
  A.floorIdx = 0;
  for (const L of G.leaks) A.sealLeak(L);
  const total = G.leaks.length;
  t.assert(G.leaksOpen === 0, `not all sealed before death (open=${G.leaksOpen})`);

  G.clock = 0.5;
  A.updateReal(1);
  t.assert(A.STATE === 'dead', 'death did not happen');
  els['btn-retry'].click();
  t.assert(A.STATE === 'play', 'retry did not return to play');
  t.assert(G.leaks.filter(l => l.fixed).length === total,
    `retry lost sealed pipes: ${G.leaks.filter(l => l.fixed).length}/${total}`);
  t.assert(G.leaksOpen === 0, `leaksOpen not zero after retry (open=${G.leaksOpen})`);

  t.done();
});

test('[retry-leaks] a fresh floor after nextFloor carries nothing over', () => {
  const t = softAssert();
  const seed = 99;
  A.RUN_SEED = seed;
  A.buildFloor(0, seed);
  A.STATE = 'play';
  A.lives = 3;
  A.floorIdx = 0;
  for (const L of G.leaks) A.sealLeak(L);
  t.assert(G.leaks.filter(l => l.fixed).length === G.leaks.length, 'precondition: not all sealed');

  A.nextFloor();
  t.assert(A.STATE === 'clear' || A.STATE === 'play', `unexpected state ${A.STATE}`);
  // Dismiss the clear card to enter the next floor if needed.
  if (A.STATE === 'clear') A.dismissClear();
  t.assert(G.leaks.filter(l => l.fixed).length === 0,
    `sealed pipes leaked onto the next floor: ${G.leaks.filter(l => l.fixed).length}`);

  t.done();
});

/* Make the cast reproducible on retry.
   Build the same (floor, seed) four times in a row and assert identical
   agent (state, x, y) lists. */
test('[retry-leaks] the cast is identical across four rebuilds of the same floor', () => {
  const t = softAssert();
  const seed = 12345;
  const floorNum = 0;

  // Build the floor four times and capture agent lists each time.
  const runs = [];
  for (let i = 0; i < 4; i++) {
    A.buildFloor(floorNum, seed);
    const agents = G.lifeforms.map(a => ({
      state: a.state,
      x: a.x,
      y: a.y
    }));
    runs.push(agents);
  }

  // All four runs should have identical agent lists.
  for (let i = 1; i < 4; i++) {
    t.assert(runs[i].length === runs[0].length,
      `run ${i} has ${runs[i].length} agents, run 0 has ${runs[0].length}`);
    for (let j = 0; j < runs[0].length; j++) {
      const a0 = runs[0][j];
      const ai = runs[i][j];
      t.assert(ai.state === a0.state,
        `run ${i} agent ${j} state: ${ai.state} vs ${a0.state}`);
      t.assert(ai.x === a0.x,
        `run ${i} agent ${j} x: ${ai.x} vs ${a0.x}`);
      t.assert(ai.y === a0.y,
        `run ${i} agent ${j} y: ${ai.y} vs ${a0.y}`);
    }
  }
  console.log(`  ${runs[0].length} agents identical across 4 rebuilds: `+
    runs[0].map(a => `${a.state}@(${a.x.toFixed(2)},${a.y.toFixed(2)})`).join(', '));
  t.done();
});
