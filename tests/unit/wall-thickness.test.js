import test from 'node:test';
import assert from 'node:assert/strict';
import { genMaze, ISLAND_MIN } from '../../src/sim/maze.js';
import { mulberry32 } from '../../src/util/rng.js';
import { FLOOR, MAP_HEIGHT_TILES, MAP_WIDTH_TILES, MIN_WALL, WALL } from '../../src/config/constants.js';

const runLen = (grid, x, y, dx, dy) => {
  const at = (a, b) => a < 0 || b < 0 || a >= MAP_WIDTH_TILES || b >= MAP_HEIGHT_TILES ? FLOOR : grid[b*MAP_WIDTH_TILES + a];
  let n = 1;
  for (let i=1; at(x+dx*i, y+dy*i) === WALL; i++) n++;
  for (let i=1; at(x-dx*i, y-dy*i) === WALL; i++) n++;
  return n;
};

test('no wall anywhere is thinner than MIN_WALL tiles', () => {
  for (let seed=1; seed<=60; seed++){
    const { grid } = genMaze(mulberry32(seed));
    for (let y=1; y<MAP_HEIGHT_TILES-1; y++) for (let x=1; x<MAP_WIDTH_TILES-1; x++){
      if (grid[y*MAP_WIDTH_TILES+x] !== WALL) continue;
      assert.ok(runLen(grid, x, y, 1, 0) >= MIN_WALL && runLen(grid, x, y, 0, 1) >= MIN_WALL,
        `seed ${seed}: wall at ${x},${y} is thinner than ${MIN_WALL} tiles`);
    }
  }
});

test('the floor stays one connected area', () => {
  for (let seed=1; seed<=60; seed++){
    const { grid } = genMaze(mulberry32(seed));
    const start = grid.indexOf(FLOOR);
    const seen = new Uint8Array(grid.length), stack = [start];
    seen[start] = 1;
    let reached = 0;
    while (stack.length){
      const c = stack.pop(); reached++;
      const x = c % MAP_WIDTH_TILES, y = (c / MAP_WIDTH_TILES) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nx = x+dx, ny = y+dy;
        if (nx<0 || ny<0 || nx>=MAP_WIDTH_TILES || ny>=MAP_HEIGHT_TILES) continue;
        const n = ny*MAP_WIDTH_TILES + nx;
        if (grid[n] === FLOOR && !seen[n]){ seen[n] = 1; stack.push(n); }
      }
    }
    const total = grid.reduce((s, v) => s + (v === FLOOR ? 1 : 0), 0);
    assert.equal(reached, total, `seed ${seed}: floor is split`);
  }
});

test('no wall islands except big blocks that shortcut gates loop around', () => {
  for (let seed=1; seed<=60; seed++){
    const { grid, shortcuts } = genMaze(mulberry32(seed));
    const seen = new Uint8Array(grid.length), stack = [];
    const flood = ()=>{
      let n = 0;
      while (stack.length){
        const c = stack.pop(); n++;
        const x = c % MAP_WIDTH_TILES, y = (c / MAP_WIDTH_TILES) | 0;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
          const nx = x+dx, ny = y+dy;
          if (nx<0 || ny<0 || nx>=MAP_WIDTH_TILES || ny>=MAP_HEIGHT_TILES) continue;
          const k = ny*MAP_WIDTH_TILES + nx;
          if (grid[k] === WALL && !seen[k]){ seen[k] = 1; stack.push(k); }
        }
      }
      return n;
    };
    for (let i=0; i<grid.length; i++){
      const x = i % MAP_WIDTH_TILES, y = (i / MAP_WIDTH_TILES) | 0;
      if (grid[i] === WALL && !seen[i] && (x===0 || y===0 || x===MAP_WIDTH_TILES-1 || y===MAP_HEIGHT_TILES-1)){ seen[i] = 1; stack.push(i); }
    }
    flood();
    let islands = 0;
    for (let i=0; i<grid.length; i++){
      if (grid[i] !== WALL || seen[i]) continue;
      seen[i] = 1; stack.push(i);
      assert.ok(flood() >= ISLAND_MIN, `seed ${seed}: small island at ${i%MAP_WIDTH_TILES},${(i/MAP_WIDTH_TILES)|0}`);
      islands++;
    }
    assert.ok(islands <= shortcuts, `seed ${seed}: ${islands} islands from ${shortcuts} gates`);
  }
});

test('shortcut gates add loops on every floor', () => {
  for (let seed=1; seed<=60; seed++)
    assert.ok(genMaze(mulberry32(seed)).shortcuts >= 3, `seed ${seed}`);
});

test('open floor stays small: mean largest square <= 12, max <= 25', () => {
  let sum = 0, max = 0;
  for (let seed=1; seed<=60; seed++){
    const { grid } = genMaze(mulberry32(seed));
    const d = new Int16Array(grid.length);
    let m = 0;
    for (let y=0; y<MAP_HEIGHT_TILES; y++) for (let x=0; x<MAP_WIDTH_TILES; x++){
      const i = y*MAP_WIDTH_TILES+x;
      if (grid[i] !== FLOOR) continue;
      d[i] = (x && y) ? 1 + Math.min(d[i-1], d[i-MAP_WIDTH_TILES], d[i-MAP_WIDTH_TILES-1]) : 1;
      if (d[i] > m) m = d[i];
    }
    sum += m; max = Math.max(max, m);
  }
  assert.ok(sum/60 <= 12, `mean ${sum/60}`);
  assert.ok(max <= 25, `max ${max}`);
});
