import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { startRun, STATE, transition } from '../../src/game/run.js';
import { setOption } from '../../src/settings/store.js';
import { emit, on } from '../../src/util/events.js';
import { flashReset } from '../../src/ui/hud.js';
import { tickLessons } from '../../src/ui/lessons.js';

const { G, els, store, press } = await loadGame();
const historyKey = 'leakrooms.lessons.v1';

test('a run transition drops a pending sprint without completing it', () => {
  startRun();
  emit('sprint', 0);
  transition('dead');
  tickLessons();
  assert.equal(STATE, 'dead');
  assert.equal(store.has(historyKey), false);
});

test('opting out clears queued dialogs without completing them', () => {
  startRun();
  G.wetArr.fill(0);
  G.maskArr.fill(0);
  G.leaks = [];
  G.lifeforms = [];
  G.radar = true;
  emit('sprint', 0);
  tickLessons();
  assert.equal(els['lesson-title'].textContent, 'Running has a cost');
  els['lesson-disable'].checked = true;
  press('Escape');
  assert.equal(STATE, 'play');
  assert.deepEqual(JSON.parse(store.get(historyKey)), ['sprint']);

  flashReset();
  const cues = [];
  const unsubscribe = on('flash', cue => cues.push(cue.text));
  tickLessons();
  assert.deepEqual(cues, ['RADAR IS LOUD AND DRAINS BATTERY']);
  assert.deepEqual(JSON.parse(store.get(historyKey)), ['sprint']);
  unsubscribe();

  setOption('lessons', true);
  tickLessons();
  assert.equal(STATE, 'lesson');
  assert.equal(els['lesson-title'].textContent, 'Radar has a cost');
  press('Escape');
  assert.deepEqual(JSON.parse(store.get(historyKey)), ['sprint', 'radar']);
});

test('fallback messages wait for the previous flash instead of replacing it', () => {
  startRun();
  G.wetArr.fill(0);
  G.maskArr.fill(0);
  G.leaks = [];
  G.lifeforms = [];
  G.radar = true;
  setOption('lessons', false);
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
    tickLessons();
    tickLessons();
    assert.deepEqual(cues, ['RUNNING IS LOUD AND DRAINS STAMINA. STOP RUNNING TO RECOVER']);
    const [id, done] = timers.entries().next().value;
    timers.delete(id);
    done();
    tickLessons();
    assert.deepEqual(cues, [
      'RUNNING IS LOUD AND DRAINS STAMINA. STOP RUNNING TO RECOVER',
      'RADAR IS LOUD AND DRAINS BATTERY',
    ]);
  } finally {
    unsubscribe();
    flashReset();
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    setOption('lessons', true);
  }
});
