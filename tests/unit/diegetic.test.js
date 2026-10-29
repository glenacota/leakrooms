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

test('diegetic rings sit on a dark disc', () => {
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
});

/* The wave inside the noise ring is a polyline: one moveTo and a run of lineTo
   calls across the ring's centre. Its tallest point is its amplitude. */
function waveHeight(cx, cy){
  const pts = calls.list.filter(c =>
    (c[0] === 'moveTo' || c[0] === 'lineTo') && Math.abs(c[1] - cx) <= RING_RADIUS);
  return { n: pts.length, h: Math.max(0, ...pts.map(c => Math.abs(c[2] - cy))),
           w: Math.max(...pts.map(c => c[1])) - Math.min(...pts.map(c => c[1])) };
}

test('the sound wave grows with the volume and stays inside the ring', () => {
  const t = assert;
  setup();
  const {cx, cy} = noiseRingCentre(10, 10);
  const inner = RING_RADIUS - 1.5;

  G.selfNoise = 0.1;
  draw();
  const quiet = waveHeight(cx, cy);
  G.selfNoise = 0.3;
  draw();
  const walk = waveHeight(cx, cy);
  G.selfNoise = 0.85;
  draw();
  const full = waveHeight(cx, cy);

  t.ok(quiet.n > 10, `the wave is not drawn as a path (${quiet.n} points)`);
  t.ok(quiet.h < walk.h && walk.h < full.h,
    `the wave does not grow with the volume: ${quiet.h.toFixed(2)}, ${walk.h.toFixed(2)}, ${full.h.toFixed(2)}`);
  t.ok(full.h <= inner, `the loudest wave (${full.h.toFixed(2)}px) leaves the ring's inner ${inner}px`);
  t.ok(full.w <= inner*2, `the wave is wider (${full.w.toFixed(2)}px) than the ring's inside`);

  /* Past full scale (the door is 1.8) the wave stays the size of full scale. */
  G.selfNoise = 1.8;
  draw();
  const door = waveHeight(cx, cy);
  t.ok(door.h <= inner, `an over-scale noise drew a wave of ${door.h.toFixed(2)}px`);
});

test('the sound wave is a flat line when the volume is gone', () => {
  const t = assert;
  setup();
  const {cx, cy} = noiseRingCentre(10, 10);
  G.selfNoise = 0.5;
  draw();
  G.selfNoise = 0;
  /* One frame after the noise stops the ring is still fading, and its wave has
     fallen but is still a wave and not a hole. */
  calls.list.length = 0;
  clock += 100;
  render(clock);
  const fading = waveHeight(cx, cy);
  t.ok(fading.n > 10, 'the wave vanished the frame the noise stopped');
  t.ok(fading.h < 4, `the wave is still ${fading.h.toFixed(2)}px tall after the noise stopped`);
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

/* The radar scope: the last lineTo near the battery ring is the scope's turning
   line (the crosshair is drawn before it). Returns its angle and length. */
function scopeLine(bx, cy){
  const ends = calls.list.filter(c =>
    c[0] === 'lineTo' && Math.hypot(c[1] - bx, c[2] - cy) < RING_RADIUS);
  const e = ends[ends.length - 1];
  return e ? { angle: Math.atan2(e[2] - cy, e[1] - bx), len: Math.hypot(e[1] - bx, e[2] - cy) } : null;
}

/* The trail wedges are arcs at the scope's reach about the battery ring's centre. */
const SCOPE_REACH_PX = (RING_RADIUS - 1.5) * 0.9;
function trailArcs(bx, cy){
  return calls.list.filter(c =>
    c[0] === 'arc' && Math.hypot(c[1] - bx, c[2] - cy) < 1 && Math.abs(c[3] - SCOPE_REACH_PX) < 0.05);
}

test('the radar scope turns clockwise while the radar is on', () => {
  const t = assert;
  setup();
  const {cy} = noiseRingCentre(10, 10);
  const bx = (10 + SIDE) * TILE;
  G.radar = true;
  G.batt = 80;
  draw();

  const angles = [];
  for (let i = 0; i < 6; i++){
    calls.list.length = 0;
    clock += 33;
    render(clock);
    angles.push(scopeLine(bx, cy));
  }
  t.ok(angles.every(Boolean), 'no scope line drawn while the radar is on');
  const step = (a, b) => ((b - a) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI);
  for (let i = 1; i < angles.length; i++){
    const s = step(angles[i-1].angle, angles[i].angle);
    t.ok(s > 0.05 && s < 0.4, `the line moved ${s.toFixed(3)} rad in a frame, want about 0.15 clockwise`);
  }
  t.ok(Math.abs(angles[0].len - SCOPE_REACH_PX) < 0.05,
    `the scope line is ${angles[0].len.toFixed(2)}px long, want ${SCOPE_REACH_PX.toFixed(2)}`);
  G.radar = false;
});

test('the radar scope leaves a fading trail', () => {
  const t = assert;
  setup();
  const {cy} = noiseRingCentre(10, 10);
  const bx = (10 + SIDE) * TILE;
  G.radar = true;
  G.batt = 80;
  draw();
  t.ok(trailArcs(bx, cy).length === 10, `expected 10 trail bands, got ${trailArcs(bx, cy).length}`);
  G.radar = false;
});

test('the radar scope is still when the radar is off', () => {
  const t = assert;
  setup();
  const {cy} = noiseRingCentre(10, 10);
  const bx = (10 + SIDE) * TILE;
  /* A battery pickup lights the ring for a second with the radar off. */
  G.radar = false;
  G.battPulseT = 1;
  G.batt = 80;
  draw();
  t.ok(trailArcs(bx, cy).length === 0, 'the scope drew a trail with the radar off');
  const face = calls.list.filter(c =>
    c[0] === 'arc' && Math.hypot(c[1] - bx, c[2] - cy) < 1 && Math.abs(c[3] - SCOPE_REACH_PX/2) < 0.05);
  t.ok(face.length === 1, `expected the scope face's range ring, got ${face.length}`);
  G.battPulseT = 0;
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
