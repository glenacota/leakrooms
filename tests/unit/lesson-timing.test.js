import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { startRun, transition, STATE } from '../../src/game/run.js';
import { MAP_W } from '../../src/config/constants.js';
import { cam } from '../../src/render/render.js';
import { emit } from '../../src/util/events.js';
import { tickLessons } from '../../src/ui/lessons.js';

const { G, els, store, press } = await loadGame();
const historyKey = 'leakrooms.lessons.v1';

function quietFloor(){
  G.wetArr.fill(0);
  G.maskArr.fill(0);
  G.leaks = [];
  G.lifeforms = [];
  G.radar = false;
  cam.x = G.plumber.x;
  cam.y = G.plumber.y;
  cam.jx = cam.jy = 0;
}

test('active countdown freezes on pause and interaction, then advances the queue', () => {
  startRun();
  quietFloor();
  G.radar = true;
  emit('sprint', 0);
  tickLessons();
  assert.equal(STATE, 'play');
  assert.equal(els['lesson-countdown'].textContent, '10s');
  assert.equal(els['lesson-title'].textContent, 'Running has a cost');

  emit('sprint', 0);
  tickLessons(2);
  assert.equal(els['lesson-countdown'].textContent, '8s');
  press('Escape');
  assert.equal(STATE, 'pause');
  assert.equal(els['lesson-overlay'].hidden, true);
  tickLessons(100);
  press('Escape');
  assert.equal(STATE, 'play');
  assert.equal(els['lesson-overlay'].hidden, false);
  assert.equal(els['lesson-countdown'].textContent, '8s');

  els['lesson-overlay']._fire('pointerenter', { pointerType:'mouse' });
  tickLessons(20);
  assert.equal(els['lesson-countdown'].textContent, '8s');
  els['lesson-overlay']._fire('pointerleave', { pointerType:'mouse' });
  els['lesson-overlay']._fire('focusin', {});
  tickLessons(20);
  assert.equal(els['lesson-countdown'].textContent, '8s');
  els['lesson-overlay']._fire('focusout', { relatedTarget:null });

  tickLessons(7.99);
  assert.equal(els['lesson-countdown'].textContent, '1s');
  assert.equal(store.has(historyKey), false);
  tickLessons(0.01);
  assert.deepEqual(JSON.parse(store.get(historyKey)), ['sprint']);
  assert.equal(els['lesson-title'].textContent, 'Radar has a cost');
  assert.equal(els['lesson-countdown'].textContent, '10s');
  press('Enter', { repeat:true });
  assert.equal(els['lesson-title'].textContent, 'Radar has a cost');
  els['lesson-overlay']._fire('pointerenter', { pointerType:'touch' });
  tickLessons(1);
  assert.equal(els['lesson-countdown'].textContent, '9s');
  tickLessons(9);
  assert.deepEqual(JSON.parse(store.get(historyKey)), ['sprint', 'radar']);
  assert.equal(els['lesson-overlay'].hidden, true);
  assert.equal(STATE, 'play');
});

test('death discards visible and queued cards without completing them', () => {
  startRun();
  quietFloor();
  const x = Math.floor(G.plumber.x), y = Math.floor(G.plumber.y);
  const i = y*MAP_W + x;
  G.wetArr[i] = 1;
  G.maskArr[i] = G.lightArr[i] = 1;
  G.leaks = [{ x, y, fixed:false }];
  tickLessons();
  assert.equal(els['lesson-title'].textContent, 'How to find a leak');
  assert.equal(els['lesson-overlay'].hidden, false);
  const before = store.get(historyKey);
  transition('dead');
  assert.equal(els['lesson-overlay'].hidden, true);
  assert.equal(store.get(historyKey), before);

  startRun();
  quietFloor();
  G.wetArr[i] = G.maskArr[i] = G.lightArr[i] = 1;
  cam.x = x + 0.5;
  cam.y = y + 0.5;
  tickLessons();
  press('Enter');
  assert.equal(els['lesson-overlay'].hidden, true, 'the previous repair card is not queued');
  assert.deepEqual(JSON.parse(store.get(historyKey)), ['sprint', 'radar', 'water']);
});

test('rebuilding a floor discards the current card without completing it', () => {
  startRun();
  quietFloor();
  const x = Math.floor(G.plumber.x), y = Math.floor(G.plumber.y);
  const i = y*MAP_W + x;
  G.leaks = [{ x, y, fixed:false }];
  G.maskArr[i] = 1;
  tickLessons();
  assert.equal(els['lesson-title'].textContent, 'How to seal a leak');
  const before = store.get(historyKey);
  emit('floorBuilt');
  assert.equal(els['lesson-overlay'].hidden, true);
  assert.equal(store.get(historyKey), before);
});
