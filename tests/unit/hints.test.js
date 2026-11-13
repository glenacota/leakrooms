import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { MAP_W, SPRINT_STAMINA } from '../../src/config/constants.js';
import { startRun, transition, STATE } from '../../src/game/run.js';
import { cam } from '../../src/render/render.js';
import { resetSettings, setOption } from '../../src/settings/store.js';
import { clearInput, keys } from '../../src/sim/keys.js';
import { tickLessons, dismissLesson } from '../../src/ui/lessons.js';
import { flashReset } from '../../src/ui/hud.js';
import { emit, on } from '../../src/util/events.js';

const { A, G, els, store, press } = await loadGame();
const historyKey = 'leakrooms.lessons.v1';

function quietFloor(){
  G.wetArr.fill(0);
  G.maskArr.fill(0);
  G.lightArr.fill(0);
  G.leaks = [];
  G.lifeforms = [];
  G.radar = false;
  cam.x = G.plumber.x;
  cam.y = G.plumber.y;
  cam.jx = cam.jy = 0;
}

test('lessons pause, queue and persist only after dismissal', () => {
  startRun();
  quietFloor();
  G.radar = true;
  keys.d = true;
  emit('sprint', 0);
  tickLessons();
  assert.equal(STATE, 'lesson');
  assert.equal(els['lesson-title'].textContent, 'Running has a cost');
  assert.equal(store.has(historyKey), false);

  dismissLesson();
  assert.equal(STATE, 'lesson', 'queued radar does not resume the simulation');
  assert.equal(els['lesson-title'].textContent, 'Radar has a cost');
  assert.deepEqual(JSON.parse(store.get(historyKey)), ['sprint']);
  press('Escape');
  assert.equal(STATE, 'play');
  assert.deepEqual(JSON.parse(store.get(historyKey)), ['sprint', 'radar']);
  assert.equal(els['lesson-overlay'].hidden, true);
  press('d', { repeat:true });
  assert.notEqual(keys.d, true, 'a held movement key stays released after dismissal');
  window._h.keyup({ key:'d', code:'KeyD' });
  press('d');
  assert.equal(keys.d, true, 'movement works again after release');
  clearInput();

  transition('splash');
  startRun();
  quietFloor();
  G.radar = true;
  emit('sprint', 0);
  tickLessons();
  assert.equal(STATE, 'play', 'completed lessons do not repeat on a new run');
  resetSettings();
  assert.deepEqual(JSON.parse(store.get(historyKey)), ['sprint', 'radar']);
});

test('hidden lifeforms do not reveal themselves through a lesson', () => {
  startRun();
  quietFloor();
  const x = Math.floor(cam.x), y = Math.floor(cam.y), i = y*MAP_W+x;
  G.lifeforms = [{ x:x+0.5, y:y+0.5, state:'DORMANT', rise:0 }];
  G.maskArr[i] = 1;
  tickLessons();
  assert.equal(STATE, 'play', 'darkness hides the lifeform');
  G.lightArr[i] = 1;
  const previousX = cam.x;
  cam.x += 50;
  tickLessons();
  assert.equal(STATE, 'play', 'a lit lifeform outside the viewport is not revealed');
  cam.x = previousX;
  tickLessons();
  assert.equal(STATE, 'lesson');
  assert.equal(els['lesson-title'].textContent, 'Watch for lifeforms');
  dismissLesson();
});

test('visible water and an open leak queue in order', () => {
  startRun();
  quietFloor();
  const x = Math.floor(cam.x), y = Math.floor(cam.y), i = y*MAP_W+x;
  G.maskArr[i] = G.lightArr[i] = 1;
  G.wetArr[i] = 1;
  G.leaks = [{ x, y, fixed:false }];
  tickLessons();
  assert.equal(els['lesson-title'].textContent, 'How to find a leak');
  dismissLesson();
  assert.equal(els['lesson-title'].textContent, 'How to seal a leak');
  dismissLesson();
  assert.equal(STATE, 'play');
});

test('disabled dialogs emit fallback guidance without completing lessons', () => {
  startRun();
  quietFloor();
  setOption('lessons', false);
  flashReset();
  const cues = [];
  const unsubscribe = on('flash', cue => cues.push(cue.text));
  try {
    emit('run:start');
    emit('sprint', 0);
    tickLessons();
    assert.ok(cues.includes('RUNNING IS LOUD AND DRAINS STAMINA. STOP RUNNING TO RECOVER'));
    assert.equal(STATE, 'play');
    assert.deepEqual(JSON.parse(store.get(historyKey)), ['sprint', 'radar', 'lifeform', 'water', 'repair']);
    emit('sprint', 0);
    tickLessons();
    assert.equal(cues.length, 1, 'fallback does not repeat within the run');
  } finally {
    unsubscribe();
    setOption('lessons', true);
  }
});

test('the sprint event is emitted only while stamina is consumed', () => {
  startRun();
  quietFloor();
  G.wantVision = false;
  let count = 0;
  const unsubscribe = on('sprint', () => count++);
  try {
    clearInput();
    keys.shift = true;
    A.update(1/60);
    assert.equal(count, 0);
    keys.d = true;
    G.plumber.stamina = 0;
    A.update(1/60);
    assert.equal(count, 0);
    G.plumber.stamina = SPRINT_STAMINA;
    A.update(1/60);
    assert.equal(count, 1);
  } finally {
    unsubscribe();
    clearInput();
  }
});
