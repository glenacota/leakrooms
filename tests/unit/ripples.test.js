import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';
import {
  spawnGap, maxRadius, ringLife, ringRadius, ringAlpha, isRedRing,
  liveRingCount, MAX_RINGS, RADIUS_AT_LOUD,
} from '../../src/render/passes/ripples.js';

const { A, G, calls } = await loadGame();
const buildFloor = A.buildFloor;
const render = A.render;

const TILE = 40;
const LOUD = 0.5;
const NOISE_FS = 0.85;
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

/* Frames of render with time in them. Each is 100 ms, which is longer than the
   spawn gap, so rings come out every few frames. */
let clock = 1000;
function frames(n, ms = 100){
  for (let i = 0; i < n; i++){ clock += ms; render(clock); }
}

/* Arcs centred on the plumber's drawn position: the rings and the LOUD circle.
   The battery ring sits 0.8 tiles to the right, so it is not counted. */
function plumberArcs(){
  return calls.list.filter(c =>
    c[0] === 'arc' && Math.hypot(c[1] - G.plumber.x * TILE, c[2] - G.plumber.y * TILE) < 0.5);
}

function setup(){
  buildFloor(0, 1234);
  G.plumber.x = 10; G.plumber.y = 10;
  G.plumber.px = 10; G.plumber.py = 10;
  G.plumber.face = 0;
  G.radar = false;
  G.battPulseT = 0;
  G.selfNoise = 0;
  frames(40);          /* let the reference circle and any rings fade out */
}

/* ---------- The maths ---------- */

test('the spawn gap is 0.5 s at a walk and 0.26 s at a sprint or the wrench', () => {
  close(spawnGap(0.2), 0.5);
  close(spawnGap(0.7), 0.26);
  close(spawnGap(0.85), 0.26);
});

test('the spawn gap shortens as the noise rises', () => {
  let prev = Infinity;
  for (let n = 0.02; n <= 0.85; n += 0.01){
    const g = spawnGap(n);
    assert.ok(g <= prev + 1e-12, `gap grew at noise ${n.toFixed(2)}`);
    prev = g;
  }
});

test('a ring reaches 1.5 tiles at LOUD and scales from there', () => {
  close(RADIUS_AT_LOUD, 1.5);
  close(maxRadius(LOUD), 1.5);
  close(maxRadius(0.2), 0.6);
  close(maxRadius(0.7), 2.1);
  close(maxRadius(0.85), 2.55);
});

test('louder rings live a shorter time: 1.1 s at silence, 0.6 s at the wrench', () => {
  close(ringLife(0), 1.1);
  close(ringLife(0.85), 0.6);
  assert.ok(ringLife(0.7) < ringLife(0.2));
});

test('a ring starts as a dot and ends at its full radius', () => {
  close(ringRadius(0.7, 0), 0.15);
  close(ringRadius(0.7, ringLife(0.7)), maxRadius(0.7));
  close(ringRadius(0.2, ringLife(0.2) * 2), maxRadius(0.2), 1e-9);
});

test('a ring only grows: its radius never drops as it ages', () => {
  const life = ringLife(0.7);
  let prev = -Infinity;
  for (let t = 0; t <= life; t += 0.01){
    const r = ringRadius(0.7, t);
    assert.ok(r >= prev - 1e-12, `radius fell at age ${t.toFixed(2)}`);
    prev = r;
  }
});

test('a ring is fully opaque at birth at the wrench, and fainter at a walk', () => {
  close(ringAlpha(NOISE_FS, 0), 1);
  close(ringAlpha(0.2, 0), 0.2 / NOISE_FS);
  close(ringAlpha(0.7, ringLife(0.7)), 0);
});

test('a ring turns red only once it has crossed the LOUD circle', () => {
  assert.equal(isRedRing(1.49), false);
  assert.equal(isRedRing(1.5), true);
  /* A walk never reaches LOUD, so its rings are never red. */
  let walkRed = false;
  for (let t = 0; t <= ringLife(0.2); t += 0.01){
    if (isRedRing(ringRadius(0.2, t))) walkRed = true;
  }
  assert.equal(walkRed, false, 'a walk ring turned red');
  /* A sprint crosses LOUD on its way out. */
  let sprintRed = false;
  for (let t = 0; t <= ringLife(0.7); t += 0.01){
    if (isRedRing(ringRadius(0.7, t))) sprintRed = true;
  }
  assert.equal(sprintRed, true, 'a sprint ring never turned red');
});

/* ---------- The pass ---------- */

test('rings spawn while the plumber is noisy and clear once they are silent', () => {
  setup();
  G.selfNoise = 0.7;
  frames(3);
  assert.ok(liveRingCount() >= 1, 'no ring spawned while the plumber was noisy');

  G.selfNoise = 0;
  frames(20);          /* two seconds: every ring has outlived its life */
  assert.equal(liveRingCount(), 0, 'rings are still alive after the noise stopped');
});

test('no ring is drawn while the plumber is silent', () => {
  setup();
  G.selfNoise = 0;
  frames(5);
  calls.list.length = 0;   /* only the frame being checked */
  frames(1);
  assert.equal(plumberArcs().length, 0, 'arcs were drawn around a silent plumber');
});

test('the number of live rings never goes past the cap', () => {
  setup();
  G.selfNoise = 0.85;
  let peak = 0;
  for (let i = 0; i < 300; i++){
    clock += 16;
    render(clock);
    peak = Math.max(peak, liveRingCount());
  }
  assert.ok(peak >= 1, 'no rings were ever alive');
  assert.ok(peak <= MAX_RINGS, `${peak} live rings, the cap is ${MAX_RINGS}`);
});

test('a new floor clears every ring from the old one', () => {
  setup();
  G.selfNoise = 0.7;
  frames(3);
  assert.ok(liveRingCount() >= 1, 'setup did not make any rings');

  buildFloor(1, 999);
  assert.equal(liveRingCount(), 0, 'rings from the last floor survived the rebuild');
});

test('the rings are drawn after the post-processing pass', () => {
  setup();
  G.selfNoise = 0.7;
  frames(8);
  calls.list.length = 0;   /* only the frame being checked */
  frames(1);

  const lastImage = calls.list.map(c => c[0]).lastIndexOf('drawImage');
  const ring = calls.list.findIndex(c =>
    c[0] === 'arc' && Math.hypot(c[1] - G.plumber.x * TILE, c[2] - G.plumber.y * TILE) < 0.5);
  assert.ok(lastImage >= 0 && ring >= 0, 'expected post-processing draws and a ripple arc');
  assert.ok(ring > lastImage,
    `the ripple is call ${ring} but the last post-pass drawImage is call ${lastImage}: the CRT would touch it`);
});

test('the ripples never change the simulation', () => {
  setup();
  G.selfNoise = 0.7;
  const before = { x: G.plumber.x, y: G.plumber.y, self: G.selfNoise };
  frames(10);
  assert.deepEqual({ x: G.plumber.x, y: G.plumber.y, self: G.selfNoise }, before);
});

test('a moving, noisy plumber renders for 300 frames on a real floor without throwing', () => {
  buildFloor(2, 4242);
  G.plumber.px = G.plumber.x = 20.5; G.plumber.py = G.plumber.y = 20.5;
  let threw = null;
  try {
    for (let i = 0; i < 300; i++){
      G.plumber.px = G.plumber.x; G.plumber.py = G.plumber.y;
      G.plumber.x += 0.05;
      G.selfNoise = i % 120 < 60 ? 0.7 : 0.2;
      clock += 16;
      render(clock);
    }
  } catch (e){ threw = e; }
  assert.equal(threw, null, threw && threw.message);
  assert.ok(liveRingCount() <= MAX_RINGS);
  G.selfNoise = 0;
});
