import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { startRun, STATE } from '../../src/game/run.js';
import { SETTINGS, setOption } from '../../src/settings/store.js';
import { emit, on } from '../../src/util/events.js';
import { flashReset } from '../../src/ui/hud.js';
import { tickTutorials } from '../../src/ui/tutorials.js';

const historyKey = 'leakrooms.tutorials.v1';
global.__store.set(historyKey, JSON.stringify(['sprint', 'radar']));
const { G, els, store, press } = await loadGame();

function quietFloor(){
  G.wetArr.fill(0);
  G.maskArr.fill(0);
  G.leaks = [];
  G.lifeforms = [];
  G.radar = false;
}

test('settings reset persists and completed tutorials reappear only on their triggers', () => {
  els['btn-reset-tutorials'].click();
  assert.equal(els['tutorials-reset-status'].textContent, 'DONE.');
  assert.deepEqual(JSON.parse(store.get(historyKey)), []);
  assert.equal(STATE, 'splash');
  startRun();
  quietFloor();
  tickTutorials();
  assert.equal(els['tutorial-overlay'].hidden, true);
  emit('sprint', 0);
  tickTutorials();
  assert.equal(els['tutorial-title'].textContent, 'Running has a cost');
  press('Enter');
  assert.deepEqual(JSON.parse(store.get(historyKey)), ['sprint']);
});

test('reset while paused discards current and queued cards without restarting', () => {
  els['btn-reset-tutorials'].click();
  startRun();
  quietFloor();
  G.radar = true;
  emit('sprint', 0);
  tickTutorials();
  assert.equal(els['tutorial-title'].textContent, 'Running has a cost');
  G.radar = false;
  press('Escape');
  assert.equal(STATE, 'pause');
  els['btn-reset-tutorials'].click();
  assert.equal(STATE, 'pause');
  assert.deepEqual(JSON.parse(store.get(historyKey)), []);
  press('Escape');
  tickTutorials();
  assert.equal(els['tutorial-overlay'].hidden, true);
  emit('sprint', 0);
  tickTutorials();
  assert.equal(els['tutorial-title'].textContent, 'Running has a cost');
  press('Enter');
  assert.equal(els['tutorial-overlay'].hidden, true);
});

test('reset leaves disabled setting and flashnote history intact', () => {
  startRun();
  quietFloor();
  setOption('tutorials', false);
  flashReset();
  const cues = [];
  const unsubscribe = on('flash', cue => cues.push(cue.text));
  try {
    G.radar = true;
    emit('sprint', 0);
    tickTutorials();
    assert.deepEqual(cues, ['RUNNING IS LOUD AND DRAINS STAMINA. STOP RUNNING TO RECOVER']);
    els['btn-reset-tutorials'].click();
    assert.equal(SETTINGS.tutorials, false);
    assert.deepEqual(JSON.parse(store.get(historyKey)), []);
    flashReset();
    emit('sprint', 0);
    tickTutorials();
    assert.deepEqual(cues, [
      'RUNNING IS LOUD AND DRAINS STAMINA. STOP RUNNING TO RECOVER',
      'RADAR IS LOUD AND DRAINS BATTERY',
    ]);
    flashReset();
    emit('sprint', 0);
    tickTutorials();
    assert.equal(cues.length, 2);
    setOption('tutorials', true);
    G.radar = false;
    emit('sprint', 0);
    tickTutorials();
    assert.equal(els['tutorial-title'].textContent, 'Running has a cost');
    press('Enter');
  } finally {
    unsubscribe();
    setOption('tutorials', true);
    flashReset();
  }
});

test('storage failure reports an error and preserves history and pending card', () => {
  startRun();
  quietFloor();
  G.radar = true;
  tickTutorials();
  assert.equal(els['tutorial-title'].textContent, 'Radar has a cost');
  press('Escape');
  const before = store.get(historyKey);
  const original = global.localStorage;
  const warn = console.warn;
  const warnings = [];
  global.localStorage = { ...original, setItem(){ throw new Error('storage unavailable'); } };
  console.warn = (...args) => warnings.push(args);
  try {
    els['btn-reset-tutorials'].click();
    assert.match(els['tutorials-reset-status'].textContent, /COULD NOT RESET/);
    assert.equal(warnings.length, 1);
    assert.equal(store.get(historyKey), before);
  } finally {
    global.localStorage = original;
    console.warn = warn;
  }
  press('Escape');
  assert.equal(els['tutorial-overlay'].hidden, false);
  assert.equal(els['tutorial-title'].textContent, 'Radar has a cost');
  press('Enter');
  assert.deepEqual(JSON.parse(store.get(historyKey)), ['sprint', 'radar']);
});
