/* Camera, viewport and world-device mapping are unit-tested through
   buildFrame() instead of running 90 render frames to settle the camera. */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import { MAP } from '../../src/config/constants.js';
import { emit, EVENT } from '../../src/util/events.js';
import { loadGame } from '../helpers/harness.js';

const { A, G } = await loadGame();
const { DPR } = await import('../../src/render/canvas.js');
const { buildFrame, cam } = await import('../../src/render/frame.js');
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
  assert.strictEqual(rc.T, MAP.TILE_SIZE_PX * SCALE, 'T = MAP.TILE_SIZE_PX*SCALE');
  assert.strictEqual(rc.p, G.plumber, 'rc.p is the plumber');

  for (const wx of [0, 10, 51.25]){
    assert.strictEqual(rc.w2sx(wx), SCALE * (wx * MAP.TILE_SIZE_PX + rc.tx), 'w2sx matches tx');
    assert.strictEqual(rc.w2sy(wx), SCALE * (wx * MAP.TILE_SIZE_PX + rc.ty), 'w2sy matches ty');
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
  const tol = MAP.TILE_SIZE_PX * SCALE * 0.6;

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
  assert.ok(Math.abs(span - 10 * MAP.TILE_SIZE_PX * SCALE) < 0.5, '10 tiles span 10*MAP.TILE_SIZE_PX*SCALE — SCALE applied once');
});

test('the camera clamps to all four map edges', () => {
  buildFloor(2, 31337);
  const halfW = CW / (2 * MAP.TILE_SIZE_PX * SCALE);
  const halfH = CH / (2 * MAP.TILE_SIZE_PX * SCALE);
  const right = MAP.WIDTH_TILES - halfW;
  const bottom = MAP.HEIGHT_TILES - halfH;
  const corners = [
    [0.25, 0.25],                          // top-left
    [MAP.WIDTH_TILES - 0.25, 0.25],                  // top-right
    [0.25, MAP.HEIGHT_TILES - 0.25],                  // bottom-left
    [MAP.WIDTH_TILES - 0.25, MAP.HEIGHT_TILES - 0.25],          // bottom-right
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

test('shake setting controls ambient motion and event camera cues', () => {
  buildFloor(2, 31337);
  const random = Math.random;
  Math.random = () => 0.5;

  try {
    A.setOption('shake', 'off');
    emit(EVENT.cameraShake, 'door');
    buildFrame(1000);
    assert.equal(cam.jx, 0);
    assert.equal(cam.jy, 0);

    A.setOption('shake', 'full');
    emit(EVENT.cameraShake, 'door');
    const full = buildFrame(1100);
    const fullX = full.tx + cam.x * MAP.TILE_SIZE_PX - CW / (2 * SCALE) - cam.jx;
    const fullY = full.ty + cam.y * MAP.TILE_SIZE_PX - CH / (2 * SCALE) - cam.jy;
    assert.ok(Math.abs(Math.hypot(fullX, fullY) - 10 * DPR / SCALE) < 1e-6,
      'full camera cue peaks at 10 CSS pixels');

    emit(EVENT.cameraShake, 'door');
    const repeated = buildFrame(1101);
    const repeatedX = repeated.tx + cam.x * MAP.TILE_SIZE_PX - CW / (2 * SCALE) - cam.jx;
    const repeatedY = repeated.ty + cam.y * MAP.TILE_SIZE_PX - CH / (2 * SCALE) - cam.jy;
    assert.ok(Math.hypot(repeatedX, repeatedY) > 9.9 * DPR / SCALE,
      'a repeated cue retriggers instead of fading out');

    buildFrame(1216);
    emit(EVENT.cameraShake, 'loud');
    emit(EVENT.cameraShake, 'seal');
    const seal = buildFrame(1232);
    const sealX = seal.tx + cam.x * MAP.TILE_SIZE_PX - CW / (2 * SCALE) - cam.jx;
    const sealY = seal.ty + cam.y * MAP.TILE_SIZE_PX - CH / (2 * SCALE) - cam.jy;
    assert.ok(Math.abs(Math.hypot(sealX, sealY) - 20 * DPR / SCALE) < 1e-6,
      'seal cue wins overlapping loud cue and peaks at 20 CSS pixels');
    const ended = buildFrame(1472);
    const endedX = ended.tx + cam.x * MAP.TILE_SIZE_PX - CW / (2 * SCALE) - cam.jx;
    const endedY = ended.ty + cam.y * MAP.TILE_SIZE_PX - CH / (2 * SCALE) - cam.jy;
    assert.ok(Math.hypot(endedX, endedY) < 1e-10, 'seal pulse ends after 240 ms');

    A.setOption('shake', 'reduced');
    emit(EVENT.cameraShake, 'door');
    const reduced = buildFrame(1488);
    const reducedX = reduced.tx + cam.x * MAP.TILE_SIZE_PX - CW / (2 * SCALE) - cam.jx;
    const reducedY = reduced.ty + cam.y * MAP.TILE_SIZE_PX - CH / (2 * SCALE) - cam.jy;
    assert.ok(Math.abs(Math.hypot(reducedX, reducedY) - 5 * DPR / SCALE) < 1e-6,
      'reduced camera cue halves amplitude');

    A.setOption('shake', 'off');
    emit(EVENT.cameraShake, 'seal');
    const off = buildFrame(1500);
    const offX = off.tx + cam.x * MAP.TILE_SIZE_PX - CW / (2 * SCALE) - cam.jx;
    const offY = off.ty + cam.y * MAP.TILE_SIZE_PX - CH / (2 * SCALE) - cam.jy;
    assert.equal(Math.hypot(offX, offY), 0, 'off clears active and queued cues');
  } finally {
    Math.random = random;
    A.setOption('shake', 'full');
  }
});
