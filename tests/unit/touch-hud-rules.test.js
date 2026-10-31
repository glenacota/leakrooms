import test from 'node:test';
import assert from 'node:assert/strict';
import { hudVisibility, buildHudSnap, HUD_RULES } from '../../src/ui/touch-hud-rules.js';
import { LOUD } from '../../src/config/constants.js';

const { HOLD_MS, FLOOR_START_MS } = HUD_RULES;

/* A quiet moment, well into the floor: no trigger is true. */
const NOW = 100000;
const quiet = (over = {}) => ({
  noise: 0.1, loud: false, battery: 100, batteryLow: false, radarOn: false,
  clockSeconds: 120, lives: 3, repairProgress: 0, floorStartedMs: NOW - 60000,
  ...over,
});
const none = { lives: 3, lastTriggerMs: -Infinity };

test('[HUD-RULES] a quiet moment is hidden', () => {
  assert.equal(hudVisibility(quiet(), none, NOW, 'auto').visible, false);
  assert.equal(hudVisibility(quiet(), null, NOW).visible, false);
});

/* One row per trigger: the snap that fires it, and the one just short of it. */
const TRIGGERS = [
  ['noise at half LOUD',   { noise: 0.5*LOUD },          { noise: 0.5*LOUD - 0.01 }],
  ['loud',                 { loud: true, noise: LOUD },  { loud: false }],
  ['battery low',          { batteryLow: true },         { batteryLow: false }],
  ['radar on',             { radarOn: true },            { radarOn: false }],
  ['clock at 30 s',        { clockSeconds: 30 },         { clockSeconds: 30.5 }],
  ['repair progress',      { repairProgress: 0.01 },     { repairProgress: 0 }],
  ['a floor just started', { floorStartedMs: NOW - (FLOOR_START_MS - 1) },
                           { floorStartedMs: NOW - FLOOR_START_MS }],
];
for (const [name, on, off] of TRIGGERS){
  test(`[HUD-RULES] trigger: ${name}`, () => {
    assert.equal(hudVisibility(quiet(on), none, NOW, 'auto').visible, true, 'did not show');
    assert.equal(hudVisibility(quiet(off), none, NOW, 'auto').visible, false, 'showed just short of the trigger');
  });
}

test('[HUD-RULES] a life lost shows the panel, compared with prev', () => {
  const r = hudVisibility(quiet({ lives: 2 }), { lives: 3, lastTriggerMs: -Infinity }, NOW, 'auto');
  assert.equal(r.visible, true);
  assert.equal(hudVisibility(quiet({ lives: 3 }), { lives: 3, lastTriggerMs: -Infinity }, NOW, 'auto').visible, false);
  // More lives than before (a new run) is not a loss.
  assert.equal(hudVisibility(quiet({ lives: 3 }), { lives: 2, lastTriggerMs: -Infinity }, NOW, 'auto').visible, false);
  // No prev: nothing to compare with.
  assert.equal(hudVisibility(quiet({ lives: 1 }), null, NOW, 'auto').visible, false);
  // A lost life is held longer than the default.
  const later = NOW + HOLD_MS + 500;
  assert.equal(hudVisibility(quiet({ lives: 2 }), { lives: 2, lastTriggerMs: r.lastTriggerMs }, later, 'auto').visible, true);
  assert.equal(hudVisibility(quiet({ lives: 2 }), { lives: 2, lastTriggerMs: r.lastTriggerMs }, NOW + HUD_RULES.LIFE_LOST_HOLD_MS + 1, 'auto').visible, false);
});

test('[HUD-RULES] stays visible for HOLD_MS after the last trigger, then hides', () => {
  let r = hudVisibility(quiet({ noise: 0.4 }), none, NOW, 'auto');
  assert.equal(r.visible, true);
  let prev = { lives: 3, lastTriggerMs: r.lastTriggerMs };
  for (const dt of [1, HOLD_MS - 1]){
    r = hudVisibility(quiet(), prev, NOW + dt, 'auto');
    assert.equal(r.visible, true, `hidden ${dt} ms after the trigger`);
    prev = { lives: 3, lastTriggerMs: r.lastTriggerMs };
  }
  assert.equal(hudVisibility(quiet(), prev, NOW + HOLD_MS, 'auto').visible, false);
});

test('[HUD-RULES] a new trigger inside the hold window extends it', () => {
  const a = hudVisibility(quiet({ noise: 0.4 }), none, NOW, 'auto');
  const t2 = NOW + 2000;
  const b = hudVisibility(quiet({ radarOn: true }), { lives: 3, lastTriggerMs: a.lastTriggerMs }, t2, 'auto');
  assert.equal(b.lastTriggerMs, t2);
  const prev = { lives: 3, lastTriggerMs: b.lastTriggerMs };
  // Past the first window, inside the second.
  assert.equal(hudVisibility(quiet(), prev, NOW + HOLD_MS + 1000, 'auto').visible, true);
  assert.equal(hudVisibility(quiet(), prev, t2 + HOLD_MS, 'auto').visible, false);
});

test('[HUD-RULES] the floor-start window is 3 s with no tail', () => {
  const snap = quiet({ floorStartedMs: NOW });
  assert.equal(hudVisibility(snap, none, NOW + FLOOR_START_MS - 1, 'auto').visible, true);
  const r = hudVisibility(snap, none, NOW + FLOOR_START_MS - 1, 'auto');
  assert.equal(hudVisibility(snap, { lives: 3, lastTriggerMs: r.lastTriggerMs }, NOW + FLOOR_START_MS + 1, 'auto').visible, false);
});

test('[HUD-RULES] never hides while loud, even with a stale trigger time', () => {
  const r = hudVisibility(quiet({ loud: true }), { lives: 3, lastTriggerMs: -Infinity }, NOW, 'minimal');
  assert.equal(r.visible, true);
  const far = hudVisibility(quiet({ loud: true }), { lives: 3, lastTriggerMs: NOW - 10*HOLD_MS }, NOW, 'auto');
  assert.equal(far.visible, true);
});

test('[HUD-RULES] always mode is always visible', () => {
  assert.equal(hudVisibility(quiet(), none, NOW, 'always').visible, true);
  assert.equal(hudVisibility(quiet(), null, 0, 'always').visible, true);
});

test('[HUD-RULES] minimal mode counts only noise and the clock', () => {
  for (const over of [{ batteryLow: true }, { radarOn: true }, { repairProgress: 0.5 },
                      { floorStartedMs: NOW }, { lives: 1 }]){
    assert.equal(hudVisibility(quiet(over), { lives: 3, lastTriggerMs: -Infinity }, NOW, 'minimal').visible, false,
      `minimal showed for ${Object.keys(over)}`);
  }
  assert.equal(hudVisibility(quiet({ noise: 0.4 }), none, NOW, 'minimal').visible, true);
  assert.equal(hudVisibility(quiet({ clockSeconds: 20 }), none, NOW, 'minimal').visible, true);
});

test('[HUD-RULES] undefined and unknown modes behave as auto', () => {
  const cases = [quiet(), quiet({ radarOn: true }), quiet({ noise: 0.4 }), quiet({ repairProgress: 1 })];
  for (const s of cases){
    const auto = hudVisibility(s, none, NOW, 'auto');
    assert.deepEqual(hudVisibility(s, none, NOW, undefined), auto);
    assert.deepEqual(hudVisibility(s, none, NOW, 'nonsense'), auto);
  }
});

test('[HUD-RULES] the rule reads no clock: same input, same answer', () => {
  const s = quiet({ noise: 0.4 });
  assert.deepEqual(hudVisibility(s, none, NOW, 'auto'), hudVisibility(s, none, NOW, 'auto'));
});

test('[HUD-RULES] buildHudSnap reads the floor state', () => {
  const G = { leaks: [{ fixed: false, repair: 0.4 }, { fixed: true, repair: 9 }, { fixed: false, repair: 0.1 }],
    selfNoise: LOUD + 0.1, batt: 20, radar: true, clock: 25, time: 10 };
  const s = buildHudSnap(G, 2, 50000);
  assert.equal(s.repairProgress, 0.4);       // the sealed leak does not count
  assert.equal(s.loud, true);
  assert.equal(s.batteryLow, true);
  assert.equal(s.radarOn, true);
  assert.equal(s.lives, 2);
  assert.equal(s.floorStartedMs, 40000);
});
