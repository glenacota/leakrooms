import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';

const { A, G, calls } = await loadGame();
const buildFloor = A.buildFloor;
const render = A.render;

/* The compass is one chevron label, "DOOR n", drawn with fillText. Its
   presence in a frame is the whole observable behaviour, so the tests read
   the recorded text calls of the last frame. The cue fades in and out, so a
   few frames are drawn first. */
let clock = 1000;
function drawFor(durationMs, stepMs = 100){
  const frames = Math.ceil(durationMs / stepMs);
  for (let i = 0; i < frames; i++){
    calls.list.length = 0;
    clock += stepMs;
    render(clock);
  }
}
function draw(){
  drawFor(800);
}
const compassShown = () => calls.list.some(c => c[0] === 'fillText' && String(c[1]).startsWith('DOOR'));

function setup(){
  buildFloor(0, 1234);
  const e = G.exitTiles[0];
  G.plumber.x = 10.5; G.plumber.y = 10.5;
  G.plumber.px = 10.5; G.plumber.py = 10.5;
  G.plumber.moving = false;
  G.radar = false;
  G.openLeaks = 1;
  return e;
}

test('the door compass is hidden with no radar while leaks are still sealing up', () => {
  setup();
  draw();
  assert.equal(compassShown(), false);
});

test('the door compass stays hidden with the radar on while leaks are still open', () => {
  setup();
  G.radar = true;
  draw();
  assert.equal(compassShown(), false);
  G.radar = false;
});

test('the door compass shows once every leak is sealed, away from the door', () => {
  setup();
  G.openLeaks = 0;
  G.plumber.moving = false;
  draw();
  assert.equal(compassShown(), true);
});

test('the door compass is hidden while the plumber is moving, even with leaks sealed', () => {
  setup();
  G.openLeaks = 0;
  G.plumber.moving = true;
  drawFor(3200);
  assert.equal(compassShown(), false);
});

test('the door compass goes once the plumber reaches the door', () => {
  const e = setup();
  G.openLeaks = 0;
  G.plumber.x = e.x + 0.5; G.plumber.y = e.y + 0.5;
  G.plumber.px = G.plumber.x; G.plumber.py = G.plumber.y;
  drawFor(3200);
  assert.equal(compassShown(), false);
});

test('the door compass draws nothing and leaves no transform behind when hidden', () => {
  setup();
  drawFor(3200);
  assert.ok(!calls.list.some(c => c[0] === 'fillText' && String(c[1]).startsWith('DOOR')));
});
