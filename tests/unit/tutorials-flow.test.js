import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { startRun, STATE, transition } from '../../src/game/run.js';
import { setOption } from '../../src/settings/store.js';
import { emit, on } from '../../src/util/events.js';
import { flashReset } from '../../src/ui/hud.js';
import { dismissTutorial, tickTutorials } from '../../src/ui/tutorials.js';

const { G, els, store, press } = await loadGame();
const historyKey = 'leakrooms.tutorials.v1';

function freshRun(){
  setOption('tutorials', true);
  emit('tutorials:reset');
  flashReset();
  startRun();
  G.floor = 1;
  G.wetArr.fill(0);
  G.maskArr.fill(0);
  G.leaks = [];
  G.lifeforms = [];
  G.radar = false;
}

test('a run transition drops a pending sprint without completing it', () => {
  startRun();
  emit('sprint', 0);
  transition('dead');
  tickTutorials();
  assert.equal(STATE, 'dead');
  assert.equal(store.has(historyKey), false);
});

test('disabling tutorials in settings clears pending cards without completing them', () => {
  startRun();
  G.wetArr.fill(0);
  G.maskArr.fill(0);
  G.leaks = [];
  G.lifeforms = [];
  G.radar = true;
  emit('sprint', 0);
  tickTutorials();
  assert.equal(els['tutorial-title'].textContent, 'Save your legs');
  press('Escape');
  assert.equal(STATE, 'pause');
  setOption('tutorials', false);
  assert.equal(els['tutorial-overlay'].hidden, true);
  assert.equal(store.has(historyKey), false);
  press('Escape');
  assert.equal(STATE, 'play');

  flashReset();
  const cues = [];
  const unsubscribe = on('flash', cue => cues.push(cue.text));
  tickTutorials();
  assert.deepEqual(cues, ['RADAR IS NOISE.LOUD AND DRAINS BATTERY']);
  assert.equal(store.has(historyKey), false);
  unsubscribe();

  setOption('tutorials', true);
  tickTutorials();
  assert.equal(STATE, 'play');
  assert.equal(els['tutorial-title'].textContent, 'Use the radar sparingly');
  press('Enter');
  assert.deepEqual(JSON.parse(store.get(historyKey)), ['radar']);
});

test('fallback messages wait for the previous flash instead of replacing it', () => {
  startRun();
  G.wetArr.fill(0);
  G.maskArr.fill(0);
  G.leaks = [];
  G.lifeforms = [];
  G.radar = true;
  setOption('tutorials', false);
  flashReset();
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const timers = new Map();
  let next = 0;
  global.setTimeout = fn => { const id = ++next; timers.set(id, fn); return id; };
  global.clearTimeout = id => timers.delete(id);
  const cues = [];
  const unsubscribe = on('flash', cue => cues.push(cue.text));
  try {
    emit('sprint', 0);
    tickTutorials();
    tickTutorials();
    assert.deepEqual(cues, ['RUNNING IS NOISE.LOUD AND DRAINS STAMINA. STOP RUNNING TO RECOVER']);
    const [id, done] = timers.entries().next().value;
    timers.delete(id);
    done();
    tickTutorials();
    assert.deepEqual(cues, [
      'RUNNING IS NOISE.LOUD AND DRAINS STAMINA. STOP RUNNING TO RECOVER',
      'RADAR IS NOISE.LOUD AND DRAINS BATTERY',
    ]);
  } finally {
    unsubscribe();
    flashReset();
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    setOption('tutorials', true);
  }
});

test('air supply tutorial waits for one active minute and stays completed', () => {
  freshRun();
  G.time = 59.99;
  tickTutorials();
  assert.equal(els['tutorial-overlay'].hidden, true);

  press('Escape');
  G.time = 60;
  tickTutorials();
  assert.equal(els['tutorial-overlay'].hidden, true);
  press('Escape');
  tickTutorials();
  assert.equal(els['tutorial-title'].textContent, 'Limited air supply');
  dismissTutorial();
  assert.deepEqual(JSON.parse(store.get(historyKey)), ['airsupply']);

  startRun();
  G.floor = 1;
  G.time = 60;
  tickTutorials();
  assert.equal(els['tutorial-overlay'].hidden, true);
});

test('air supply tutorial queues behind existing cards', () => {
  freshRun();
  G.time = 60;
  emit('sprint');
  tickTutorials();
  assert.equal(els['tutorial-title'].textContent, 'Save your legs');
  dismissTutorial();
  assert.equal(els['tutorial-title'].textContent, 'Limited air supply');
});

test('disabled tutorials flash the air supply guide once per run', () => {
  freshRun();
  setOption('tutorials', false);
  flashReset();
  G.time = 60;
  const cues = [];
  const unsubscribe = on('flash', cue => cues.push(cue.text));
  try {
    tickTutorials();
    tickTutorials();
    assert.deepEqual(cues, ['USED ONE MINUTE OF AIR SUPPLY. MONITOR THE TIMER']);
  } finally {
    unsubscribe();
    setOption('tutorials', true);
    flashReset();
  }
});
