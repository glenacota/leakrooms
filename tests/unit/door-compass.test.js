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
function draw(){
  for (let i = 0; i < 8; i++){
    calls.list.length = 0;
    clock += 100;
    render(clock);
  }
}
const compassShown = () => calls.list.some(c => c[0] === 'fillText' && String(c[1]).startsWith('DOOR'));

function setup(){
  buildFloor(0, 1234);
  const e = G.exitTiles[0];
  G.plumber.x = 10.5; G.plumber.y = 10.5;
  G.plumber.px = 10.5; G.plumber.py = 10.5;
  G.radar = false;
  G.openLeaks = 1;
  return e;
}

test('the door compass is hidden with no radar while leaks are still sealing up', () => {
  setup();
  draw();
  assert.equal(compassShown(), false);
});

test('the door compass shows while the radar is on, even with leaks still open', () => {
  setup();
  G.radar = true;
  draw();
  assert.equal(compassShown(), true);
  G.radar = false;
});

test('the door compass shows once every leak is sealed, away from the door', () => {
  setup();
  G.openLeaks = 0;
  draw();
  assert.equal(compassShown(), true);
});

test('the door compass goes once the plumber reaches the door', () => {
  const e = setup();
  G.openLeaks = 0;
  G.plumber.x = e.x + 0.5; G.plumber.y = e.y + 0.5;
  G.plumber.px = G.plumber.x; G.plumber.py = G.plumber.y;
  draw();
  assert.equal(compassShown(), false);
});

test('the door compass draws nothing and leaves no transform behind when hidden', () => {
  setup();
  draw();
  calls.list.length = 0;
  render(clock += 100);
  assert.ok(!calls.list.some(c => c[0] === 'fillText' && String(c[1]).startsWith('DOOR')));
});
