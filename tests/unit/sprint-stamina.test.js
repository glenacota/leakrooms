import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { SPRINT, SPRINT_STAMINA, SPRINT_RECOVERY_SECONDS, WALK } from '../../src/config/constants.js';
import { pad, clearInput } from '../../src/sim/keys.js';

const { A, G } = await loadGame();
A.setHeadless(false, false);

const DT = 1/60;
const MAP_W = 76;

function openSpot(){
  for (let y = 6; y < MAP_W-6; y++){
    for (let x = 6; x < MAP_W-6; x++){
      let open = true;
      for (let dy = -3; dy <= 3 && open; dy++)
        for (let dx = -3; dx <= 3; dx++)
          if (G.grid[(y+dy)*MAP_W + x+dx] !== 1){ open = false; break; }
      if (open) return [x+0.5, y+0.5];
    }
  }
  throw new Error('no open 7x7 patch on this floor');
}

function place(){
  A.buildFloor(0, 4242);
  clearInput();
  const [x, y] = openSpot();
  G.plumber.x = x;
  G.plumber.y = y;
  return [x, y];
}

test('sprint stamina drains for ten seconds, then sprint input only walks', () => {
  place();
  const steps = SPRINT_STAMINA/DT;
  pad.x = 1;
  pad.sprint = true;

  for (let i = 0; i < steps; i++) A.tickMovement(DT);
  assert.equal(G.plumber.stamina, 0);

  place();
  G.plumber.stamina = 0;
  pad.x = 1;
  pad.sprint = true;
  const x = G.plumber.x;
  const before = G.plumber.x;
  A.tickMovement(DT);
  assert.ok(Math.abs((G.plumber.x - before) - WALK*DT) < 1e-9);
  assert.ok(G.plumber.x > x);
  clearInput();
});

test('stamina refills only after sprint input stops', () => {
  place();
  pad.x = 1;
  pad.sprint = true;
  for (let i = 0; i < SPRINT_STAMINA/DT; i++) A.tickMovement(DT);

  for (let i = 0; i < 60; i++) A.tickMovement(DT);
  assert.equal(G.plumber.stamina, 0, 'holding sprint at zero does not refill');

  pad.sprint = false;
  for (let i = 0; i < SPRINT_RECOVERY_SECONDS/2/DT; i++) A.tickMovement(DT);
  assert.ok(Math.abs(G.plumber.stamina - SPRINT_STAMINA/2) < 1e-9);

  for (let i = 0; i < SPRINT_RECOVERY_SECONDS/2/DT; i++) A.tickMovement(DT);
  assert.ok(Math.abs(G.plumber.stamina - SPRINT_STAMINA) < 1e-9);
  clearInput();
});

test('sprint noise and speed remain unchanged while stamina remains', () => {
  const [x] = place();
  pad.x = 1;
  pad.sprint = true;
  A.tickMovement(DT);
  assert.ok(Math.abs((G.plumber.x - x) - SPRINT*DT) < 1e-9);
  assert.ok(G.selfNoise >= A.SPRINT_NOISE - 1e-9);
  clearInput();
});
