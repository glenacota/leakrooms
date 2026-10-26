import test from 'node:test';
import assert from 'node:assert/strict';
import { stickMap, sprintThresholds } from '../../src/util/stick.js';
import { STICK } from '../../src/config/constants.js';

const near = (a, b, e = 1e-12) => Math.abs(a - b) < e;
const R = 50;

test('[STICK] zero offset is exact zero', () => {
  const s = stickMap(0, 0, R, false);
  assert.ok(Object.is(s.x, 0) && Object.is(s.y, 0) && Object.is(s.mag, 0));
  assert.equal(s.sprint, false);
});

test('[STICK] inside the dead zone is exact +0 on every axis', () => {
  for (const [dx, dy] of [[R*0.19, 0], [-R*0.19, 0], [0, -R*0.19], [R*0.1, -R*0.1]]){
    const s = stickMap(dx, dy, R, false);
    assert.ok(Object.is(s.x, 0), `x is ${s.x}`);
    assert.ok(Object.is(s.y, 0), `y is ${s.y}`);
    assert.ok(Object.is(s.mag, 0));
    assert.equal(s.sprint, false);
  }
});

test('[STICK] just outside the dead zone starts near zero, no jump', () => {
  const s = stickMap(R*(STICK.DEAD + 0.01), 0, R, false);
  assert.ok(s.mag > 0 && s.mag < 0.02, `mag ${s.mag}`);
  assert.ok(s.x > 0 && s.y === 0);
});

test('[STICK] full deflection is mag 1 and keeps direction at 8 angles', () => {
  for (let k = 0; k < 8; k++){
    const a = k*Math.PI/4, ux = Math.cos(a), uy = Math.sin(a);
    const s = stickMap(ux*R, uy*R, R, false);
    assert.ok(near(s.mag, 1), `mag ${s.mag}`);
    assert.ok(near(s.x, ux) && near(s.y, uy), `angle ${k}: ${s.x},${s.y}`);
  }
});

test('[STICK] a thumb beyond the radius is clamped', () => {
  const s = stickMap(R*5, 0, R, false);
  assert.ok(near(s.mag, 1) && near(s.x, 1) && s.y === 0);
});

test('[STICK] sprint latches: on at 0.88, holds at 0.85, off below 0.80', () => {
  assert.equal(stickMap(R*0.87, 0, R, false).sprint, false);
  assert.equal(stickMap(R*0.88, 0, R, false).sprint, true);
  assert.equal(stickMap(R*0.85, 0, R, true).sprint, true);
  assert.equal(stickMap(R*0.85, 0, R, false).sprint, false);
  assert.equal(stickMap(R*0.79, 0, R, true).sprint, false);
});

test('[STICK] radius 0 or less returns zeros', () => {
  for (const r of [0, -10]){
    const s = stickMap(30, 30, r, true);
    assert.ok(Object.is(s.x, 0) && Object.is(s.y, 0) && Object.is(s.mag, 0));
    assert.equal(s.sprint, false);
  }
});

/* ============ SPRINT PUSH presets ============ */
const PRESETS = { light: 0.75, normal: 0.88, firm: 0.96 };
const sp = (frac, prev, preset) => stickMap(R*frac, 0, R, prev, preset).sprint;

test('[STICK] sprintThresholds: off is on minus the hysteresis', () => {
  for (const [name, on] of Object.entries(PRESETS)){
    const t = sprintThresholds(name);
    assert.equal(t.on, on);
    assert.ok(near(t.off, on - STICK.SPRINT_HYST), `${name} off ${t.off}`);
  }
  assert.deepEqual(STICK.SPRINT_PRESETS, PRESETS);
  assert.equal(STICK.SPRINT_ON, undefined);
  assert.equal(STICK.SPRINT_OFF, undefined);
});

test('[STICK] each preset: below on stays off, at on turns on, between holds, below off turns off', () => {
  for (const [name, on] of Object.entries(PRESETS)){
    const off = on - STICK.SPRINT_HYST;
    assert.equal(sp(on - 0.01, false, name), false, `${name} below on`);
    assert.equal(sp(on, false, name), true, `${name} at on`);
    assert.equal(sp(on + 0.01, false, name), true, `${name} above on`);
    const mid = (on + off) / 2;
    assert.equal(sp(mid, true, name), true, `${name} between, latched`);
    assert.equal(sp(mid, false, name), false, `${name} between, not latched`);
    assert.equal(sp(off + 0.005, true, name), true, `${name} just above off`);
    assert.equal(sp(off - 0.01, true, name), false, `${name} below off`);
  }
});

test('[STICK] an unknown, missing or non-string preset behaves as normal', () => {
  for (const bad of [undefined, null, 'turbo', '', 'LIGHT', 0.5, 1, true, {}, [], 'toString', '__proto__', 'hasOwnProperty']){
    const t = sprintThresholds(bad);
    assert.equal(t.on, PRESETS.normal, `${String(bad)}`);
    for (const frac of [0.5, 0.79, 0.85, 0.87, 0.88, 0.95]){
      for (const prev of [false, true])
        assert.equal(sp(frac, prev, bad), sp(frac, prev, 'normal'), `${String(bad)} @${frac} prev ${prev}`);
    }
  }
  // Omitting the argument is the four-argument call the old code made.
  assert.equal(stickMap(R*0.88, 0, R, false).sprint, true);
});

test('[STICK] dead zone, direction and magnitude are identical across presets', () => {
  for (const [dx, dy] of [[0, 0], [R*0.19, 0], [R*0.3, R*0.1], [-R*0.5, R*0.5], [0, -R*0.7], [R*0.8, 0], [R*2, 0]]){
    const base = stickMap(dx, dy, R, false, 'normal');
    for (const name of Object.keys(PRESETS)){
      const s = stickMap(dx, dy, R, false, name);
      assert.ok(Object.is(s.x, base.x) && Object.is(s.y, base.y) && Object.is(s.mag, base.mag),
        `${name} moved the vector at ${dx},${dy}`);
    }
  }
  // Inside the dead zone nothing sprints, whatever the preset or the latch.
  for (const name of Object.keys(PRESETS)) assert.equal(sp(0.1, true, name), false);
});
