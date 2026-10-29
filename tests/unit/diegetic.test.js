import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';

const { A, G, calls } = await loadGame();
const buildFloor = A.buildFloor;
const render = A.render;

/* Diegetic ring layout constants, mirrored from src/render/passes/diegetic.js. */
const TILE   = 40;
const BODY_Y = 0.1;
const SIDE   = 0.8;         /* distance of each ring from the plumber, in tiles */
const RING_R   = 0.30;      /* ring radius, in tiles */
const RING_RADIUS = RING_R * TILE; /* 12 px */
const NOISE_FS = 0.85;
const LOUD     = 0.5;

/* The rings fade, so one frame is not enough to see them (or to see them go).
   Eight frames of 0.1 s are longer than either fade, and the calls recorded are
   those of the last frame only. */
let clock = 1000;
function draw(){
  for (let i = 0; i < 8; i++){
    calls.list.length = 0;
    clock += 100;
    render(clock);
  }
}

/* Centre of the noise ring (left of the plumber) for a plumber at (x, y).
   simAlpha is 0 when render() is called directly, so the ring is at
   p.px / p.py, which we set equal to p.x / p.y. */
function noiseRingCentre(x, y){
  return {
    cx: (x - SIDE) * TILE,
    cy: (y - BODY_Y) * TILE,
  };
}

/* Arc calls belonging to a ring: same centre and radius as the ring. The dark
   disc and the glyph arcs have other radii, so they are not counted.
   Canvas arc args are (x, y, radius, startAngle, endAngle, ...). */
function ringArcs(cx, cy){
  return calls.list.filter(c =>
    c[0] === 'arc' &&
    Math.hypot(c[1] - cx, c[2] - cy) < 4 &&
    Math.abs(c[3] - RING_RADIUS) < 1
  );
}

function setup(){
  buildFloor(0, 1234);
  G.plumber.x = 10; G.plumber.y = 10;
  G.plumber.px = 10; G.plumber.py = 10;
  G.radar = false;
  G.battPulseT = 0;
  G.selfNoise = 0;
}

/* The LOUD tag test runs first, while loudTagT starts at 0, so the
   "absent when quiet" half isn't polluted by a previous test. */
test('diegetic noise ring: LOUD label shown when loud, absent when quiet', () => {
  const t = assert;
  setup();
  const {cx, cy} = noiseRingCentre(10, 10);

  /* Quiet: no LOUD tag (loudTagT starts at 0 in a fresh module). */
  G.selfNoise = 0.3;
  draw();
  const quietText = calls.list.filter(c => c[0] === 'fillText' && c[1] === 'LOUD');
  t.ok(quietText.length === 0, 'no LOUD tag below LOUD');

  /* Loud: LOUD tag drawn just above the noise ring. */
  G.selfNoise = 0.7;
  draw();
  const loudText = calls.list.find(c => c[0] === 'fillText' && c[1] === 'LOUD');
  t.ok(loudText, 'LOUD tag drawn when selfNoise >= LOUD');

  /* Tag sits above the ring: cx horizontally centred, cy - radius - offset. */
  const expectedY = cy - RING_RADIUS - 6;
  t.ok(Math.abs(loudText[3] - expectedY) < 4,
    `LOUD tag y=${loudText[3]}, expected near ${expectedY}`);
});

test('diegetic noise ring draws track, sweep and LOUD tick below LOUD', () => {
  const t = assert;
  setup();
  const {cx, cy} = noiseRingCentre(10, 10);
  G.selfNoise = 0.3;   /* below LOUD (0.5) */

  draw();

  const arcs = ringArcs(cx, cy);
  /* track (full circle) + sweep + threshold tick = 3 arcs */
  t.ok(arcs.length >= 3, `below LOUD: expected >=3 arcs at noise ring, got ${arcs.length}`);

  /* Track: full circle from 0 to TAU. (startAngle=c[4], endAngle=c[5]) */
  const track = arcs.find(a => Math.abs(a[4]) < 0.01 && Math.abs(a[5] - Math.PI * 2) < 0.01);
  t.ok(track, 'full-circle track arc present');

  /* Sweep: starts at -PI/2 (top of the ring). */
  const sweep = arcs.find(a => Math.abs(a[4] - (-Math.PI / 2)) < 0.01);
  t.ok(sweep, 'sweep arc starting at -PI/2 present');

  /* Threshold tick: short arc at the LOUD position. */
  const loudEnd = -Math.PI / 2 + (LOUD / NOISE_FS) * Math.PI * 2;
  const tick = arcs.find(a =>
    Math.abs(a[4] - (loudEnd - 0.10)) < 0.05 &&
    Math.abs(a[5] - (loudEnd + 0.10)) < 0.05
  );
  t.ok(tick, 'threshold tick at LOUD position present');
});

test('diegetic noise ring: two-tone sweep (amber to LOUD, red past it)', () => {
  const t = assert;
  setup();
  const {cx, cy} = noiseRingCentre(10, 10);
  const loudEnd = -Math.PI / 2 + (LOUD / NOISE_FS) * Math.PI * 2;

  /* Below LOUD: track + one sweep + tick = 3 arcs. */
  G.selfNoise = 0.3;
  draw();
  t.ok(ringArcs(cx, cy).length === 3,
    `below LOUD: expected exactly 3 arcs (single sweep), got ${ringArcs(cx, cy).length}`);

  /* Above LOUD: track + amber sweep + red sweep + tick = 4 arcs. */
  G.selfNoise = 0.7;
  draw();
  const arcsAbove = ringArcs(cx, cy);
  t.ok(arcsAbove.length === 4,
    `above LOUD: expected exactly 4 arcs (two-tone sweep), got ${arcsAbove.length}`);

  /* The two sweep arcs: amber starts at -PI/2 and ends at LOUD; red starts
     at LOUD and ends at the current progress. */
  const amberStart = arcsAbove.filter(a => Math.abs(a[4] - (-Math.PI / 2)) < 0.01);
  const redStart = arcsAbove.filter(a => Math.abs(a[4] - loudEnd) < 0.01);
  t.ok(amberStart.length === 1 && redStart.length === 1,
    `two-tone: expected 1 amber sweep starting at -PI/2 and 1 red sweep starting at LOUD, `+
    `got ${amberStart.length} amber-start and ${redStart.length} red-start`);
});

test('diegetic battery ring draws when radar is on', () => {
  const t = assert;
  setup();
  const {cx: nx, cy} = noiseRingCentre(10, 10);
  const bx = (10 + SIDE) * TILE; /* battery ring is right of the plumber */

  G.batt = 60;
  G.radar = true;
  G.selfNoise = 0;

  draw();

  /* Battery ring: track + sweep = 2 arcs at the battery position. */
  const battArcs = calls.list.filter(c =>
    c[0] === 'arc' &&
    Math.hypot(c[1] - bx, c[2] - cy) < 4 &&
    Math.abs(c[3] - RING_RADIUS) < 1
  );
  t.ok(battArcs.length === 2,
    `battery ring: expected 2 arcs (track + sweep), got ${battArcs.length}`);

  /* No noise ring arcs when silent. */
  t.ok(ringArcs(nx, cy).length === 0, `no noise ring arcs when silent, got ${ringArcs(nx, cy).length}`);
});

test('diegetic rings sit on a dark disc and carry a glyph', () => {
  const t = assert;
  setup();
  const {cx, cy} = noiseRingCentre(10, 10);
  const bx = (10 + SIDE) * TILE;
  G.batt = 60;
  G.radar = true;
  G.selfNoise = 0.3;

  draw();

  const discs = calls.list.filter(c =>
    c[0] === 'arc' && Math.abs(c[3] - (RING_RADIUS + 2)) < 0.01);
  t.ok(discs.some(d => Math.hypot(d[1] - cx, d[2] - cy) < 1), 'no dark disc behind the noise ring');
  t.ok(discs.some(d => Math.hypot(d[1] - bx, d[2] - cy) < 1), 'no dark disc behind the battery ring');

  /* The speaker glyph is two small arcs about the noise ring's centre. */
  const waves = calls.list.filter(c =>
    c[0] === 'arc' && Math.hypot(c[1] - cx, c[2] - cy) < 2 && c[3] < RING_RADIUS - 2);
  t.ok(waves.length === 2, `speaker glyph: expected 2 wave arcs, got ${waves.length}`);
});

test('diegetic rings fade in and out instead of switching', () => {
  const t = assert;
  setup();
  const {cx, cy} = noiseRingCentre(10, 10);

  draw();   /* let anything left by an earlier test fade out */
  G.selfNoise = 0.3;
  /* A frame with no time in it (same timestamp) fades nothing in yet. */
  calls.list.length = 0;
  render(clock);
  t.ok(ringArcs(cx, cy).length === 0, 'noise ring popped in with no fade');
  calls.list.length = 0;
  clock += 100;
  render(clock);
  t.ok(ringArcs(cx, cy).length > 0, 'noise ring is not drawn on the first frame with time in it');

  draw();
  G.selfNoise = 0;
  /* One frame after the noise stops the ring is still there, fading. */
  calls.list.length = 0;
  clock += 100;
  render(clock);
  t.ok(ringArcs(cx, cy).length > 0, 'noise ring vanished the frame the noise stopped');
});

test('diegetic rings are drawn after the post-processing pass', () => {
  const t = assert;
  setup();
  const {cx, cy} = noiseRingCentre(10, 10);
  G.selfNoise = 0.3;
  G.radar = true;

  draw();

  const lastImage = calls.list.map(c => c[0]).lastIndexOf('drawImage');
  const track = calls.list.findIndex(c =>
    c[0] === 'arc' && Math.hypot(c[1] - cx, c[2] - cy) < 4 && Math.abs(c[3] - RING_RADIUS) < 1);
  t.ok(lastImage >= 0 && track >= 0, 'expected post-processing draws and a ring track');
  t.ok(track > lastImage,
    `the ring track is call ${track} but the last post-pass drawImage is call ${lastImage}: the CRT would touch the ring`);
  G.radar = false;
});

test('diegetic HUD draws nothing when the plumber is silent', () => {
  const t = assert;
  setup();
  const {cx, cy} = noiseRingCentre(10, 10);
  G.radar = false;
  G.battPulseT = 0;

  draw();

  t.ok(ringArcs(cx, cy).length === 0,
    `no noise ring arcs when silent, got ${ringArcs(cx, cy).length}`);
  const bx = (10 + SIDE) * TILE;
  const battArcs = calls.list.filter(c =>
    c[0] === 'arc' &&
    Math.hypot(c[1] - bx, c[2] - cy) < 4 &&
    Math.abs(c[3] - RING_RADIUS) < 1
  );
  t.ok(battArcs.length === 0, 'no battery ring arcs when radar off and no pulse');
});
