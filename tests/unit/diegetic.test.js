import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';
import { SPRINT_STAMINA } from '../../src/config/constants.js';
import { PAL } from '../../src/config/palette.js';

const { A, G, calls } = await loadGame();
const buildFloor = A.buildFloor;
const render = A.render;

/* Diegetic ring layout constants, mirrored from src/render/passes/diegetic.js. */
const TILE   = 40;
const BATT_Y  = 0.3;
const SIDE   = 1;         /* distance of the ring from the plumber, in tiles */
const RING_R   = 0.38;      /* radius of the cells' centre line, in tiles */
const RING_RADIUS = RING_R * TILE; /* 18 px */
const CELL_LW = 2;
const CELLS = 10;
const UNLIT = 'rgba(230,235,200,0.18)';
const GREEN = '#8fd07a', DANGER = '#d8503c';

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

// Centre of the battery ring, right of the plumber.
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

/* The ring's cells: arcs on the cells' radius about the ring's centre. */
function cellArcs(bx, by){
  return calls.list.filter(c => c[0] === 'arc' &&
    Math.hypot(c[1] - bx, c[2] - by) < 1 && Math.abs(c[3] - RING_RADIUS) < 0.01);
}
const lit = arcs => arcs.filter(c => c.style !== UNLIT).length;

test('the battery ring is ten separate cells while the radar is on', () => {
  setup();
  const {bx, by} = battRingCentre(10, 10);
  G.batt = 60;
  G.radar = true;
  draw();
  const arcs = cellArcs(bx, by);
  assert.equal(arcs.length, CELLS);
  for (const a of arcs){
    const span = a[5] - a[4];
    assert.ok(span > 0 && span < 2*Math.PI/CELLS, `a cell spans ${span} rad, want a gap on each side`);
  }
  G.radar = false;
});

test('the lit cells are the charge rounded up to the next ten', () => {
  setup();
  const {bx, by} = battRingCentre(10, 10);
  G.radar = true;
  const cases = [[100, 10], [60, 6], [59.9, 6], [12, 2], [0.2, 1], [0, 0]];
  for (const [batt, want] of cases){
    G.batt = batt;
    draw();
    assert.equal(lit(cellArcs(bx, by)), want, `${batt}% should light ${want} cells`);
  }
  G.radar = false;
});

test('the lit cells fill clockwise from the top, so the dim ones are the empty part', () => {
  setup();
  const {bx, by} = battRingCentre(10, 10);
  G.radar = true;
  G.batt = 30;
  draw();
  const arcs = cellArcs(bx, by);
  assert.ok(Math.abs(arcs[0][4] + Math.PI/2) < 0.2, 'the first cell does not start at the top');
  arcs.forEach((a, i) => assert.equal(a.style !== UNLIT, i < 3, `cell ${i} has the wrong state`));
  G.radar = false;
});

test('the cells turn red at or below BATT_LOW (four cells) and not above it', () => {
  setup();
  const {bx, by} = battRingCentre(10, 10);
  G.radar = true;
  for (const [batt, colour] of [[40, DANGER], [20, DANGER], [40.5, GREEN], [80, GREEN]]){
    G.batt = batt;
    draw();
    const on = cellArcs(bx, by).filter(c => c.style !== UNLIT);
    assert.ok(on.every(c => c.style === colour), `${batt}% cells are not ${colour}`);
  }
  G.radar = false;
});

test('the battery ring sits on a dark disc', () => {
  setup();
  const {bx, by} = battRingCentre(10, 10);
  G.batt = 60;
  G.radar = true;
  draw();
  const discR = RING_RADIUS + CELL_LW/2 + 2;
  const discs = calls.list.filter(c => c[0] === 'arc' && Math.abs(c[3] - discR) < 0.01);
  assert.ok(discs.some(d => Math.hypot(d[1] - bx, d[2] - by) < 1), 'no dark disc behind the battery ring');
  G.radar = false;
});

test('the ring clears the plumber\'s body', () => {
  /* The plumber's collision radius is 0.33 tile. */
  assert.ok(SIDE - RING_R - CELL_LW/2/TILE > 0.33);
});

test('the battery ring is drawn after the post-processing pass', () => {
  setup();
  const {bx, by} = battRingCentre(10, 10);
  G.batt = 60;
  G.radar = true;
  draw();
  const lastImage = calls.list.map(c => c[0]).lastIndexOf('drawImage');
  const first = calls.list.findIndex(c =>
    c[0] === 'arc' && Math.hypot(c[1] - bx, c[2] - by) < 1 && Math.abs(c[3] - RING_RADIUS) < 0.01);
  assert.ok(lastImage >= 0 && first >= 0, 'expected post-processing draws and ring cells');
  assert.ok(first > lastImage, `the first cell is call ${first} but the last post-pass drawImage is call ${lastImage}: the CRT would touch the ring`);
  G.radar = false;
});

test('the battery ring fades in and out instead of switching', () => {
  setup();
  const {bx, by} = battRingCentre(10, 10);
  const n = () => cellArcs(bx, by).length;

  draw();   /* let anything left by an earlier test fade out */
  G.batt = 60;
  G.radar = true;
  /* A frame with no time in it fades nothing in yet. */
  calls.list.length = 0;
  render(clock);
  assert.equal(n(), 0, 'battery ring popped in with no fade');
  calls.list.length = 0;
  clock += 100;
  render(clock);
  assert.ok(n() > 0, 'battery ring is not drawn on the first frame with time in it');

  draw();
  G.radar = false;
  /* One frame after the radar goes off the ring is still there, fading. */
  calls.list.length = 0;
  clock += 100;
  render(clock);
  assert.ok(n() > 0, 'battery ring vanished the frame the radar switched off');
});

/* The radar scope: the last lineTo near the ring's centre is the scope's
   turning line (the crosshair is drawn before it). Returns its angle and length. */
function scopeLine(bx, cy){
  const ends = calls.list.filter(c =>
    c[0] === 'lineTo' && Math.hypot(c[1] - bx, c[2] - cy) < RING_RADIUS);
  const e = ends[ends.length - 1];
  return e ? { angle: Math.atan2(e[2] - cy, e[1] - bx), len: Math.hypot(e[1] - bx, e[2] - cy) } : null;
}

/* The scope reaches 0.8 of the cells' inner radius. */
const SCOPE_REACH_PX = (RING_RADIUS - CELL_LW/2) * 0.8;
function trailArcs(bx, cy){
  return calls.list.filter(c =>
    c[0] === 'arc' && Math.hypot(c[1] - bx, c[2] - cy) < 1 && Math.abs(c[3] - SCOPE_REACH_PX) < 0.05);
}

test('the radar scope turns clockwise while the radar is on', () => {
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
  assert.ok(angles.every(Boolean), 'no scope line drawn while the radar is on');
  const step = (a, b) => ((b - a) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI);
  for (let i = 1; i < angles.length; i++){
    const s = step(angles[i-1].angle, angles[i].angle);
    assert.ok(s > 0.05 && s < 0.4, `the line moved ${s.toFixed(3)} rad in a frame, want about 0.15 clockwise`);
  }
  assert.ok(Math.abs(angles[0].len - SCOPE_REACH_PX) < 0.05,
    `the scope line is ${angles[0].len.toFixed(2)}px long, want ${SCOPE_REACH_PX.toFixed(2)}`);
  G.radar = false;
});

test('the radar scope leaves a fading trail', () => {
  setup();
  const {bx, by: cy} = battRingCentre(10, 10);
  G.radar = true;
  G.batt = 80;
  draw();
  assert.equal(trailArcs(bx, cy).length, 10);
  G.radar = false;
});

test('the radar scope is still when the radar is off', () => {
  setup();
  const {bx, by: cy} = battRingCentre(10, 10);
  /* A battery pickup lights the ring for a second with the radar off. */
  G.radar = false;
  G.battPulseT = 1;
  G.batt = 80;
  draw();
  assert.equal(trailArcs(bx, cy).length, 0, 'the scope drew a trail with the radar off');
  const face = calls.list.filter(c =>
    c[0] === 'arc' && Math.hypot(c[1] - bx, c[2] - cy) < 1 && Math.abs(c[3] - SCOPE_REACH_PX/2) < 0.05);
  assert.equal(face.length, 1, 'expected the scope face\'s range ring');
  G.battPulseT = 0;
});

/* A label's text, alpha and colour from the last frame drawn, or null. */
function labelOf(text){
  const c = calls.list.filter(x => x[0] === 'fillText' && x[1] === text).pop();
  return c ? { alpha: c.alpha, style: c.style, x: c[2], y: c[3] } : null;
}

test('the percentage sits inside the ring, in whole percent, in the ring colour', () => {
  setup();
  const {bx, by} = battRingCentre(10, 10);
  G.radar = true;

  G.batt = 82.3;
  draw();
  const high = labelOf('83%');
  assert.ok(high, 'no percentage; wanted 83%');
  assert.ok(Math.abs(high.x - bx) < 0.5 && Math.abs(high.y - by) < 0.5, 'the percentage is not centred in the ring');
  assert.equal(high.style, GREEN);

  G.batt = 20;
  draw();
  assert.equal(labelOf('20%').style, DANGER);

  G.batt = 0.2;
  draw();
  assert.ok(labelOf('1%'), 'a battery with any charge left did not read 1%');
  G.batt = 0;
  draw();
  assert.ok(labelOf('0%'), 'an empty battery did not read 0%');

  /* The label is part of the ring: it goes when the ring does. */
  G.batt = 60;
  draw();
  assert.ok(labelOf('60%'));
  G.radar = false;
  draw();
  assert.equal(labelOf('60%'), null, 'the percentage stayed after the ring faded');
  G.batt = 100;
});

test('there is no tag above the ring any more', () => {
  setup();
  const {bx, by} = battRingCentre(10, 10);
  G.radar = true;
  G.batt = 60;
  draw();
  const texts = calls.list.filter(c => c[0] === 'fillText' && c[1] === '60%');
  assert.equal(texts.length, 1);
  assert.ok(texts[0][3] > by - RING_RADIUS, 'the percentage is drawn above the ring');
  G.radar = false;
});

test('diegetic HUD draws nothing when the radar is off and there is no pulse', () => {
  setup();
  G.radar = false;
  G.battPulseT = 0;
  draw();
  const {bx, by} = battRingCentre(10, 10);
  assert.equal(cellArcs(bx, by).length, 0, 'ring cells drawn when radar off and no pulse');
});

test('the percentage is 10px bold with a dark 2px outline under the text', () => {
  setup();
  G.radar = true;
  G.batt = 60;
  draw();
  const fills = calls.list.filter(c => c[0] === 'fillText' && c[1] === '60%');
  const strokes = calls.list.filter(c => c[0] === 'strokeText' && c[1] === '60%');
  assert.ok(fills.length === 1 && strokes.length === 1, 'expected one outline and one fill');
  const f = fills[0], s = strokes[0];
  assert.ok(f.font.startsWith('bold 10px'), `drawn in "${f.font}", want bold 10px`);
  assert.ok(s.style === 'rgba(12,14,10,0.9)' && s.width >= 2, `outline is ${s.style} ${s.width}px`);
  assert.ok(calls.list.indexOf(s) < calls.list.indexOf(f), 'the outline is drawn over the fill');
  assert.ok(s[2] === f[2] && s[3] === f[3], 'the outline is not under the text');
  G.radar = false;
});

const STAMINA_SCALE = 0.75;
const STAMINA_WIDTH = 14*STAMINA_SCALE;
const STAMINA_HEIGHT = 42*STAMINA_SCALE;
const STAMINA_GLYPH = 18*STAMINA_SCALE;
const STAMINA_GAP = 6*STAMINA_SCALE;
const STAMINA_PADDING = 3*STAMINA_SCALE;
const STAMINA_CONTENT_HEIGHT = STAMINA_GLYPH + STAMINA_GAP + STAMINA_HEIGHT
  + Math.tan(Math.PI/10)*STAMINA_WIDTH/2;
function staminaBacking(){
  return calls.list.find(c => c[0] === 'fillRect' &&
    c[1] === (10 - SIDE)*TILE - STAMINA_GLYPH/2 - STAMINA_PADDING &&
    c[3] === STAMINA_GLYPH + 2*STAMINA_PADDING &&
    c[4] === STAMINA_CONTENT_HEIGHT + 2*STAMINA_PADDING);
}

test('stamina tread strip fills smoothly from the bottom and uses the running glyph', () => {
  setup();
  for (const [stamina, fraction] of [[0, 0], [1, 0.2], [2.5, 0.5], [4.5, 0.9]]){
    G.plumber.stamina = stamina;
    draw();
    assert.ok(staminaBacking(), 'stamina backing missing beside plumber');
    const clip = calls.list.findIndex(c => c[0] === 'clip');
    const rect = calls.list[clip - 1];
    assert.ok(clip > 0 && rect[0] === 'rect', 'stamina fill is not clipped');
    assert.equal(rect[1], -STAMINA_WIDTH/2);
    assert.equal(rect[3], STAMINA_WIDTH);
    assert.ok(Math.abs(rect[2] - STAMINA_HEIGHT*(1 - fraction)) < 1e-9);
    assert.ok(Math.abs(rect[4] - STAMINA_HEIGHT*fraction) < 1e-9);
    const fills = calls.list.filter(c => c[0] === 'fill');
    assert.ok(fills.some(c => c.style === UNLIT), 'unlit treads missing');
    const colour = fraction < 0.3 ? DANGER : fraction < 0.5 ? PAL.bright : GREEN;
    assert.ok(fills.some(c => c.style === colour), 'lit tread colour incorrect');
    const head = calls.list.findIndex(c => c[0] === 'arc' && c[1] === 16 && c[2] === 3.5 && c[3] === 2.5);
    assert.ok(head >= 0, 'runner head missing');
    assert.equal(calls.list[head + 1]?.[0], 'fill', 'runner head is not filled');
    assert.equal(calls.list[head + 1]?.style, colour, 'runner head colour does not match the treads');
    const body = calls.list.slice(0, head).filter(c => c[0] === 'stroke' && c.style === colour).pop();
    assert.ok(body && body.width === 3.5 && body.cap === 'round' && body.join === 'round',
      'runner limbs are not bold and rounded');
    assert.ok(!calls.list.some(c => c[0] === 'fillText' && /^\d+s$/.test(c[1])), 'old seconds label remains');
  }
});

test('stamina tread colours change only below the 50% and 30% thresholds', () => {
  setup();
  for (const [fraction, colour] of [
    [0.5001, GREEN], [0.5, GREEN], [0.4999, PAL.bright],
    [0.3001, PAL.bright], [0.3, PAL.bright], [0.2999, DANGER], [0, DANGER]
  ]){
    G.plumber.stamina = fraction*SPRINT_STAMINA;
    draw();
    const clip = calls.list.findIndex(c => c[0] === 'clip');
    const fill = calls.list.slice(clip + 1).find(c => c[0] === 'fill');
    assert.equal(fill?.style, colour, `${fraction*100}% should draw ${colour}`);
  }
});

test('stamina strip fades in when spent and fades out when full', () => {
  setup();
  draw();
  assert.equal(staminaBacking(), undefined);
  G.plumber.stamina = 4;
  calls.list.length = 0;
  render(clock);
  assert.equal(staminaBacking(), undefined, 'stamina strip appeared without elapsed time');
  calls.list.length = 0;
  clock += 100;
  render(clock);
  assert.ok(staminaBacking()?.alpha > 0, 'stamina strip did not fade in');
  draw();
  G.plumber.stamina = 5;
  calls.list.length = 0;
  clock += 100;
  render(clock);
  assert.ok(staminaBacking()?.alpha > 0, 'stamina strip vanished before fading out');
  draw();
  assert.equal(staminaBacking(), undefined, 'stamina strip remained after recovery');
});

test('stamina strip and radar battery appear on opposite sides of the plumber', () => {
  setup();
  G.plumber.stamina = 2.5;
  G.radar = true;
  G.batt = 60;
  draw();
  const {bx, by} = battRingCentre(10, 10);
  assert.equal(cellArcs(bx, by).length, CELLS);
  assert.ok(staminaBacking());
  G.radar = false;
});

test('stamina backing has equal padding around the glyph and slanted treads', () => {
  setup();
  G.plumber.stamina = 2.5;
  draw();
  const backing = staminaBacking();
  assert.ok(backing);
  const cx = (10 - SIDE)*TILE;
  const cy = (10 - BATT_Y)*TILE;
  const top = cy - STAMINA_CONTENT_HEIGHT/2;
  assert.equal(cx - STAMINA_GLYPH/2 - backing[1], STAMINA_PADDING);
  assert.equal(backing[1] + backing[3] - (cx + STAMINA_GLYPH/2), STAMINA_PADDING);
  assert.equal(top - backing[2], STAMINA_PADDING);
  assert.ok(Math.abs(backing[2] + backing[4] - (top + STAMINA_CONTENT_HEIGHT) - STAMINA_PADDING) < 1e-9);
});
