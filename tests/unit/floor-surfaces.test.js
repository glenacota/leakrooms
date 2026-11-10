/* The floor's five pixel surfaces: which ones are kept between retries, which
   are renewed on every build, and what a context restore does to them. The
   module is reached through its own exports. Textures and the water dirty box
   are read to check that a restore rebuilds what it depends on. The packers
   are also checked on bare arrays, so they do not need a whole floor behind them. */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadGame } from '../helpers/harness.js';

const { A, G, els } = await loadGame();

const { surfaces, buildFloorSurfaces, syncSurfaces, setPixels }
  = await import('../../src/render/floor-surfaces.js');
const { repaintDirty, markWetAll, markWetTile, takeWetBox } = await import('../../src/util/repaint.js');
const { LS, MAP_W, MAP_H, TILE } = await import('../../src/config/constants.js');
const T = await import('../../src/render/textures.js');

const N = MAP_W * MAP_H;
const sizeOf = cv => `${cv.width}x${cv.height}`;
const rgbaBytes = cv => cv.getContext('2d').getImageData(0, 0, MAP_W, MAP_H).data;
const maskBytes = () => Buffer.from(rgbaBytes(surfaces.mask));
const countPainted = cv => {
  const d = rgbaBytes(cv);
  let painted = 0;
  for (let i = 0; i < N; i++) if (d[i * 4 + 3] !== 0) painted++;
  return painted;
};

/* Makes the light canvas come back with no 2d context, once, which fails the
   bake part-way. Returns a hook: `tripped` says whether the failure happened,
   and `undo()` puts the canvas factory back. The light canvas is the only one
   that is LS times the map, so the hook leaves the texture canvases alone. */
function failTheLightBakeOnce(){
  const real = document.createElement;
  const hook = { tripped: false, undo(){ document.createElement = real; } };
  document.createElement = function(tag){
    const cv = real.call(this, tag);
    const getContext = cv.getContext;
    cv.getContext = function(type){
      if (this.width === MAP_W * LS && !hook.tripped){
        hook.tripped = true;
        document.createElement = real;
        return null;
      }
      return getContext.call(this, type);
    };
    return cv;
  };
  return hook;
}

/* Records the first fill style set on each tile-sized canvas made while the
   hook is in place. The bake paints the carpet first, so the first fill is the
   texture the bake used. */
function recordFirstTileFills(){
  const real = document.createElement;
  const firstFills = [];
  /* The stub context is a Proxy that answers any unknown key with a function,
     so a marker property cannot be read back. A WeakSet records what was armed. */
  const armed = new WeakSet();
  const undo = () => { document.createElement = real; };
  document.createElement = function(tag){
    const cv = real.call(this, tag);
    const getContext = cv.getContext;
    cv.getContext = function(type){
      const ctx = getContext.call(this, type);
      if (this.width === MAP_W * TILE && ctx && !armed.has(ctx)){
        armed.add(ctx);
        let value;
        let seen = false;
        Object.defineProperty(ctx, 'fillStyle', {
          configurable: true,
          get(){ return value; },
          set(v){ if (!seen){ seen = true; firstFills.push(v); } value = v; },
        });
      }
      return ctx;
    };
    return cv;
  };
  return { firstFills, undo };
}

test('a retry of the same floor hands back the same static canvases', () => {
  A.buildFloor(0, 101);
  const tiles = surfaces.tiles, walls = surfaces.walls, light = surfaces.light;
  A.buildFloor(0, 101);
  assert.equal(surfaces.tiles, tiles, 'the tile layer was repainted for a retry');
  assert.equal(surfaces.walls, walls, 'the wall layer was repainted for a retry');
  assert.equal(surfaces.light, light, 'the light bake was rebuilt for a retry');
  assert.ok(surfaces.tiles.width > 0 && surfaces.light.width > 0,
    `the cached static canvases came back empty (${sizeOf(surfaces.tiles)}, ${sizeOf(surfaces.light)})`);
});

test('a different floor releases the previous static canvases and bakes new ones', () => {
  A.buildFloor(0, 102);
  const old = { tiles: surfaces.tiles, walls: surfaces.walls, light: surfaces.light };
  A.buildFloor(0, 103);
  for (const [name, cv] of Object.entries(old)) {
    assert.equal(cv.width, 0, `the previous ${name} canvas was dropped, not released`);
    assert.equal(cv.height, 0, `the previous ${name} canvas was dropped, not released`);
  }
  assert.notEqual(surfaces.tiles, old.tiles, 'a new floor reused the old tile layer');
  assert.ok(surfaces.tiles.width > 0, 'the floor just built is already released');
});

test('every build renews the mask and the water and releases the previous pair', () => {
  A.buildFloor(0, 104);
  const mask = surfaces.mask, wet = surfaces.wet;
  A.buildFloor(0, 104);
  assert.notEqual(surfaces.mask, mask, 'the mask was reused across builds');
  assert.notEqual(surfaces.wet, wet, 'the water was reused across builds');
  assert.equal(sizeOf(mask), '0x0', 'the previous mask was not released');
  assert.equal(sizeOf(wet), '0x0', 'the previous water was not released');
  assert.equal(sizeOf(surfaces.mask), `${MAP_W}x${MAP_H}`);
  assert.equal(sizeOf(surfaces.wet), `${MAP_W}x${MAP_H}`);
});

test('a fresh water image is fully transparent', () => {
  A.buildFloor(0, 105);
  assert.equal(countPainted(surfaces.wet), 0, 'water tiles were visible before any water arrived');
});

test('the water is packed from bare arrays when it is dirty', () => {
  setPixels(true);
  A.buildFloor(0, 106);
  const wetArr = new Float32Array(N);
  const i = 30 * MAP_W + 30;
  wetArr[i] = 0.9;
  markWetAll();
  syncSurfaces({ grid: G.grid, wetArr, maskArr: G.maskArr });
  assert.ok(rgbaBytes(surfaces.wet)[i * 4 + 3] > 0, 'a wet tile was not packed into the water image');
  assert.equal(repaintDirty.water, false, 'the water flag was not cleared after packing');
});

test('with packing off, nothing is written to the water image', () => {
  A.buildFloor(0, 107);
  setPixels(false);
  try {
    const wetArr = new Float32Array(N).fill(0.9);
    markWetAll();
    syncSurfaces({ grid: G.grid, wetArr, maskArr: G.maskArr });
    assert.equal(countPainted(surfaces.wet), 0, 'water tiles were packed while packing was off');
  } finally {
    setPixels(true);
  }
});

test('a context restore bakes new static canvases and renews the floor canvases', () => {
  A.buildFloor(0, 108);
  const before = { tiles: surfaces.tiles, light: surfaces.light, mask: surfaces.mask, wet: surfaces.wet };
  els.game._fire('contextrestored', {});
  assert.notEqual(surfaces.tiles, before.tiles, 'the tile layer was not rebuilt after a context loss');
  assert.notEqual(surfaces.light, before.light, 'the light bake was not rebuilt after a context loss');
  assert.notEqual(surfaces.mask, before.mask, 'the mask was not recreated after a context loss');
  assert.notEqual(surfaces.wet, before.wet, 'the water was not recreated after a context loss');
  assert.ok(surfaces.tiles.width > 0 && surfaces.light.width > 0,
    'the restored static canvases were left with no pixels');
  assert.equal(repaintDirty.water, true, 'the water was not marked stale after a restore');
  assert.equal(repaintDirty.mask, true, 'the mask was not marked stale after a restore');
});

test('a context restore rebakes the tiles with the textures it has just rebuilt', () => {
  A.buildFloor(0, 113);
  const stale = T.carpetPat;
  const { firstFills, undo } = recordFirstTileFills();
  try {
    els.game._fire('contextrestored', {});
  } finally { undo(); }
  assert.ok(firstFills.length > 0, 'the restore painted no tile layer to check');
  assert.notEqual(firstFills[0], stale, 'the tile layer was painted with the textures from before the restore');
  assert.equal(firstFills[0], T.carpetPat, 'the tile layer did not use the rebuilt carpet texture');
});

test('a context restore marks the whole water dirty, so every tile repacks', () => {
  A.buildFloor(0, 114);
  /* A partial change first: a full box can then only come from the restore. */
  takeWetBox();
  markWetTile(30 * MAP_W + 30);
  els.game._fire('contextrestored', {});
  assert.equal(takeWetBox().full, true, 'the restored water was not marked fully dirty');
});

test('after a restore, a retry keeps the restored canvases', () => {
  A.buildFloor(0, 109);
  els.game._fire('contextrestored', {});
  const restored = surfaces.tiles;
  A.buildFloor(0, 109);
  assert.equal(surfaces.tiles, restored, 'a retry after a restore replaced the restored canvases');
});

test('after a restore, the mask packs the same pixels it packed before the loss', () => {
  setPixels(true);
  A.buildFloor(0, 111);
  const maskArr = new Float32Array(N);
  for (let i = 0; i < N; i++) maskArr[i] = (i % 7) / 6;
  const px = { grid: G.grid, wetArr: new Float32Array(N), maskArr };
  repaintDirty.mask = true;
  syncSurfaces(px);
  const before = maskBytes();
  assert.ok(before.some(b => b !== 0), 'the test mask painted nothing, so it proves nothing');
  els.game._fire('contextrestored', {});
  syncSurfaces(px);
  assert.ok(maskBytes().equals(before), 'the mask packed different pixels after a context restore');
});

test('a build whose bake fails is not skipped by the retry', () => {
  const inputs = { grid: G.grid, lightArr: G.lightArr };
  const hook = failTheLightBakeOnce();
  try {
    assert.throws(() => buildFloorSurfaces('bake-fail:1', inputs));
  } finally { hook.undo(); }
  assert.ok(hook.tripped, 'the bake never reached the light canvas, so the failure was not tested');
  buildFloorSurfaces('bake-fail:1', inputs);
  assert.ok(surfaces.light.getContext('2d'),
    'the retry skipped the bake that failed and kept a light canvas with no context');
  assert.ok(surfaces.light.width > 0 && surfaces.tiles.width > 0, 'the retry left the static canvases empty');
});

test('a context restore whose bake fails is retried by the next context restore', () => {
  A.buildFloor(0, 112);
  const hook = failTheLightBakeOnce();
  try {
    els.game._fire('contextrestored', {});
  } catch { /* a failed bake may surface through the event; the retry is what is checked */ }
  finally { hook.undo(); }
  assert.ok(hook.tripped, 'the restore never reached the light bake, so the failure was not tested');
  els.game._fire('contextrestored', {});
  assert.ok(surfaces.light.getContext('2d'),
    'the next restore did nothing after a failed bake and left a light canvas with no context');
  assert.ok(surfaces.tiles.width > 0, 'the next restore left the tile layer empty');
});

test('a context restore whose bake fails is not skipped by the next build', () => {
  const inputs = { grid: G.grid, lightArr: G.lightArr };
  buildFloorSurfaces('restore-fail:1', inputs);
  const hook = failTheLightBakeOnce();
  try {
    els.game._fire('contextrestored', {});
  } catch { /* a failed bake may surface through the event; the retry is what is checked */ }
  finally { hook.undo(); }
  assert.ok(hook.tripped, 'the restore never reached the light bake, so the failure was not tested');
  buildFloorSurfaces('restore-fail:1', inputs);
  assert.ok(surfaces.light.getContext('2d'),
    'the build after a failed restore skipped the bake and kept a light canvas with no context');
  assert.ok(surfaces.tiles.width > 0, 'the build after a failed restore left the tile layer empty');
});

test('the builder refuses inputs it cannot bake', () => {
  assert.throws(() => buildFloorSurfaces('1:0', {}), TypeError);
});

test('with packing off, a dirty water stays pending for the next packed frame', () => {
  A.buildFloor(0, 110);
  const wetArr = new Float32Array(N).fill(0.9);
  setPixels(false);
  try {
    markWetAll();
    syncSurfaces({ grid: G.grid, wetArr, maskArr: G.maskArr });
    assert.equal(repaintDirty.water, true, 'the water was marked clean while packing was off');
  } finally {
    setPixels(true);
  }
  syncSurfaces({ grid: G.grid, wetArr, maskArr: G.maskArr });
  const i = 30 * MAP_W + 30;
  assert.ok(rgbaBytes(surfaces.wet)[i * 4 + 3] > 0, 'the water pending from the headless frame was never packed');
  assert.equal(repaintDirty.water, false, 'the water flag was not cleared after packing');
});

test('the surfaces refuse to be read before any floor is built', async () => {
  const fresh = await import('../../src/render/floor-surfaces.js?fresh=before-build');
  for (const name of ['tiles', 'walls', 'light', 'mask', 'wet']) {
    assert.throws(() => fresh.surfaces[name], /no floor built/, `${name} was readable before a build`);
  }
});

test('a context restore with no floor held still rebuilds the textures', async () => {
  /* The boot listener also runs on this restore and holds a floor, so the
     texture rebuild is checked for the restore as a whole, not for this
     instance alone. */
  const fresh = await import('../../src/render/floor-surfaces.js?fresh=no-floor');
  fresh.bindFloorSurfaces();
  const wallBefore = T.wallPat;
  assert.doesNotThrow(() => els.game._fire('contextrestored', {}));
  assert.notEqual(T.wallPat, wallBefore, 'the wall texture was not rebuilt on a restore');
  assert.throws(() => fresh.surfaces.tiles, /no floor built/,
    'a restore with no floor held made canvases');
});

test('no module outside floor-surfaces writes to the five surfaces', () => {
  /* Checks the named forms only: a getContext call or a size write on a
     surfaces member. A write through a local alias is not caught here. */
  const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
  const OWN = fileURLToPath(new URL('../../src/render/floor-surfaces.js', import.meta.url));
  const writes = /surfaces\.(tiles|walls|light|mask|wet)\s*\.\s*(getContext|width|height)\b/;
  const offenders = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) walk(`${path}/`);
      else if (entry.name.endsWith('.js') && path !== OWN && writes.test(readFileSync(path, 'utf8')))
        offenders.push(path);
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, [], 'these files write to a floor surface, which only the module may do');
});
