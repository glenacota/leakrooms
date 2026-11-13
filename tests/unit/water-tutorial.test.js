import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { calls, fakeCanvas } from '../helpers/stubs.js';
import { MAP_W, TILE } from '../../src/config/constants.js';
import { retryFloor, startRun, transition } from '../../src/game/run.js';
import { paintTutorial } from '../../src/render/tutorial-art.js';
import { surfaces } from '../../src/render/floor-surfaces.js';
import { setOption } from '../../src/settings/store.js';
import { emit, on } from '../../src/util/events.js';
import { flashReset } from '../../src/ui/hud.js';
import { dismissTutorial, tickTutorials } from '../../src/ui/tutorials.js';

const { A, G, els, store, press } = await loadGame();
const historyKey = 'leakrooms.tutorials.v1';

function quietFloor(){
  G.wetArr.fill(0);
  G.maskArr.fill(0);
  G.leaks = [];
  G.lifeforms = [];
  G.radar = false;
}

function freshRun(){
  setOption('tutorials', true);
  emit('tutorials:reset');
  flashReset();
  startRun();
  quietFloor();
}

test('water waits for three active seconds on floor one, including fixed-step rounding', () => {
  freshRun();
  for (let i=0; i<179; i++){
    A.update(1/60);
    tickTutorials(1/60);
  }
  assert.equal(els['tutorial-overlay'].hidden, true);
  press('Escape');
  tickTutorials(30);
  assert.equal(els['tutorial-overlay'].hidden, true);
  press('Escape');
  A.update(1/60);
  tickTutorials(1/60);
  assert.equal(els['tutorial-title'].textContent, 'How to find a leak');
  assert.equal(els['tutorial-overlay'].hidden, false);
  dismissTutorial();
  assert.deepEqual(JSON.parse(store.get(historyKey)), ['water']);
  startRun();
  quietFloor();
  G.time = 4;
  tickTutorials();
  assert.equal(els['tutorial-overlay'].hidden, true);
});

test('water queues behind a card and pending cards are discarded on floor rebuild', () => {
  freshRun();
  emit('sprint');
  tickTutorials();
  assert.equal(els['tutorial-title'].textContent, 'Running has a cost');
  G.time = 3;
  tickTutorials();
  assert.equal(els['tutorial-title'].textContent, 'Running has a cost');
  dismissTutorial();
  assert.equal(els['tutorial-title'].textContent, 'How to find a leak');
  transition('dead');
  retryFloor();
  quietFloor();
  assert.equal(G.time, 0);
  tickTutorials();
  assert.equal(els['tutorial-overlay'].hidden, true);
  G.time = 3;
  tickTutorials();
  assert.equal(els['tutorial-title'].textContent, 'How to find a leak');
  emit('floorBuilt');
  G.floor = 1;
  G.time = 10;
  tickTutorials();
  assert.equal(els['tutorial-overlay'].hidden, true);
  assert.deepEqual(JSON.parse(store.get(historyKey)), ['sprint']);
});

test('disabled cards use the timed guide and enabling or resetting uses elapsed floor time', () => {
  freshRun();
  setOption('tutorials', false);
  const cues = [];
  const unsubscribe = on('flash', cue => cues.push(cue.text));
  try {
    G.time = 2.99;
    tickTutorials();
    assert.deepEqual(cues, []);
    G.time = 3;
    tickTutorials();
    assert.deepEqual(cues, ['FOLLOW THE WET FLOOR TO FIND A LEAK']);
    tickTutorials();
    assert.equal(cues.length, 1);
    setOption('tutorials', true);
    tickTutorials();
    assert.equal(els['tutorial-title'].textContent, 'How to find a leak');
    dismissTutorial();
    emit('tutorials:reset');
    tickTutorials();
    assert.equal(els['tutorial-title'].textContent, 'How to find a leak');
  } finally {
    unsubscribe();
    setOption('tutorials', true);
    flashReset();
  }
});

test('water illustration uses the deepest tile anywhere and omits images on a dry floor', () => {
  freshRun();
  const canvas = fakeCanvas();
  canvas.width = 300;
  canvas.height = 180;
  G.wetArr[10*MAP_W+10] = 0.3;
  G.wetArr[20*MAP_W+25] = 1;
  calls.list.length = 0;
  paintTutorial(canvas, 'water');
  const images = calls.list.filter(call => call[0] === 'drawImage' && (call[1] === surfaces.tiles || call[1] === surfaces.wet));
  assert.equal(images.length, 2);
  assert.deepEqual(images[0].slice(2, 6), [23*TILE, 19*TILE, 5*TILE, 3*TILE]);
  assert.deepEqual(images[1].slice(2, 6), [23, 19, 5, 3]);
  G.wetArr.fill(0);
  calls.list.length = 0;
  paintTutorial(canvas, 'water');
  assert.equal(calls.list.filter(call => call[0] === 'drawImage').length, 0);
});
