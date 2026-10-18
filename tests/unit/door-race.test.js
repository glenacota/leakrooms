/* The door and the thing standing on it, in the same frame.

   update() ran every stage in order and never asked whether the run was still
   on: a Lifeform that caught you at 1.49s of a 1.5s hold still let the door
   cycle, which emits door:cycled, which builds the NEXT floor. So the level
   advanced on the frame you died — the clear card came up, the descent was
   free, and the death cost nothing but a life. Nothing in the suite walked into
   it, because the race needs a player on the exact threshold tile with a
   HUNGER on top of them, which is what this file plants. */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';

const { A, G } = await loadGame();
A.setHeadless(false, false);

test('[41] a Lifeform on the threshold does not cycle the door', () => {
  A.buildFloor(0, 4242);
  A.floorIdx = 0;
  A.lives = 3;
  A.STATE = 'play';

  /* A floor that is finished: every pipe sealed, which is the only state the
     door will cycle from. */
  for (const L of G.leaks){ L.fixed = true; L.repair = 1; }
  G.leaksOpen = 0;

  const e = G.exitTiles[0];
  G.player.x = e.x + 0.5;
  G.player.y = e.y + 0.5;
  /* One frame short of the hold, so tickDoor() would cycle on the very next
     step if it ran at all. */
  G.descend = 1.49;

  const hunter = G.agents[0];
  hunter.x = G.player.x;
  hunter.y = G.player.y;
  hunter.state = 'HUNT';
  hunter.born = 0;
  hunter.target = { x: G.player.x, y: G.player.y };
  hunter.t = 0;

  const floorBefore = A.floorIdx;
  A.updateReal(1/60);

  assert.equal(A.STATE, 'dead',
    `a Lifeform standing on the player left STATE '${A.STATE}', want 'dead'`);
  assert.equal(A.floorIdx, floorBefore,
    `the door cycled on the frame the run ended: floorIdx went ${floorBefore} -> ${A.floorIdx} — dying at the door advanced the level`);
  assert.equal(G.ended, true, 'the floor was not told the run had ended');
  console.log('[41] a Lifeform on the threshold does not cycle the door');
  console.log(`  died at descend=1.49 on floor ${floorBefore}: STATE dead, floorIdx unchanged`);
});