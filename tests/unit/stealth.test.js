import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';

/* The simulation reports lifeform state changes through the `heard` event
   ({from, to, dist}). The shell turns the first occurrence of each `to`
   state per run into a short flash, so the player learns stealth from cause
   and effect instead of a tooltip. Lifeforms are placed a few tiles from the
   plumber: close enough to hear, far enough not to be touched. */
const { A, G, els } = await loadGame();
const buildFloor = A.buildFloor;
const update = A.update;
const emitNoise = A.emitNoise;
const OFF = 3; // tiles from the plumber: heard, but not caught

function lifeform(x, y, state){
  return { x, y, state, t: 0, rise: 0, target: null, face: 0,
           wakeCd: 0, stepT: 0, born: 0 };
}
function atOffset(dx = OFF, dy = 0){
  const p = G.plumber;
  return [p.x + dx, p.y + dy];
}

test('stealth: first wake per state flashes once, repeats are silent', () => {
  const t = softAssert();
  buildFloor(0, 4242);
  const flash = () => els['flashnote'].textContent;

  /* A loud noise next to a dormant coil: DORMANT -> RISING. */
  G.lifeforms = [lifeform(...atOffset(), 'DORMANT')];
  emitNoise(A.NOISE.REPAIR, ...atOffset(), true);
  update(1/60);
  t.assert(flash().includes('SOMETHING WOKE UP'),
    'the first DORMANT->RISING wake did not flash');

  /* A second dormant coil in the same run: same `to` state, so no new flash. */
  G.lifeforms = [lifeform(...atOffset(), 'DORMANT')];
  const before = flash();
  emitNoise(A.NOISE.REPAIR, ...atOffset(), true);
  update(1/60);
  t.assert(flash() === before,
    'the second DORMANT->RISING wake flashed again');

  /* A quiet noise makes a walker curious: WALK -> SEARCH. */
  G.lifeforms = [lifeform(...atOffset(), 'WALK')];
  emitNoise(A.NOISE.WALK, ...atOffset(), false);
  update(1/60);
  t.assert(flash().includes('IT HEARD THAT'),
    'the WALK->SEARCH wake did not flash');

  /* A loud noise makes a walker hunt: WALK -> HUNT. */
  G.lifeforms = [lifeform(...atOffset(), 'WALK')];
  emitNoise(A.NOISE.REPAIR, ...atOffset(), false);
  update(1/60);
  t.assert(flash().includes("IT'S COMING"),
    'the WALK->HUNT wake did not flash');

  /* Once every transition has been announced, repeating any of them adds
     nothing to the screen. */
  G.lifeforms = [lifeform(...atOffset(), 'DORMANT')];
  const again = flash();
  emitNoise(A.NOISE.REPAIR, ...atOffset(), true);
  update(1/60);
  t.assert(flash() === again,
    'a repeated RISING wake flashed again');

  console.log('  stealth: first wake per state flashes once, repeats are silent');;
});
