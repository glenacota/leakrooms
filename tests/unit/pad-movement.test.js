import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { WALK, SPRINT, NOISE } from '../../src/config/constants.js';
import { pad, clearInput } from '../../src/sim/keys.js';

const { A, G } = await loadGame();
const keys = A.keys;
A.setHeadless(false, false);

const DT = 1/60;
const W = 76;

/* Put the player on a tile with a wide patch of open floor around it, so a
   short walk in any direction cannot touch a wall. A bump would hide the speed
   difference these tests look for. */
function openSpot(){
  for (let ty = 6; ty < W-6; ty++){
    for (let tx = 6; tx < W-6; tx++){
      let ok = true;
      for (let j = -3; j <= 3 && ok; j++)
        for (let i = -3; i <= 3; i++)
          if (G.grid[(ty+j)*W + tx+i] !== 1){ ok = false; break; }
      if (ok) return [tx+0.5, ty+0.5];
    }
  }
  throw new Error('no open 7x7 patch on this floor');
}

function place(){
  A.buildFloor(0, 4242);
  clearInput();
  const [x, y] = openSpot();
  G.plumber.x = x; G.plumber.y = y;
  G.plumber.stepT = 0;
  G.selfNoise = 0;
  return [x, y];
}

/* Runs n steps of tickMovement and returns where the player ended and the
   loudest own-noise seen on the way. */
function run(n){
  let peak = 0;
  for (let i = 0; i < n; i++){
    A.tickMovement(DT);
    peak = Math.max(peak, G.selfNoise);
  }
  return { x: G.plumber.x, y: G.plumber.y, peak };
}

/* ---- a. the keyboard path, recorded from the code before the pad existed ---- */
const SCRIPT = [
  ['d'], ['d','shift'], ['s'], ['a','shift'], ['a'], ['w','d'], ['w','shift'], [],
];
function keyboardPath(){
  place();
  let peak = 0, sum = 0;
  for (let step = 0; step < 120; step++){
    for (const k of Object.keys(keys)) delete keys[k];
    for (const k of SCRIPT[(step/15)|0]) keys[k] = true;
    A.tickMovement(DT);
    peak = Math.max(peak, G.selfNoise);
    sum += G.selfNoise;
  }
  clearInput();
  return { x: G.plumber.x, y: G.plumber.y, peak, sum };
}

/* Recorded by running keyboardPath() on main BEFORE tickMovement read the pad. */
const EXPECTED = { x: 18.08336309447892, y: 29.241636905521055, peak: 0.7, sum: 76.50000000000016 };

test('[PAD] keyboard-only path is unchanged by the pad', () => {
  const r = keyboardPath();
  for (const k of ['x', 'y', 'peak', 'sum'])
    assert.ok(Math.abs(r[k] - EXPECTED[k]) < 1e-9, `${k} is ${r[k]}, want ${EXPECTED[k]}`);
});

test('[PAD] pad right walks the same line as the D key', () => {
  place(); keys['d'] = true;
  const a = run(15);
  keys['d'] = false;
  place(); pad.x = 1;
  const b = run(15);
  clearInput();
  assert.ok(a.x > 0 && b.x > 0);
  assert.equal(b.x, a.x);
  assert.equal(b.y, a.y);
  assert.equal(b.peak, a.peak);
});

test('[PAD] a diagonal stick is not faster than D+S', () => {
  const [x0, y0] = place(); keys['d'] = true; keys['s'] = true;
  const a = run(15);
  keys['d'] = false; keys['s'] = false;
  place(); pad.x = 1; pad.y = 1;
  const b = run(15);
  clearInput();
  const da = Math.hypot(a.x - x0, a.y - y0), db = Math.hypot(b.x - x0, b.y - y0);
  assert.ok(Math.abs(da - 15*DT*WALK) < 1e-9, `keys went ${da}`);
  assert.ok(Math.abs(db - da) < 1e-12, `pad went ${db}, keys ${da}`);
});

test('[PAD] pad sprint with a direction sprints and is loud', () => {
  const [x0] = place(); pad.x = 1; pad.sprint = true;
  const r = run(15);
  clearInput();
  assert.ok(Math.abs((r.x - x0) - 15*DT*SPRINT) < 1e-9, `moved ${r.x - x0}`);
  assert.ok(r.peak >= NOISE.SPRINT - 1e-9, `peak ${r.peak}, want ${NOISE.SPRINT}`);
});

test('[PAD] pad sprint with the stick centred does not sprint', () => {
  const [x0, y0] = place(); pad.sprint = true;
  const r = run(30);
  clearInput();
  assert.equal(r.x, x0);
  assert.equal(r.y, y0);
  assert.equal(r.peak, 0);
});

test('[PAD] released stick repairs, a pushed stick drains', () => {
  A.buildFloor(1, 77777);
  clearInput();
  const L = G.leaks.find(l => !l.fixed);
  const stand = () => { G.plumber.x = L.sx + 0.5; G.plumber.y = L.sy + 0.5; };
  for (let i = 0; i < 60; i++){ stand(); A.update(DT); }
  const built = L.repair;
  assert.ok(built > 0.5, `one second standing with the stick released gave ${built}`);
  pad.x = 1;
  for (let i = 0; i < 6; i++){ stand(); A.update(DT); }
  clearInput();
  assert.ok(L.repair < built, `pushing the stick left repair at ${L.repair}, was ${built}`);
});
