import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { MAP_W, SPRINT_STAMINA } from '../../src/config/constants.js';
import { startRun, transition, STATE } from '../../src/game/run.js';
import { cam } from '../../src/render/render.js';
import { resetSettings, setOption } from '../../src/settings/store.js';
import { clearInput, keys } from '../../src/sim/keys.js';
import { tickTutorials, dismissTutorial } from '../../src/ui/tutorials.js';
import { flashReset } from '../../src/ui/hud.js';
import { emit, on } from '../../src/util/events.js';

const { A, G, els, store, press } = await loadGame();
const historyKey = 'leakrooms.tutorials.v1';

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

test('tutorials allow input, queue and persist only after dismissal', () => {
  startRun();
  quietFloor();
  G.radar = true;
  keys.d = true;
  emit('sprint', 0);
  tickTutorials();
  assert.equal(STATE, 'play');
  assert.equal(keys.d, true, 'opening a tutorial does not release movement');
  assert.equal(els['tutorial-overlay'].hidden, false);
  assert.equal(els['tutorial-title'].textContent, 'Running has a cost');
  assert.equal(store.has(historyKey), false);

  dismissTutorial();
  assert.equal(STATE, 'play', 'queued radar leaves the simulation running');
  assert.equal(els['tutorial-title'].textContent, 'Radar has a cost');
  assert.deepEqual(JSON.parse(store.get(historyKey)), ['sprint']);
  press('Enter');
  assert.equal(STATE, 'play');
  assert.deepEqual(JSON.parse(store.get(historyKey)), ['sprint', 'radar']);
  assert.equal(els['tutorial-overlay'].hidden, true);
  assert.equal(keys.d, true, 'movement remains held after dismissal');
  clearInput();

  transition('splash');
  startRun();
  quietFloor();
  G.radar = true;
  emit('sprint', 0);
  tickTutorials();
  assert.equal(STATE, 'play', 'completed tutorials do not repeat on a new run');
  resetSettings();
  assert.deepEqual(JSON.parse(store.get(historyKey)), ['sprint', 'radar']);
});

test('hidden lifeforms do not reveal themselves through a tutorial', () => {
  startRun();
  quietFloor();
  const x = Math.floor(cam.x), y = Math.floor(cam.y), i = y*MAP_W+x;
  G.lifeforms = [{ x:x+0.5, y:y+0.5, state:'DORMANT', rise:0 }];
  G.maskArr[i] = 1;
  tickTutorials();
  assert.equal(STATE, 'play', 'darkness hides the lifeform');
  G.lightArr[i] = 1;
  const previousX = cam.x;
  cam.x += 50;
  tickTutorials();
  assert.equal(STATE, 'play', 'a lit lifeform outside the viewport is not revealed');
  cam.x = previousX;
  tickTutorials();
  assert.equal(STATE, 'play');
  assert.equal(els['tutorial-overlay'].hidden, false);
  assert.equal(els['tutorial-title'].textContent, 'Watch for lifeforms');
  dismissTutorial();
});

test('timed water and an open leak queue in order', () => {
  startRun();
  quietFloor();
  const x = Math.floor(cam.x), y = Math.floor(cam.y), i = y*MAP_W+x;
  G.maskArr[i] = G.lightArr[i] = 1;
  G.wetArr[i] = 1;
  G.leaks = [{ x, y, fixed:false }];
  G.time = 3;
  tickTutorials();
  assert.equal(els['tutorial-title'].textContent, 'How to find a leak');
  dismissTutorial();
  assert.equal(els['tutorial-title'].textContent, 'How to seal a leak');
  dismissTutorial();
  assert.equal(STATE, 'play');
});

test('disabled dialogs emit fallback guidance without completing tutorials', () => {
  startRun();
  quietFloor();
  setOption('tutorials', false);
  flashReset();
  const cues = [];
  const unsubscribe = on('flash', cue => cues.push(cue.text));
  try {
    emit('run:start');
    emit('sprint', 0);
    tickTutorials();
    assert.ok(cues.includes('RUNNING IS LOUD AND DRAINS STAMINA. STOP RUNNING TO RECOVER'));
    assert.equal(STATE, 'play');
    assert.deepEqual(JSON.parse(store.get(historyKey)), ['sprint', 'radar', 'lifeform', 'water', 'repair']);
    emit('sprint', 0);
    tickTutorials();
    assert.equal(cues.length, 1, 'fallback does not repeat within the run');
  } finally {
    unsubscribe();
    setOption('tutorials', true);
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
