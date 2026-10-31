import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';

const { A, G, calls } = await loadGame();
const buildFloor = A.buildFloor;
const render = A.render;

/* Diegetic ring layout constants, mirrored from src/render/passes/diegetic.js. */
const TILE   = 40;
const BATT_Y  = -0.3;
const SIDE   = 0.8;         /* distance of each ring from the plumber, in tiles */
const RING_R   = 0.30;      /* ring radius, in tiles */
const RING_RADIUS = RING_R * TILE; /* 12 px */

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

// Centre of the battery ring (right of the plumber, lower than the noise ring).
function battRingCentre(x, y){
  return {
    bx: (x + SIDE) * TILE,
    by: (y - BATT_Y) * TILE,
  };
}

function setup(){
  buildFloor(0, 1234);
  G.plumber.x = 10; G.plumber.y = 10;
  G.plumber.px = 10; G.plumber.py = 10;
  G.radar = false;
  G.battPulseT = 0;
  G.selfNoise = 0;
}

test('diegetic battery ring draws when radar is on', () => {
  const t = assert;
  setup();
  const {bx, by} = battRingCentre(10, 10); /* battery ring is right of the plumber */

  G.batt = 60;
  G.radar = true;
  G.selfNoise = 0;

  draw();

  /* Battery ring: track + sweep = 2 arcs at the battery position. */
  const battArcs = calls.list.filter(c =>
    c[0] === 'arc' &&
    Math.hypot(c[1] - bx, c[2] - by) < 4 &&
    Math.abs(c[3] - RING_RADIUS) < 1
  );
  t.ok(battArcs.length === 2,
    `battery ring: expected 2 arcs (track + sweep), got ${battArcs.length}`);
  G.radar = false;
});

test('the battery ring sits on a dark disc', () => {
  const t = assert;
  setup();
  const {bx, by} = battRingCentre(10, 10);
  G.batt = 60;
  G.radar = true;

  draw();

  const discs = calls.list.filter(c =>
    c[0] === 'arc' && Math.abs(c[3] - (RING_RADIUS + 2)) < 0.01);
  t.ok(discs.some(d => Math.hypot(d[1] - bx, d[2] - by) < 1), 'no dark disc behind the battery ring');
  G.radar = false;
});

/* The wave inside the noise ring is a polyline: one moveTo and a run of lineTo
   calls across the ring's centre. Its tallest point is its amplitude. */
function waveHeight(cx, cy){
  const pts = calls.list.filter(c =>
    (c[0] === 'moveTo' || c[0] === 'lineTo') && Math.abs(c[1] - cx) <= RING_RADIUS);
  return { n: pts.length, h: Math.max(0, ...pts.map(c => Math.abs(c[2] - cy))),
           w: Math.max(...pts.map(c => c[1])) - Math.min(...pts.map(c => c[1])) };
}

test('the battery ring is drawn after the post-processing pass', () => {
  const t = assert;
  setup();
  const {bx, by} = battRingCentre(10, 10);
  G.batt = 60;
  G.radar = true;

  draw();

  const lastImage = calls.list.map(c => c[0]).lastIndexOf('drawImage');
  const track = calls.list.findIndex(c =>
    c[0] === 'arc' && Math.hypot(c[1] - bx, c[2] - by) < 4 && Math.abs(c[3] - RING_RADIUS) < 1);
  t.ok(lastImage >= 0 && track >= 0, 'expected post-processing draws and a ring track');
  t.ok(track > lastImage,
    `the ring track is call ${track} but the last post-pass drawImage is call ${lastImage}: the CRT would touch the ring`);
  G.radar = false;
});

test('the battery ring fades in and out instead of switching', () => {
  const t = assert;
  setup();
  const {bx, by} = battRingCentre(10, 10);
  const track = () => calls.list.filter(c =>
    c[0] === 'arc' && Math.hypot(c[1] - bx, c[2] - by) < 4 && Math.abs(c[3] - RING_RADIUS) < 1).length;

  draw();   /* let anything left by an earlier test fade out */
  G.batt = 60;
  G.radar = true;
  /* A frame with no time in it fades nothing in yet. */
  calls.list.length = 0;
  render(clock);
  t.ok(track() === 0, 'battery ring popped in with no fade');
  calls.list.length = 0;
  clock += 100;
  render(clock);
  t.ok(track() > 0, 'battery ring is not drawn on the first frame with time in it');

  draw();
  G.radar = false;
  /* One frame after the radar goes off the ring is still there, fading. */
  calls.list.length = 0;
  clock += 100;
  render(clock);
  t.ok(track() > 0, 'battery ring vanished the frame the radar switched off');
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
  const {bx, by: cy} = battRingCentre(10, 10);
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
  const {bx, by: cy} = battRingCentre(10, 10);
  G.radar = true;
  G.batt = 80;
  draw();
  t.ok(trailArcs(bx, cy).length === 10, `expected 10 trail bands, got ${trailArcs(bx, cy).length}`);
  G.radar = false;
});

test('the radar scope is still when the radar is off', () => {
  const t = assert;
  setup();
  const {bx, by: cy} = battRingCentre(10, 10);
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

/* A tag's text, alpha and colour from the last frame drawn, or null. */
function tagOf(text){
  const c = calls.list.filter(x => x[0] === 'fillText' && x[1] === text).pop();
  return c ? { alpha: c.alpha, style: c.style, x: c[2], y: c[3] } : null;
}

/* Draws n frames of dt seconds and returns the tag after the last one. */
function stepTag(text, n, dt){
  for (let i = 0; i < n; i++){
    calls.list.length = 0;
    clock += dt*1000;
    render(clock);
  }
  return tagOf(text);
}

test('the battery tag shows the charge in whole percent, in the ring colour', () => {
  const t = assert;
  setup();
  const {bx, by} = battRingCentre(10, 10);
  G.radar = true;
  const GREEN = '#8fd07a', DANGER = '#d8503c';

  G.batt = 82.3;
  draw();
  const high = tagOf('83%');
  t.ok(high, `no battery tag; wanted 83%`);
  t.ok(high && Math.abs(high.x - bx) < 0.5 && Math.abs(high.y - (by - RING_RADIUS - 7)) < 0.5,
    'the battery tag is not centred above the battery ring');
  t.ok(high && high.style === GREEN, `a charged battery's tag is ${high && high.style}, want green`);

  G.batt = 20;
  draw();
  const low = tagOf('20%');
  t.ok(low && low.style === DANGER, `a low battery's tag is ${low && low.style}, want red`);

  G.batt = 0.2;
  draw();
  t.ok(tagOf('1%'), 'a battery with any charge left did not read 1%');
  G.batt = 0;
  draw();
  t.ok(tagOf('0%'), 'an empty battery did not read 0%');

  /* The tag is part of the ring: it goes when the ring does, and does not time out. */
  G.batt = 60;
  draw();
  t.ok(stepTag('60%', 60, 0.05), 'the battery tag timed out while the ring was lit');
  G.radar = false;
  draw();
  t.ok(tagOf('60%') === null, 'the battery tag stayed after the ring faded');
  G.batt = 100;
});

test('diegetic HUD draws nothing when the radar is off and there is no pulse', () => {
  const t = assert;
  setup();
  G.radar = false;
  G.battPulseT = 0;

  draw();

  const {bx, by} = battRingCentre(10, 10);
  const battArcs = calls.list.filter(c =>
    c[0] === 'arc' &&
    Math.hypot(c[1] - bx, c[2] - by) < 4 &&
    Math.abs(c[3] - RING_RADIUS) < 1
  );
  t.ok(battArcs.length === 0, 'no battery ring arcs when radar off and no pulse');
});

test('the tags are 9px bold with a dark outline under the text', () => {
  const t = assert;
  setup();
  G.radar = true;
  G.batt = 60;
  G.selfNoise = 0.7;
  draw();
  for (const text of ['60%']){
    const fills = calls.list.filter(c => c[0] === 'fillText' && c[1] === text);
    const strokes = calls.list.filter(c => c[0] === 'strokeText' && c[1] === text);
    t.ok(fills.length === 1 && strokes.length === 1, `${text}: expected one outline and one fill`);
    const f = fills[0], s = strokes[0];
    t.ok(f.font.startsWith('bold 9px'), `${text} is drawn in "${f.font}", want bold 9px`);
    t.ok(s.style === 'rgba(12,14,10,0.85)' && s.width >= 1, `${text}'s outline is ${s.style} ${s.width}px`);
    t.ok(calls.list.indexOf(s) < calls.list.indexOf(f), `${text}'s outline is drawn over its fill`);
    t.ok(s[2] === f[2] && s[3] === f[3], `${text}'s outline is not under the text`);
  }
  G.radar = false;
  G.selfNoise = 0;
});
