import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { initHaptics, PULSE_MS, DEAD_MS } from '../../src/ui/haptics.js';
import { setOption } from '../../src/settings/store.js';
import { emit } from '../../src/util/events.js';

await loadGame();

/* The harness never had a navigator.vibrate, which is the iOS case: boot
   already ran initHaptics() on a device that cannot vibrate. */
const setNav = n => Object.defineProperty(globalThis, 'navigator', { value: n, configurable: true, writable: true });
const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const restore = () => { if (real) Object.defineProperty(globalThis, 'navigator', real); else delete globalThis.navigator; };

function withVibrate(fn){
  const log = [];
  setNav({ vibrate: ms => { log.push(ms); return true; } });
  const off = initHaptics();
  try { fn(log); } finally { off(); restore(); setOption('haptics', true); }
}

test('[HAPTICS] a device with no vibrate does nothing and throws nothing', () => {
  for (const nav of [undefined, {}, { vibrate: 'yes' }]){
    setNav(nav);
    const off = initHaptics();
    assert.equal(typeof off, 'function');
    assert.doesNotThrow(() => { emit('sfx', 'sting'); emit('dead', { lives: 1, cause: 'x' }); });
    off();
  }
  restore();
});

test('[HAPTICS] danger sounds buzz 25 ms and death buzzes 120 ms', () => {
  assert.deepEqual(PULSE_MS, { sting: 25, rattle: 25, door: 25 });
  assert.equal(DEAD_MS, 120);
  withVibrate(log => {
    emit('sfx', 'sting'); emit('sfx', 'rattle', 0.5); emit('sfx', 'door', 1.8);
    assert.deepEqual(log, [25, 25, 25]);
    log.length = 0;
    emit('dead', { lives: 2, cause: 'caught' });
    assert.deepEqual(log, [120]);
  });
});

test('[HAPTICS] everything else is silent, including the splash and the HUD flash', () => {
  withVibrate(log => {
    for (const n of ['splash', 'step', 'wrench', 'seal', 'drip', 'drone', 'noiseFloor', 'leakBed']) emit('sfx', n, 1);
    emit('flash', 'IT TOUCHED YOU');
    assert.deepEqual(log, []);
  });
});

test('[HAPTICS] the setting turns it off and on live, and mute does not matter', () => {
  withVibrate(log => {
    setOption('haptics', false);
    emit('sfx', 'sting'); emit('dead', {});
    assert.deepEqual(log, []);
    setOption('haptics', true);
    setOption('muted', true);
    emit('sfx', 'sting');
    assert.deepEqual(log, [25], 'mute silenced the buzz');
    setOption('muted', false);
  });
});

test('[HAPTICS] a vibrate that throws does not break the game', () => {
  setNav({ vibrate(){ throw new Error('no user activation'); } });
  const off = initHaptics();
  assert.doesNotThrow(() => emit('sfx', 'door'));
  off(); restore();
});

test('[HAPTICS] unsubscribing stops the buzzing', () => {
  const log = [];
  setNav({ vibrate: ms => { log.push(ms); } });
  const off = initHaptics();
  off();
  emit('sfx', 'sting');
  assert.deepEqual(log, []);
  restore();
});
