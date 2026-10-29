import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';

const { A, G, calls } = await loadGame();
const buildFloor = A.buildFloor;
const render = A.render;

/* Diegetic ring layout constants, mirrored from src/render/passes/diegetic.js. */
const TILE   = 40;
const HEAD_Y = 0.6;
const RING_SPACING = 0.5;   /* centre-to-centre spacing, in tiles */
const RING_R   = 0.22;      /* ring radius, in tiles */
const RING_RADIUS = RING_R * TILE; /* 8.8 px */
const NOISE_FS = 0.85;
const LOUD     = 0.5;

/* Centre of the noise ring (left of the plumber's head) for a plumber at
   (x, y). simAlpha is 0 when render() is called directly, so the ring is at
   p.px / p.py, which we set equal to p.x / p.y. */
function noiseRingCentre(x, y){
  return {
    cx: (x - RING_SPACING / 2) * TILE,
    cy: (y - HEAD_Y) * TILE,
  };
}

/* Arc calls belonging to the noise ring: same centre and radius as the ring.
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
  calls.list.length = 0;
  render(1000);
  const quietText = calls.list.filter(c => c[0] === 'fillText' && c[1] === 'LOUD');
  t.ok(quietText.length === 0, 'no LOUD tag below LOUD');

  /* Loud: LOUD tag drawn just above the noise ring. */
  G.selfNoise = 0.7;
  calls.list.length = 0;
  render(1000);
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

  calls.list.length = 0;
  render(1000);

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
  calls.list.length = 0;
  render(1000);
  t.ok(ringArcs(cx, cy).length === 3,
    `below LOUD: expected exactly 3 arcs (single sweep), got ${ringArcs(cx, cy).length}`);

  /* Above LOUD: track + amber sweep + red sweep + tick = 4 arcs. */
  G.selfNoise = 0.7;
  calls.list.length = 0;
  render(1000);
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
  const bx = (10 + RING_SPACING / 2) * TILE; /* battery ring is right of the head */

  G.batt = 60;
  G.radar = true;
  G.selfNoise = 0;

  calls.list.length = 0;
  render(1000);

  /* Battery ring: track + sweep = 2 arcs at the battery position. */
  const battArcs = calls.list.filter(c =>
    c[0] === 'arc' &&
    Math.hypot(c[1] - bx, c[2] - cy) < 4 &&
    Math.abs(c[3] - RING_RADIUS) < 1
  );
  t.ok(battArcs.length === 2,
    `battery ring: expected 2 arcs (track + sweep), got ${battArcs.length}`);

  /* No noise ring arcs when silent. */
  G.selfNoise = 0;
  calls.list.length = 0;
  render(1000);
  const noiseArcs = ringArcs(nx, cy);
  t.ok(noiseArcs.length === 0, `no noise ring arcs when silent, got ${noiseArcs.length}`);
});

test('diegetic HUD draws nothing when the plumber is silent', () => {
  const t = assert;
  setup();
  const {cx, cy} = noiseRingCentre(10, 10);
  G.radar = false;
  G.battPulseT = 0;

  calls.list.length = 0;
  render(1000);

  t.ok(ringArcs(cx, cy).length === 0,
    `no noise ring arcs when silent, got ${ringArcs(cx, cy).length}`);
  const bx = (10 + RING_SPACING / 2) * TILE;
  const battArcs = calls.list.filter(c =>
    c[0] === 'arc' &&
    Math.hypot(c[1] - bx, c[2] - cy) < 4 &&
    Math.abs(c[3] - RING_RADIUS) < 1
  );
  t.ok(battArcs.length === 0, 'no battery ring arcs when radar off and no pulse');
});
