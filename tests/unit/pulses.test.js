import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';
import { pulseReach, pulseDue, PULSE_RAYS, PULSE_TICKS } from '../../src/sim/pulse-reach.js';
import { tickRadarReveal } from '../../src/sim/radar.js';
import { hearRadius } from '../../src/sim/noise.js';
import { on, off, emit } from '../../src/util/events.js';
import { MAP_W, MAP_H, WALL, FLOOR, NOISE } from '../../src/config/constants.js';

const { A, G, calls } = await loadGame();
const buildFloor = A.buildFloor;
const render = A.render;

/* A grid of open floor, with optional wall tiles. */
function openGrid(){
  return new Uint8Array(MAP_W * MAP_H).fill(FLOOR);
}

/* Index of the ray that points along angle 0 (east), and the one that points west. */
const EAST = 0;
const WEST = PULSE_RAYS / 2;

test('an open floor lets a pulse reach its full hearing distance in every direction', () => {
  const power = 0.7;
  const R = hearRadius(power);
  const reach = pulseReach(openGrid(), 38.5, 38.5, power);
  assert.equal(reach.length, PULSE_RAYS);
  for (let i = 0; i < PULSE_RAYS; i++){
    assert.ok(reach[i] <= R + 1e-6, `ray ${i} reaches ${reach[i]} past ${R}`);
    assert.ok(reach[i] >= R - 0.15, `ray ${i} stops at ${reach[i]}, short of ${R}`);
  }
});

test('a wall cuts the rays that meet it, and leaves the others alone', () => {
  const grid = openGrid();
  // A wall column three tiles east of the origin's tile, running the full height of the map.
  for (let y = 0; y < MAP_H; y++) grid[y * MAP_W + 43] = WALL;
  const power = 0.7;
  const R = hearRadius(power);
  const reach = pulseReach(grid, 38.5, 38.5, power);
  assert.ok(reach[EAST] > 4.2 && reach[EAST] < 4.6,
    `the east ray should stop at the wall, about 4.5 tiles out, got ${reach[EAST]}`);
  assert.ok(reach[WEST] >= R - 0.15,
    `the west ray has no wall and should reach ${R}, got ${reach[WEST]}`);
});

test('the map edge counts as a wall, so a pulse never leaves the level', () => {
  const reach = pulseReach(openGrid(), 1.5, 1.5, 0.7);
  assert.ok(reach[WEST] < 2, `the west ray should stop at the map edge, got ${reach[WEST]}`);
});

test('a steady sound is due on its first tick, then every PULSE_TICKS ticks', () => {
  const holder = {};
  assert.equal(pulseDue(holder), true, 'the first tick of a sound pulses at once');
  let fired = [];
  for (let k = 1; k <= 2 * PULSE_TICKS + 1; k++){
    if (pulseDue(holder)) fired.push(k);
  }
  assert.deepEqual(fired, [PULSE_TICKS, 2 * PULSE_TICKS],
    'after the first pulse, the next comes after PULSE_TICKS ticks, then again');
});

test('a radar left on pings about every half second, and stops when it is switched off', () => {
  buildFloor(0, 99);
  G.radar = true;
  G.plumber.x = 10.5; G.plumber.y = 10.5;
  const seen = [];
  const listener = (x, y, power) => seen.push(power);
  on('pulse', listener);
  try {
    // 61 ticks: pulses on tick 1, 31 and 61.
    for (let i = 0; i < 61; i++) tickRadarReveal(G);
    assert.equal(seen.length, 3, `expected 3 pings in 61 ticks, got ${seen.length}`);
    assert.ok(seen.every(p => p === NOISE.RADAR), 'every ping carries the radar power');

    // Switch off, then on again: the next ping comes at once, not on the old count.
    G.radar = false;
    tickRadarReveal(G);
    G.radar = true;
    seen.length = 0;
    tickRadarReveal(G);
    assert.equal(seen.length, 1, 'switching the radar back on pings straight away');
  } finally {
    off('pulse', listener);
    G.radar = false;
  }
});

test('a sound pulse draws a ring that is gone once its life is over', () => {
  buildFloor(0, 1234);
  G.plumber.x = 10; G.plumber.y = 10;
  G.plumber.px = 10; G.plumber.py = 10;
  G.radar = false;
  G.battPulseT = 0;
  G.selfNoise = 0;

  let clock = 5000;
  // The last frame of n, so only what that frame drew is counted.
  const frame = (n) => {
    let last = [];
    for (let i = 0; i < n; i++){
      calls.list.length = 0;
      clock += 100;
      render(clock);
      last = calls.list.slice();
    }
    return last;
  };
  /* The background passes also draw lines, so each count is taken against a
     frame with no pulse in it. The camera is still, so that frame matches. */
  const rays = (list) => list.filter(c => c[0] === 'lineTo').length;

  frame(30);                       // let earlier tests' pulses and fades die down
  const base = rays(frame(1));

  // Emitted on the same bus a footstep uses.
  emit('pulse', 10.5, 10.5, NOISE.SPRINT);

  const young = rays(frame(4));    // about 0.4 s old: still growing
  assert.ok(young - base >= PULSE_RAYS - 1, `a fresh pulse draws its ring, got ${young - base} extra rays`);

  const old = rays(frame(20));     // more than the 1.2 s life
  assert.equal(old - base, 0, 'the ring is gone once its life is over');
});
