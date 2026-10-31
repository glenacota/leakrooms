import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';
import { pulseDue, PULSE_TICKS } from '../../src/sim/pulse-timing.js';
import { tickRadarReveal } from '../../src/sim/radar.js';
import { hearRadius } from '../../src/sim/noise.js';
import { on, off, emit } from '../../src/util/events.js';
import { MAP_W, MAP_H, WALL, NOISE, TILE } from '../../src/config/constants.js';

const { A, G, calls } = await loadGame();
const buildFloor = A.buildFloor;
const render = A.render;

test('a steady sound is due on its first tick, then every PULSE_TICKS ticks', () => {
  const holder = {};
  assert.equal(pulseDue(holder), true, 'the first tick of a sound pulses at once');
  const fired = [];
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

/* A pulse is drawn as an arc centred on the sound. The canvas stub records arc
   arguments as (x, y, radius, start, end). Background passes also draw arcs, so
   the tests look for arcs at the pulse's own centre. */
const PULSE_X = 10.5, PULSE_Y = 10.5;
const arcsAtPulse = (list) => list.filter(c =>
  c[0] === 'arc' && Math.abs(c[1] - PULSE_X*TILE) < 0.01 && Math.abs(c[2] - PULSE_Y*TILE) < 0.01);

function setupRender(){
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
  return frame;
}

test('a sound pulse is a full circle at its hearing reach, whatever the walls are', () => {
  const frame = setupRender();
  // A wall column just east of the sound. A circle ignores it.
  for (let y = 0; y < MAP_H; y++) G.grid[y * MAP_W + 12] = WALL;

  const power = NOISE.SPRINT;
  emit('pulse', PULSE_X, PULSE_Y, power);
  // Six frames is 0.6 s: past the expansion, so the circle is at full reach.
  const arcs = arcsAtPulse(frame(6));
  const full = hearRadius(power) * TILE;
  assert.ok(arcs.some(c => Math.abs(c[3] - full) < 0.01),
    `expected a circle of radius ${full}px at the sound, got radii ${arcs.map(c => c[3].toFixed(1)).join(', ')}`);
});

test('a sound pulse grows out, then is gone once its life is over', () => {
  const frame = setupRender();
  frame(30);                                // let earlier tests' pulses and fades die down
  const base = arcsAtPulse(frame(1)).length;

  emit('pulse', PULSE_X, PULSE_Y, NOISE.SPRINT);

  const young = arcsAtPulse(frame(4)).length;   // about 0.4 s old: still growing
  assert.ok(young - base >= 1, `a fresh pulse draws its ring, got ${young - base} extra arcs`);

  const old = arcsAtPulse(frame(20));          // more than the 1.2 s life
  assert.equal(old.length - base, 0, 'the ring is gone once its life is over');
});
