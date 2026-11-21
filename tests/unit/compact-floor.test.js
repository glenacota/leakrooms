import test from 'node:test';
import assert from 'node:assert/strict';
import { LEAK, MAP, TILE_TYPES } from '../../src/config/constants.js';
import { LEVELS } from '../../src/config/levels.js';
import { applyFloorMode, getFloorMode, getStaticLevel } from '../../src/game/floor.js';
import { loadGame } from '../helpers/harness.js';

globalThis.location = { search:'?input=touch&m=easy' };
const { A, G, els } = await loadGame();
A.setHeadless(false, false);

function setMode(mode){
  globalThis.location.search = mode ? '?m='+mode : '';
  applyFloorMode(mode);
}

test('mode parameter selects compact, seeded, playable floors', () => {
  for (const mode of [null, 'easy', 'hard']){
    setMode(mode);
    for (let seed=0; seed<20; seed++){
      for (let floor=0; floor<LEVELS.length; floor++){
        const level = getStaticLevel(seed, floor);
        const { grid, rooms, spawn, exit, leaks, spec, batteries, notes, fixtures } = level;
        assert.equal(spec.lifeforms, mode === 'hard' ? 2 : mode === 'easy' ? 0 : LEVELS[floor].lifeforms);
        if (mode === null){
          // Normal maze: multiple rooms, not the compact floor.
          assert.ok(rooms.length > 1);
          assert.strictEqual(getStaticLevel(seed, floor), level);
          A.buildFloor(floor, seed);
          assert.equal(G.lifeforms.length, LEVELS[floor].lifeforms);
          continue;
        }
        // Easy and hard share the compact single-room floor.
        assert.equal(rooms.length, 1);
        const room = rooms[0];
        assert.ok(room.rw*room.rh < MAP.WIDTH_TILES*MAP.HEIGHT_TILES/10);
        assert.equal(grid.filter(tile => tile === TILE_TYPES.FLOOR).length, room.rw*room.rh);
        assert.equal(grid[Math.floor(spawn.y)*MAP.WIDTH_TILES+Math.floor(spawn.x)], TILE_TYPES.FLOOR);
        assert.equal(leaks.length, LEVELS[floor].leaks);
        assert.equal(exit.length, 1);
        assert.equal(grid[exit[0].y*MAP.WIDTH_TILES+exit[0].x], 0);
        assert.equal(grid[(exit[0].y+1)*MAP.WIDTH_TILES+exit[0].x], TILE_TYPES.FLOOR);
        for (const [i, leak] of leaks.entries()){
          assert.equal(grid[leak.y*MAP.WIDTH_TILES+leak.x], 0);
          assert.equal(grid[leak.sy*MAP.WIDTH_TILES+leak.sx], TILE_TYPES.FLOOR);
          assert.notEqual(leak.x, exit[0].x);
          for (const other of leaks.slice(i+1))
            assert.ok(Math.hypot(leak.sx-other.sx, leak.sy-other.sy) > 2*LEAK.REPAIR_REACH_TILES);
        }
        assert.ok(fixtures.length && batteries.length && notes.length);
        const pickups = [...batteries, ...notes];
        assert.equal(new Set(pickups.map(p => `${p.x},${p.y}`)).size, pickups.length);
        for (const p of pickups)
          assert.equal(grid[Math.floor(p.y)*MAP.WIDTH_TILES+Math.floor(p.x)], TILE_TYPES.FLOOR);
        assert.strictEqual(getStaticLevel(seed, floor), level);
        A.buildFloor(floor, seed);
        const snapshot = JSON.stringify([G.leaks, G.exitTiles, G.batteries, G.notes]);
        G.leaks[0].fixed = true;
        G.batteries[0].taken = true;
        A.buildFloor(floor, seed);
        assert.equal(JSON.stringify([G.leaks, G.exitTiles, G.batteries, G.notes]), snapshot);
        assert.equal(G.lifeforms.length, mode === 'hard' ? 2 : 0);
        if (mode === 'hard'){
          for (const lifeform of G.lifeforms){
            assert.ok(Math.hypot(lifeform.x-spawn.x, lifeform.y-spawn.y) >= 4,
              'hard compact lifeforms stay clear of the plumber spawn');
          }
        }
      }
    }
  }
});

test('parameter is fixed at boot and normal floor cache remains separate', () => {
  // Boot already applied ?m=easy from the top-level location.
  setMode('easy');
  A.buildFloor(0, 1234);
  assert.equal(G.lifeforms.length, 0);
  const easy = getStaticLevel(1234, 0);
  setMode(null);
  const normal = getStaticLevel(1234, 0);
  assert.notStrictEqual(normal, easy);
  assert.ok(normal.rooms.length > 1);
  A.buildFloor(0, 1234);
  assert.equal(G.lifeforms.length, LEVELS[0].lifeforms);
  setMode('easy');
  assert.equal(getStaticLevel(1234, 0).spec.lifeforms, 0);
  setMode('hard');
  assert.equal(getStaticLevel(1234, 0).spec.lifeforms, 2);
  assert.notStrictEqual(getStaticLevel(1234, 0), easy);
  setMode(null);
});

test('unknown mode value falls back to normal', () => {
  const normalize = m => m === 'easy' || m === 'hard' ? m : null;
  applyFloorMode(normalize('whatever'));
  assert.equal(getFloorMode(), null);
  setMode(null);
});

test('compact floor run seals every leak and reaches win through real door cycles', () => {
  setMode('easy');
  A.startRun();
  for (let floor=0; floor<LEVELS.length; floor++){
    assert.equal(A.floorIdx, floor);
    assert.equal(G.lifeforms.length, 0);
    for (const leak of G.leaks){
      G.plumber.x = leak.sx+0.5;
      G.plumber.y = leak.sy+0.5;
      const before = G.openLeaks;
      for (let frame=0; frame<600 && !leak.fixed; frame++) A.updateReal(1/60);
      assert.ok(leak.fixed);
      assert.equal(G.openLeaks, before-1);
    }
    const door = G.exitTiles[0];
    G.plumber.x = door.x+0.5;
    G.plumber.y = door.y+1.5;
    for (let frame=0; frame<600 && A.floorIdx===floor; frame++) A.updateReal(1/60);
    assert.equal(A.floorIdx, floor+1);
    if (floor < LEVELS.length-1){
      assert.equal(A.STATE, 'clear');
      assert.equal(A.clearCard.lifeforms, 0);
      assert.equal(els['clear-forms'].textContent, 0);
      assert.equal(A.clearCard.leaks, LEVELS[floor+1].leaks);
      A.dismissClear();
    }
  }
  assert.equal(A.STATE, 'win');
});
