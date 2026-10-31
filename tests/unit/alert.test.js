import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';

const { A, G } = await loadGame();
const buildFloor = A.buildFloor;
const REPAIR_NOISE = A.REPAIR_NOISE;
const hearRadius = A.hearRadius;
const sustainedNoise = A.sustainedNoise;
const wallSteps = A.wallSteps;
const alert = A.alert;
const tickRepair = A.tickRepair;
const tickLifeforms = A.tickLifeforms;

test('alert receives sound source and context objects', () => {
  const t = softAssert();
  const lf = {
    x: 5, y: 6, state: 'DORMANT', born: 0, rise: 0,
  };
  const src = { x: 2, y: 3, power: REPAIR_NOISE, mine: true };
  const ctx = { baseR: hearRadius(REPAIR_NOISE), px: 2, py: 3 };

  alert(lf, src, ctx);

  t.assert(lf.state === 'RISING', `expected RISING, got ${lf.state}`);
  t.assert(lf.target.x === src.x && lf.target.y === src.y,
    `target is (${lf.target.x}, ${lf.target.y}), expected sound source (${src.x}, ${src.y})`);
});

/* A rising lifeform ignores further sound until it is up.
   Real wrench path: build level 5, find a lifeform within 4-12 tiles that hears
   the wrench, stand the player at the leak's standing spot, step frames. */
test('a rising lifeform ignores further sound until it is up (real wrench path)', () => {
  const t = softAssert();
  const W = 76;
  const seedsToTry = [4242, 60606, 88, 9001, 31337, 2718, 12345, 1, 7, 99, 42, 1337];

  let chosen = null;
  let chosenSeed = null;

  for (const seed of seedsToTry){
    buildFloor(4, seed);
    for (const L of G.leaks){
      if (L.fixed) continue;
      const standX = L.sx + 0.5;
      const standY = L.sy + 0.5;
      for (const a of G.lifeforms){
        if (a.state !== 'DORMANT') continue;
        const d = Math.hypot(a.x - standX, a.y - standY);
        if (d < 4 || d > 12) continue;
        /* Check if the wrench noise reaches this agent. */
        const baseR = hearRadius(REPAIR_NOISE);
        if (d > baseR) continue;
        const eff = baseR - wallSteps(a.x, a.y, standX, standY) * 3.0;
        if (d > eff) continue;
        chosen = { L, agent: a, dist: d, baseR, eff };
        chosenSeed = seed;
        break;
      }
      if (chosen) break;
    }
    if (chosen) break;
  }

  t.assert(chosen, `no DORMANT lifeform within 4-12 tiles of a leak that hears the wrench on any of ${seedsToTry.length} seeds`);
  console.log(`  seed ${chosenSeed}: chosen lifeform at dist ${chosen.dist.toFixed(2)} tiles, baseR=${chosen.baseR.toFixed(2)}, eff=${chosen.eff.toFixed(2)}`);

  /* Rebuild the chosen floor so G is set up correctly. */
  buildFloor(4, chosenSeed);

  /* Re-find the agent: look for a DORMANT agent at the right distance from the leak. */
  const { L } = chosen;
  const standX = L.sx + 0.5;
  const standY = L.sy + 0.5;
  let agent = null;
  for (const a of G.lifeforms){
    if (a.state !== 'DORMANT') continue;
    const d = Math.hypot(a.x - standX, a.y - standY);
    if (Math.abs(d - chosen.dist) < 0.5){
      agent = a;
      break;
    }
  }
  t.assert(agent, 'agent not found at expected distance from leak after rebuild');

  /* Stand the player at the leak's standing spot. */
  G.plumber.x = standX;
  G.plumber.y = standY;
  G.plumber.px = standX;
  G.plumber.py = standY;

  /* Make sure the agent is DORMANT and the player is not making other noise.
     Save the original position for the burst test later. */
  const origX = agent.x, origY = agent.y;
  agent.state = 'DORMANT';
  agent.rise = 0;
  agent.born = 0;

  /* Run one frame of repair (player not moving, not bumped) -> wrench noise emitted. */
  tickRepair(1/60, false, false);
  tickLifeforms(1/60);

  /* Frame 1: agent should be RISING. */
  t.assert(agent.state === 'RISING', `frame 1: expected RISING, got ${agent.state}`);
  console.log(`  frame 1: state=${agent.state}, rise=${agent.rise.toFixed(3)}`);

  /* Run 59 more frames (total 60) - agent should still be RISING. */
  for (let i = 2; i <= 60; i++){
    tickRepair(1/60, false, false);
    tickLifeforms(1/60);
  }
  t.assert(agent.state === 'RISING', `frame 60: expected RISING, got ${agent.state}`);
  console.log(`  frame 60: state=${agent.state}, rise=${agent.rise.toFixed(3)}`);

  /* Run 20 more frames (total 80) - agent should still be RISING (rise takes 1.4s = 84 frames at 60Hz). */
  for (let i = 61; i <= 80; i++){
    tickRepair(1/60, false, false);
    tickLifeforms(1/60);
  }
  t.assert(agent.state === 'RISING', `frame 80: expected RISING, got ${agent.state}`);
  console.log(`  frame 80: state=${agent.state}, rise=${agent.rise.toFixed(3)}`);

  /* Run a few more frames until HUNT. */
  let huntFrame = null;
  for (let i = 81; i <= 100; i++){
    tickRepair(1/60, false, false);
    tickLifeforms(1/60);
    if (agent.state === 'HUNT' && huntFrame === null){
      huntFrame = i;
    }
  }
  t.assert(huntFrame !== null, 'agent never reached HUNT within 100 frames');
  t.assert(huntFrame >= 80, `agent reached HUNT at frame ${huntFrame}, expected >= 80`);
  console.log(`  frame ${huntFrame}: state=${agent.state}, rise=${agent.rise.toFixed(3)}`);

  /* Now test a single burst (emitNoise instead of sustained repair noise).
     Reset the agent to DORMANT at its original position (the HUNT movement may have
     taken it to a spot where walls block the sound). */
  agent.x = origX; agent.y = origY;
  agent.state = 'DORMANT';
  agent.rise = 0;
  agent.born = 0;

  /* Emit a single loud burst at the standing spot. */
  sustainedNoise(REPAIR_NOISE, standX, standY, true);
  tickLifeforms(1/60);

  t.assert(agent.state === 'RISING', `burst frame 1: expected RISING, got ${agent.state}`);

  /* Run 59 more frames. */
  for (let i = 2; i <= 60; i++){
    tickLifeforms(1/60);
  }
  t.assert(agent.state === 'RISING', `burst frame 60: expected RISING, got ${agent.state}`);

  /* Run 20 more frames (total 80). */
  for (let i = 61; i <= 80; i++){
    tickLifeforms(1/60);
  }
  t.assert(agent.state === 'RISING', `burst frame 80: expected RISING, got ${agent.state}`);

  /* Run until HUNT. */
  let huntFrameBurst = null;
  for (let i = 81; i <= 100; i++){
    tickLifeforms(1/60);
    if (agent.state === 'HUNT' && huntFrameBurst === null){
      huntFrameBurst = i;
    }
  }
  t.assert(huntFrameBurst !== null, 'agent never reached HUNT after burst within 100 frames');
  t.assert(huntFrameBurst >= 80, `agent reached HUNT at frame ${huntFrameBurst} after burst, expected >= 80`);
  console.log(`  burst frame ${huntFrameBurst}: state=${agent.state}`);;
});