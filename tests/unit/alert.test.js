import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';
import { createCollision } from '../../src/sim/collision.js';

const { A, G } = await loadGame();
const buildFloor = A.buildFloor;
const update = A.update;
const REPAIR_TIME = A.REPAIR_TIME;
const REPAIR_NOISE = A.REPAIR_NOISE;
const REPAIR_REACH = A.REPAIR_REACH;
const hearRadius = A.hearRadius;
const sustainedNoise = A.sustainedNoise;
const alert = A.alert;
const tickRepair = A.tickRepair;
const tickAgents = A.tickAgents;

/* A rising lifeform ignores further sound until it is up.
   Real wrench path: build level 5, find a coil within 4-12 tiles that hears
   the wrench, stand the player at the pipe's standing spot, step frames. */
test('a rising lifeform ignores further sound until it is up (real wrench path)', () => {
  const t = softAssert();
{
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
      for (const a of G.agents){
        if (a.state !== 'DORMANT') continue;
        const d = Math.hypot(a.x - standX, a.y - standY);
        if (d < 4 || d > 12) continue;
        /* Check if the wrench noise reaches this agent. */
        const baseR = hearRadius(REPAIR_NOISE);
        if (d > baseR) continue;
        const { grid } = G;
        const { solid } = createCollision(grid);
        /* wallSteps equivalent - count walls on the line */
        let walls = 0;
        const sx = Math.floor(a.x), sy = Math.floor(a.y);
        const ex = Math.floor(standX), ey = Math.floor(standY);
        let cx = sx, cy = sy;
        const dx = Math.abs(ex - sx), dy = -Math.abs(ey - sy);
        const stepX = sx < ex ? 1 : -1, stepY = sy < ey ? 1 : -1;
        let err = dx + dy;
        for (let guard = 0; guard < W + W; guard++){
          if (cx === ex && cy === ey) break;
          const e2 = 2 * err;
          if (e2 >= dy){ err += dy; cx += stepX; }
          if (e2 <= dx){ err += dx; cy += stepY; }
          if (cx === ex && cy === ey) break;
          if (solid(cx, cy)) walls++;
        }
        const eff = baseR - walls * 3.0;
        if (d > eff) continue;
        chosen = { L, agent: a, dist: d, walls, baseR, eff };
        chosenSeed = seed;
        break;
      }
      if (chosen) break;
    }
    if (chosen) break;
  }

  t.assert(chosen, `no DORMANT coil within 4-12 tiles of a pipe that hears the wrench on any of ${seedsToTry.length} seeds`);
  console.log(`  seed ${chosenSeed}: chosen coil at dist ${chosen.dist.toFixed(2)} tiles, walls=${chosen.walls}, baseR=${chosen.baseR.toFixed(2)}, eff=${chosen.eff.toFixed(2)}`);

  /* Rebuild the chosen floor so G is set up correctly. */
  buildFloor(4, chosenSeed);

  /* Re-find the agent: look for a DORMANT agent at the right distance from the pipe. */
  const { L } = chosen;
  const standX = L.sx + 0.5;
  const standY = L.sy + 0.5;
  let agent = null;
  for (const a of G.agents){
    if (a.state !== 'DORMANT') continue;
    const d = Math.hypot(a.x - standX, a.y - standY);
    if (Math.abs(d - chosen.dist) < 0.5){
      agent = a;
      break;
    }
  }
  t.assert(agent, 'agent not found at expected distance from pipe after rebuild');

  /* Stand the player at the pipe's standing spot. */
  G.player.x = standX;
  G.player.y = standY;
  G.player.px = standX;
  G.player.py = standY;

  /* Make sure the agent is DORMANT and the player is not making other noise.
     Save the original position for the burst test later. */
  const origX = agent.x, origY = agent.y;
  agent.state = 'DORMANT';
  agent.rise = 0;
  agent.born = 0;

  /* Run one frame of repair (player not moving, not bumped) -> wrench noise emitted. */
  tickRepair(1/60, false, false);
  tickAgents(1/60);

  /* Frame 1: agent should be RISING. */
  t.assert(agent.state === 'RISING', `frame 1: expected RISING, got ${agent.state}`);
  console.log(`  frame 1: state=${agent.state}, rise=${agent.rise.toFixed(3)}`);

  /* Run 59 more frames (total 60) - agent should still be RISING. */
  for (let i = 2; i <= 60; i++){
    tickRepair(1/60, false, false);
    tickAgents(1/60);
  }
  t.assert(agent.state === 'RISING', `frame 60: expected RISING, got ${agent.state}`);
  console.log(`  frame 60: state=${agent.state}, rise=${agent.rise.toFixed(3)}`);

  /* Run 20 more frames (total 80) - agent should still be RISING (rise takes 1.4s = 84 frames at 60Hz). */
  for (let i = 61; i <= 80; i++){
    tickRepair(1/60, false, false);
    tickAgents(1/60);
  }
  t.assert(agent.state === 'RISING', `frame 80: expected RISING, got ${agent.state}`);
  console.log(`  frame 80: state=${agent.state}, rise=${agent.rise.toFixed(3)}`);

  /* Run a few more frames until HUNT. */
  let huntFrame = null;
  for (let i = 81; i <= 100; i++){
    tickRepair(1/60, false, false);
    tickAgents(1/60);
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
  tickAgents(1/60);

  t.assert(agent.state === 'RISING', `burst frame 1: expected RISING, got ${agent.state}`);

  /* Run 59 more frames. */
  for (let i = 2; i <= 60; i++){
    tickAgents(1/60);
  }
  t.assert(agent.state === 'RISING', `burst frame 60: expected RISING, got ${agent.state}`);

  /* Run 20 more frames (total 80). */
  for (let i = 61; i <= 80; i++){
    tickAgents(1/60);
  }
  t.assert(agent.state === 'RISING', `burst frame 80: expected RISING, got ${agent.state}`);

  /* Run until HUNT. */
  let huntFrameBurst = null;
  for (let i = 81; i <= 100; i++){
    tickAgents(1/60);
    if (agent.state === 'HUNT' && huntFrameBurst === null){
      huntFrameBurst = i;
    }
  }
  t.assert(huntFrameBurst !== null, 'agent never reached HUNT after burst within 100 frames');
  t.assert(huntFrameBurst >= 80, `agent reached HUNT at frame ${huntFrameBurst} after burst, expected >= 80`);
  console.log(`  burst frame ${huntFrameBurst}: state=${agent.state}`);
}
  t.done();
});