/* Camera, viewport and world-device mapping are unit-tested through
   buildFrame() instead of running 90 render frames to settle the camera. */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import { MAP_H, MAP_W, TILE } from '../../src/config/constants.js';
import { loadGame } from '../helpers/harness.js';
import { buildFrame, cam } from '../../src/render/frame.js';

const { A, G } = await loadGame();
const buildFloor = A.buildFloor;
const SCALE = A.SCALE;
const CW = A.cvs.width;
const CH = A.cvs.height;
const EXPECTED_KEYS = ['t','dt','tx','ty','dx','dy','x0','y0','x1','y1','vw','vh','T','w2sx','w2sy','p'];

/* Drive the camera builder N frames, ms apart. No simulation, no drawing. */
function settle(t0, n, ms = 16.7){
  let t = t0;
  for (let i = 0; i < n; i++){ buildFrame(t); t += ms; }
}

test('buildFrame returns the full rc with a working w2s mapping', () => {
  buildFloor(2, 31337);
  G.plumber.x = 51.25; G.plumber.y = 18.6;
  settle(1000, 90);
  const rc = buildFrame(1000 + 91 * 16.7);
  assert.deepEqual(Object.keys(rc).sort(), EXPECTED_KEYS.sort(), 'rc carries all 14 fields');
  assert.strictEqual(rc.T, TILE * SCALE, 'T = TILE*SCALE');
  assert.strictEqual(rc.p, G.plumber, 'rc.p is the plumber');

  for (const wx of [0, 10, 51.25]){
    assert.strictEqual(rc.w2sx(wx), SCALE * (wx * TILE + rc.tx), 'w2sx matches tx');
    assert.strictEqual(rc.w2sy(wx), SCALE * (wx * TILE + rc.ty), 'w2sy matches ty');
  }
  assert.ok(rc.dt <= 0.25, 'dt is clamped to a quarter second');
  assert.ok(rc.vw > 0 && rc.vh > 0, 'viewport has size');
  assert.ok(rc.x1 >= rc.x0 && rc.y1 >= rc.y0, 'tile range is non-empty');
});

test('the camera centres the plumber and keeps the world upright', () => {
  buildFloor(2, 31337);
  G.plumber.x = 51.25; G.plumber.y = 18.6;
  settle(1000, 90);
  const rc = buildFrame(1000 + 91 * 16.7);
  const pxDev = rc.w2sx(G.plumber.x);
  const pyDev = rc.w2sy(G.plumber.y);
  const tol = TILE * SCALE * 0.6;

  assert.ok(Math.abs(pxDev - CW / 2) < tol, 'plumber x at viewport centre');
  assert.ok(Math.abs(pyDev - CH / 2) < tol, 'plumber y at viewport centre');

  const [lxDev] = [rc.w2sx(G.plumber.x - 5), rc.w2sy(G.plumber.y)];
  const [rDev]  = [rc.w2sx(G.plumber.x + 5), rc.w2sy(G.plumber.y)];
  const [, uDev] = [rc.w2sx(G.plumber.x), rc.w2sy(G.plumber.y - 5)];
  const [, dDev] = [rc.w2sx(G.plumber.x), rc.w2sy(G.plumber.y + 5)];
  assert.ok(lxDev < pxDev, '5 tiles left lands left of centre');
  assert.ok(rDev > pxDev, '5 tiles right lands right of centre');
  assert.ok(uDev < pyDev, '5 tiles up lands above centre');
  assert.ok(dDev > pyDev, '5 tiles down lands below centre');

  const span = rDev - lxDev;
  assert.ok(Math.abs(span - 10 * TILE * SCALE) < 0.5, '10 tiles span 10*TILE*SCALE — SCALE applied once');
});

test('the camera clamps to all four map edges', () => {
  buildFloor(2, 31337);
  const halfW = CW / (2 * TILE * SCALE);
  const halfH = CH / (2 * TILE * SCALE);
  const right = MAP_W - halfW;
  const bottom = MAP_H - halfH;
  const corners = [
    [0.25, 0.25],                          // top-left
    [MAP_W - 0.25, 0.25],                  // top-right
    [0.25, MAP_H - 0.25],                  // bottom-left
    [MAP_W - 0.25, MAP_H - 0.25],          // bottom-right
  ];
  for (const [px, py] of corners){
    G.plumber.x = px; G.plumber.y = py;
    settle(1000, 200);
    buildFrame(5000);
    assert.ok(cam.x >= halfW && cam.x <= right,
      `cam.x clamped horizontally at (${px},${py}): ${cam.x.toFixed(2)} not in [${halfW.toFixed(2)},${right.toFixed(2)}]`);
    assert.ok(cam.y >= halfH && cam.y <= bottom,
      `cam.y clamped vertically at (${px},${py}): ${cam.y.toFixed(2)} not in [${halfH.toFixed(2)},${bottom.toFixed(2)}]`);
    const rc = buildFrame(5016);
    const wxDev = rc.w2sx(G.plumber.x);
    const wyDev = rc.w2sy(G.plumber.y);
    assert.ok(wxDev >= 0 && wxDev <= CW, `plumber x on screen at (${px},${py})`);
    assert.ok(wyDev >= 0 && wyDev <= CH, `plumber y on screen at (${px},${py})`);
  }
});

test('dt is clamped after a long frame gap', () => {
  buildFloor(2, 31337);
  buildFrame(1000);
  const rc = buildFrame(1000 + 60000); // one minute gap
  assert.ok(rc.dt <= 0.25, 'dt clamped to 0.25s after a 60s gap');
});

test('reduced motion removes camera jitter and follows preference changes', () => {
  buildFloor(2, 31337);
  const preference = { matches: false };
  const random = Math.random;
  let queries = 0;
  let randomCalls = 0;
  window.matchMedia = query => {
    assert.equal(query, '(prefers-reduced-motion: reduce)');
    queries++;
    return preference;
  };
  Math.random = () => { randomCalls++; return 0.75; };

  try {
    buildFrame(1000);
    assert.notEqual(cam.jx, 0);
    assert.notEqual(cam.jy, 0);
    assert.equal(randomCalls, 2);

    preference.matches = true;
    const rc = buildFrame(1016);
    assert.equal(cam.jx, 0);
    assert.equal(cam.jy, 0);
    assert.equal(rc.tx, -cam.x * TILE + CW / (2 * SCALE));
    assert.equal(rc.ty, -cam.y * TILE + CH / (2 * SCALE));
    assert.equal(randomCalls, 2, 'reduced motion does not sample camera jitter');

    preference.matches = false;
    buildFrame(1032);
    assert.notEqual(cam.jx, 0);
    assert.notEqual(cam.jy, 0);
    assert.equal(randomCalls, 4);
    assert.equal(queries, 1, 'the media query is reused');
  } finally {
    preference.matches = false;
    Math.random = random;
    delete window.matchMedia;
  }
});
