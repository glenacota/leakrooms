import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { playPlayerRun, classifyDeath, chooseVisibleWater, advanceWaypoint, searchTargetDone, chooseRememberedReturn } from '../helpers/player-bot.js';
import { MAP, TILE_TYPES } from '../../src/config/constants.js';
import { emit } from '../../src/util/events.js';

const { A, G } = await loadGame();

function run(options = {}){
  A.setOption('difficulty', 'relaxed');
  return playPlayerRun({
    A, G, keys: A.keys, seed: 5077, withLifeforms: true,
    maxSeconds: 0.1, ...options,
  });
}

test('death classification uses the actual clock event even near a lifeform', () => {
  assert.equal(classifyDeath({ cause: 'clock', recent: [{ d: 0.1 }] }), 'clock');
});

test('death classification uses the actual catch event', () => {
  assert.equal(classifyDeath({ cause: 'caught', recent: [] }), 'caught');
});

test('following a path does not return to a waypoint already passed', () => {
  const path = [[0, 0], [1, 0], [2, 0], [3, 0]];
  const next = advanceWaypoint(path, 1, 1.1, 0.5);
  assert.equal(next, 2);
  assert.equal(advanceWaypoint(path, next, 2.0, 0.5), 2);
  assert.equal(advanceWaypoint(path, next, 2.5, 0.5), 3);
});

test('the run keeps steering forward after passing a waypoint', () => {
  const startRun = A.startRun, update = A.updateReal, blocked = A.blocked;
  const directions = [];
  let grid, exit, leaks;
  A.startRun = () => {
    startRun();
    grid = G.grid.slice();
    exit = G.exitTiles[0];
    leaks = G.leaks.map(leak => leak.fixed);
    G.grid.fill(0);
    for (let x = 10; x <= 15; x++) G.grid[10 * MAP.WIDTH_TILES + x] = TILE_TYPES.FLOOR;
    G.plumber.x = 10.5; G.plumber.y = 10.5;
    G.exitTiles[0] = { x: 16, y: 10 };
    G.leaks.forEach(leak => { leak.fixed = true; });
  };
  A.blocked = () => false;
  A.updateReal = () => {
    directions.push({ left: !!A.keys.a, right: !!A.keys.d });
    if (directions.length === 1) G.plumber.x = 11.1;
    if (directions.length === 2) G.plumber.x = 12;
  };
  try {
    run({ withLifeforms: false, maxSeconds: 3 / 60 });
    assert.deepEqual(directions, [
      { left: false, right: true },
      { left: false, right: true },
      { left: false, right: true },
    ]);
  } finally {
    G.grid.set(grid);
    G.exitTiles[0] = exit;
    G.leaks.forEach((leak, i) => { leak.fixed = leaks[i]; });
    A.startRun = startRun; A.updateReal = update; A.blocked = blocked;
  }
});

test('a seen fallback target is not finished until its tile is visited', () => {
  const seen = new Uint8Array([0, 1]);
  const visited = new Uint8Array([0, 0]);
  assert.equal(searchTargetDone('unseen', seen, visited, 1), true);
  assert.equal(searchTargetDone('unvisited', seen, visited, 1), false);
  visited[1] = 1;
  assert.equal(searchTargetDone('unvisited', seen, visited, 1), true);
});

test('remembered return uses reachable seen tiles and falls back to spawn or search', () => {
  const grid = new Uint8Array(MAP.WIDTH_TILES * MAP.HEIGHT_TILES);
  const put = (x, y) => { grid[y * MAP.WIDTH_TILES + x] = TILE_TYPES.FLOOR; };
  for (const [x, y] of [[10, 10], [10, 11], [11, 11], [12, 11], [12, 10]]) put(x, y);
  const door = { x: 13, y: 10 }, spawn = { x: 10, y: 10 };
  assert.deepEqual(chooseRememberedReturn(grid, 10.5, 10.5, door, spawn),
    { kind: 'door', x: 12, y: 10 });
  grid[10 * MAP.WIDTH_TILES + 12] = 0;
  assert.deepEqual(chooseRememberedReturn(grid, 11.5, 11.5, door, spawn),
    { kind: 'spawn', x: 10, y: 10 });
  assert.deepEqual(chooseRememberedReturn(grid, 10.5, 10.5, door, spawn), { kind: 'search' });
  grid[11 * MAP.WIDTH_TILES + 10] = 0;
  assert.deepEqual(chooseRememberedReturn(grid, 11.5, 11.5, door, spawn), { kind: 'search' });
});

test('remembered return does not take an unseen shortcut', () => {
  const startRun = A.startRun, update = A.updateReal, blocked = A.blocked;
  const directions = [];
  let grid, mask, exit, leaks;
  A.startRun = () => {
    startRun();
    if (!grid){
      grid = G.grid.slice(); mask = G.maskArr.slice();
      exit = G.exitTiles[0]; leaks = G.leaks.map(leak => leak.fixed);
    }
    G.grid.fill(0); G.maskArr.fill(0);
    for (const [x, y] of [[10,10], [11,10], [12,10], [10,11], [11,11], [12,11]])
      G.grid[y * MAP.WIDTH_TILES + x] = TILE_TYPES.FLOOR;
    for (const [x, y] of [[10,10], [10,11], [11,11], [12,11], [12,10]])
      G.maskArr[y * MAP.WIDTH_TILES + x] = 1;
    G.plumber.x = 10.5; G.plumber.y = 10.5;
    G.exitTiles[0] = { x: 13, y: 10 };
    G.leaks.forEach(leak => { leak.fixed = true; });
  };
  A.blocked = () => false;
  A.updateReal = () => directions.push({ right: !!A.keys.d, down: !!A.keys.s });
  try {
    run({ withLifeforms: false, returnPolicy: 'remembered', maxSeconds: 1 / 60 });
    run({ withLifeforms: false, returnPolicy: 'full', maxSeconds: 1 / 60 });
    assert.deepEqual(directions, [{ right: false, down: true }, { right: true, down: false }]);
  } finally {
    G.grid.set(grid); G.maskArr.set(mask); G.exitTiles[0] = exit;
    G.leaks.forEach((leak, i) => { leak.fixed = leaks[i]; });
    A.startRun = startRun; A.updateReal = update; A.blocked = blocked;
  }
});

test('return memory survives a retry and resets on the next floor', () => {
  const startRun = A.startRun, retry = A.retryFloor, dismiss = A.dismissClear, update = A.updateReal;
  const samples = [];
  let calls = 0;
  A.startRun = () => {
    startRun();
    G.maskArr.fill(0);
    const x = Math.floor(G.plumber.x), y = Math.floor(G.plumber.y);
    G.maskArr[y * MAP.WIDTH_TILES + x + 1] = 1;
  };
  A.retryFloor = () => { retry(); G.maskArr.fill(0); };
  A.dismissClear = () => { dismiss(); G.maskArr.fill(0); };
  A.updateReal = () => {
    if (++calls === 1) emit('clock:out');
    if (calls === 302) A.nextFloor();
  };
  try {
    run({ withLifeforms: false, returnPolicy: 'remembered', maxSeconds: 10.1,
      trace: sample => { if (!sample.event) samples.push(sample); } });
    assert.equal(samples.length, 3);
    assert.ok(samples[0].seenTiles >= 2);
    assert.ok(samples[1].seenTiles >= samples[0].seenTiles);
    assert.deepEqual(samples[1].spawn, samples[0].spawn);
    assert.equal(samples[2].floor, 1);
    assert.equal(samples[2].seenTiles, 1);
  } finally {
    A.startRun = startRun; A.retryFloor = retry; A.dismissClear = dismiss; A.updateReal = update;
  }
});

test('return moves toward the door when already in its approach tile', () => {
  const startRun = A.startRun, update = A.updateReal, blocked = A.blocked;
  const directions = [];
  let grid, exit, leaks;
  A.startRun = () => {
    startRun();
    grid = G.grid.slice(); exit = G.exitTiles[0]; leaks = G.leaks.map(leak => leak.fixed);
    G.grid.fill(0); G.grid[10 * MAP.WIDTH_TILES + 10] = TILE_TYPES.FLOOR;
    G.plumber.x = 10.01; G.plumber.y = 10.5;
    G.exitTiles[0] = { x: 11, y: 10 };
    G.leaks.forEach(leak => { leak.fixed = true; });
  };
  A.blocked = () => false;
  A.updateReal = () => directions.push(!!A.keys.d);
  try {
    const result = run({ withLifeforms: false, maxSeconds: 1 / 60 });
    assert.deepEqual(directions, [true]);
    assert.equal(result.returnStats.seconds, 1 / 60);
    assert.equal(result.returnStats.stalledSeconds, 1 / 60);
    assert.equal(result.returnStats.replans, 1);
  } finally {
    G.grid.set(grid); G.exitTiles[0] = exit;
    G.leaks.forEach((leak, i) => { leak.fixed = leaks[i]; });
    A.startRun = startRun; A.updateReal = update; A.blocked = blocked;
  }
});

test('a water plateau falls back to search instead of targeting the current tile', () => {
  const grid = new Uint8Array(MAP.WIDTH_TILES * MAP.HEIGHT_TILES);
  const wet = new Float32Array(grid.length);
  const mask = new Float32Array(grid.length);
  const visited = new Uint8Array(grid.length);
  const current = 10 * MAP.WIDTH_TILES + 10, next = current + 1;
  grid[current] = grid[next] = TILE_TYPES.FLOOR;
  wet[current] = wet[next] = mask[current] = mask[next] = 1;
  assert.equal(chooseVisibleWater(grid, wet, mask, visited, false, 10.5, 10.5, () => true), null);
  wet[current] = 0;
  assert.deepEqual(chooseVisibleWater(grid, wet, mask, visited, false, 10.5, 10.5, () => true),
    { kind: 'water', x: 11, y: 10 });
  visited[next] = 1;
  assert.equal(chooseVisibleWater(grid, wet, mask, visited, false, 10.5, 10.5, () => true), null);
});

test('radar-only visibility admits water that normal vision does not', () => {
  const grid = new Uint8Array(MAP.WIDTH_TILES * MAP.HEIGHT_TILES);
  const wet = new Float32Array(grid.length);
  const mask = new Float32Array(grid.length);
  const visited = new Uint8Array(grid.length);
  const tile = 10 * MAP.WIDTH_TILES + 11;
  grid[tile] = TILE_TYPES.FLOOR; wet[tile] = 1; mask[tile] = 0.15;
  assert.equal(chooseVisibleWater(grid, wet, mask, visited, false, 10.5, 10.5, () => true), null);
  assert.deepEqual(chooseVisibleWater(grid, wet, mask, visited, true, 10.5, 10.5, () => true),
    { kind: 'water', x: 11, y: 10 });
  assert.equal(chooseVisibleWater(grid, wet, mask, visited, true, 10.5, 10.5, () => false), null);
});

test('a run starts with the selected terms and normal lifeform grace', () => {
  let observed;
  run({ trace(){ observed = { lives: A.lives, born: G.lifeforms.map(lf => lf.born) }; } });
  assert.equal(observed.lives, 5);
  assert.ok(observed.born.length > 0);
  assert.ok(observed.born.every(born => born === 3));
  assert.ok(A.runTime > 0);
});

test('radar can be disabled for a matched scenario', () => {
  const update = A.updateReal;
  const radar = [];
  A.updateReal = dt => { radar.push(G.radar); update(dt); };
  try {
    run({ radarPolicy: 'off', withLifeforms: false });
    assert.ok(radar.length > 0);
    assert.ok(radar.every(value => !value));
  } finally {
    A.updateReal = update;
  }
});

test('a radar scan does not mark the entire off-screen map as seen', () => {
  const samples = [];
  run({ withLifeforms: false, maxSeconds: 5.1, trace: sample => samples.push(sample) });
  assert.equal(samples.length, 2);
  assert.ok(samples[1].seenTiles < MAP.WIDTH_TILES * MAP.HEIGHT_TILES);
});

test('the water control searches without selecting water goals', () => {
  const samples = [];
  run({ withLifeforms: false, waterPolicy: 'off', maxSeconds: 5.1, trace: sample => samples.push(sample) });
  assert.equal(samples.length, 2);
  assert.ok(samples.every(sample => sample.goal.kind !== 'water'));
});

test('the avoidance control disables the flee response without removing lifeforms', () => {
  const update = A.updateReal;
  const sprint = [];
  A.updateReal = () => { sprint.push(!!A.keys.shift); };
  const threat = () => {
    const lf = G.lifeforms[0];
    lf.x = G.plumber.x + 1; lf.y = G.plumber.y;
    lf.state = 'HUNT'; lf.rise = 1;
  };
  try {
    run({ maxSeconds: 1/60, avoidancePolicy: 'flee', trace: threat });
    run({ maxSeconds: 1/60, avoidancePolicy: 'none', trace: threat });
    assert.deepEqual(sprint, [true, false]);
  } finally {
    A.updateReal = update;
  }
});

test('scan-sprint requires a clear radar scan and refuses a visible lifeform', () => {
  const update = A.updateReal;
  const sprint = [];
  A.updateReal = () => { sprint.push(!!A.keys.shift); };
  try {
    run({ maxSeconds: 1, withLifeforms: false, waterPolicy: 'off', explorationPolicy: 'scan-sprint' });
    assert.ok(sprint.some(Boolean));
    sprint.length = 0;
    run({
      maxSeconds: 1, waterPolicy: 'off', avoidancePolicy: 'none', explorationPolicy: 'scan-sprint',
      trace(){
        const lf = G.lifeforms[0];
        lf.x = G.plumber.x; lf.y = G.plumber.y;
        G.maskArr[Math.floor(lf.y) * MAP.WIDTH_TILES + Math.floor(lf.x)] = 1;
      },
    });
    assert.ok(sprint.every(value => !value));
  } finally {
    A.updateReal = update;
  }
});

test('the lifeform-free control removes lifeforms on start, retry and clear', () => {
  const update = A.updateReal;
  let calls = 0;
  const counts = [];
  A.updateReal = dt => {
    counts.push(G.lifeforms.length);
    if (++calls === 1) emit('clock:out');
    else if (calls === 2) A.nextFloor();
    else update(dt);
  };
  try {
    const result = run({ withLifeforms: false });
    assert.equal(result.deaths, 1);
    assert.deepEqual(counts.slice(0, 3), [0, 0, 0]);
  } finally {
    A.updateReal = update;
  }
});

test('a retry keeps sealed leaks and records the real death cause', () => {
  const update = A.updateReal;
  let calls = 0, restored;
  A.updateReal = dt => {
    if (++calls === 1){
      A.sealLeak(G.leaks[0]);
      emit('clock:out');
    } else {
      restored = G.leaks[0].fixed;
      update(dt);
    }
  };
  try {
    const result = run();
    assert.equal(restored, true);
    assert.equal(result.deaths, 1);
    assert.equal(result.clockOuts, 1);
    assert.equal(result.deathLog[0].cause, 'clock');
  } finally {
    A.updateReal = update;
  }
});

test('a floor clear is not counted as a death', () => {
  const update = A.updateReal;
  let calls = 0;
  A.updateReal = dt => {
    if (++calls === 1) A.nextFloor();
    else update(dt);
  };
  try {
    const result = run();
    assert.equal(result.floorsDone, 1);
    assert.equal(result.deaths, 0);
    assert.equal(A.lives, 5);
    assert.equal(A.STATE, 'play');
  } finally {
    A.updateReal = update;
  }
});
