import test from 'node:test';
import assert from 'node:assert/strict';
import { stickMap } from '../../src/util/stick.js';
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
