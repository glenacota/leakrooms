/* Player-like navigation over the real simulation. The bot still uses the
   complete grid for routing and is not a substitute for human playtests. */
import { bfsPath } from './bot.js';
import { MAP, TILE_TYPES, WATER, NOISE } from '../../src/config/constants.js';
import { on } from '../../src/util/events.js';

const W = MAP.WIDTH_TILES, H = MAP.HEIGHT_TILES, N = W * H;
const IDX = (x, y) => y * W + x;

const SEE = 0.2;          // vision-mask value that counts as in view
const RADAR_SEE = 0.1;    // radar gives otherwise dark tiles a 0.15 mask
const WALK_HEARD = 6.6;   // tiles a walking plumber is heard: NOISE.HEAR_BASE_TILES 4 + NOISE.HEAR_GAIN_TILES_PER_POWER * walk power, see constants.js
const THREAT = 9;         // tiles at which a known lifeform is worth stepping away from
const REPLAN_FRAMES = 90; // re-plan at least this often, so a stale path cannot stall the bot
const RECENT_FRAMES = 900; // fifteen seconds of context before a death
const RADAR_PERIOD = 600; // one short scan every ten seconds while searching
const RADAR_FRAMES = 60;  // a one-second scan gives the mask time to appear
const SCAN_CONFIRM_FRAMES = 30; // allow half a second for lifeforms to appear on radar
const SAFE_SPRINT_FRAMES = 180; // scan information expires after three seconds
const SPRINT_CHECK_RANGE = 12.6; // sprint noise range in open floor

function freshKnowledge(floor, leakCount){
  return { floor, door: null, spawn: null, leaks: new Array(leakCount).fill(false),
    seen: new Uint8Array(N), visited: new Uint8Array(N), walkable: new Uint8Array(N), version: 0 };
}

/** Selects deeper visible water; a flat puddle leaves exploration to search. */
export function chooseVisibleWater(grid, wet, mask, visited, radar, px, py, onScreen){
  const threshold = radar ? RADAR_SEE : SEE;
  const current = IDX(Math.floor(px), Math.floor(py));
  const currentWet = wet[current];
  let best = null, bestWet = currentWet, bestDistance = Infinity;
  for (let i = 0; i < N; i++){
    const x = i % W, y = (i / W) | 0;
    if (i === current || mask[i] <= threshold || grid[i] !== TILE_TYPES.FLOOR || visited[i] ||
        wet[i] <= WATER.DRAW_THRESHOLD || wet[i] <= currentWet + 0.01 || !onScreen(x, y)) continue;
    const distance = Math.abs(x + 0.5 - px) + Math.abs(y + 0.5 - py);
    if (wet[i] > bestWet || (wet[i] === bestWet && distance < bestDistance)){
      bestWet = wet[i]; bestDistance = distance; best = { kind: 'water', x, y };
    }
  }
  return best;
}

/** Advances through reached waypoints without returning to earlier waypoints. */
export function advanceWaypoint(path, index, px, py){
  while (index < path.length - 1 &&
         Math.hypot(path[index][0] + 0.5 - px, path[index][1] + 0.5 - py) < 0.45) index++;
  return index;
}

/** Returns whether the current exploration target has been observed or visited. */
export function searchTargetDone(kind, seen, visited, tile){
  return kind === 'unseen' ? !!seen[tile] : !!visited[tile];
}

/** Selects a reachable remembered door approach, or the remembered spawn. */
export function chooseRememberedReturn(grid, px, py, door, spawn){
  const sx = Math.floor(px), sy = Math.floor(py);
  if (Math.hypot(door.x + 0.5 - px, door.y + 0.5 - py) < 1.25)
    return { kind: 'door', x: sx, y: sy };
  let best = null, length = Infinity;
  for (const [x, y] of [[door.x+1,door.y], [door.x-1,door.y], [door.x,door.y+1], [door.x,door.y-1]]){
    if (x < 0 || y < 0 || x >= W || y >= H || grid[IDX(x, y)] !== TILE_TYPES.FLOOR) continue;
    const path = bfsPath(sx, sy, x, y, grid, W, H);
    if (path && path.length < length){ best = { kind: 'door', x, y }; length = path.length; }
  }
  if (best) return best;
  const path = bfsPath(sx, sy, spawn.x, spawn.y, grid, W, H);
  return path && path.length > 1 ? { kind: 'spawn', x: spawn.x, y: spawn.y } : { kind: 'search' };
}

/**
 * Plays one five-floor run with the player bot.
 *
 * @param {object} o
 * @param {object} o.A - the API from loadGame().
 * @param {object} o.G - the live game state from loadGame().
 * @param {object} o.keys - the key state the bot presses (A.keys).
 * @param {number} o.seed - run seed, installed as RUN_SEED.
 * @param {boolean} o.withLifeforms - whether lifeforms stay on the floors.
 * @param {number} o.maxSeconds - game seconds before the bot gives up.
 * @param {'periodic'|'off'} [o.radarPolicy] - scan while searching, or disable radar.
 * @param {'flee'|'none'} [o.avoidancePolicy] - flee nearby threats, or ignore them.
 * @param {'follow'|'off'} [o.waterPolicy] - follow visible water, or search without it.
 * @param {'walk'|'scan-sprint'} [o.explorationPolicy] - optionally sprint after a clear radar scan.
 * @param {'full'|'remembered'} [o.returnPolicy] - route home over the full or remembered grid.
 * @param {function} [o.trace] - called every 5 game seconds and on deaths.
 * @returns {{cleared:boolean, floorsDone:number, deaths:number, clockOuts:number,
 *   seconds:number, why:string, deathLog:Array, returnStats:object}}
 */
export function playPlayerRun({ A, G, keys, seed, withLifeforms, maxSeconds, radarPolicy = 'periodic', avoidancePolicy = 'flee', waterPolicy = 'follow', explorationPolicy = 'walk', returnPolicy = 'full', trace }){
  if (radarPolicy !== 'periodic' && radarPolicy !== 'off') throw new Error('Unknown radar policy: ' + radarPolicy);
  if (avoidancePolicy !== 'flee' && avoidancePolicy !== 'none') throw new Error('Unknown avoidance policy: ' + avoidancePolicy);
  if (waterPolicy !== 'follow' && waterPolicy !== 'off') throw new Error('Unknown water policy: ' + waterPolicy);
  if (explorationPolicy !== 'walk' && explorationPolicy !== 'scan-sprint') throw new Error('Unknown exploration policy: ' + explorationPolicy);
  if (returnPolicy !== 'full' && returnPolicy !== 'remembered') throw new Error('Unknown return policy: ' + returnPolicy);
  const out = { cleared: false, floorsDone: 0, deaths: 0, clockOuts: 0, seconds: 0, why: '', deathLog: [],
    returnStats: { seconds: 0, distance: 0, stalledSeconds: 0, replans: 0 } };
  const maxFrames = Math.round(60 * maxSeconds);

  A.RUN_SEED = seed;
  A.startRun();
  if (!withLifeforms) G.lifeforms.length = 0;

  let know = freshKnowledge(-1, 0);
  let path = null, pathGoal = '', pathAt = [-99, -99], pathAge = 0, pathIndex = 1;
  let searchTarget = 'unseen';
  let swapped = false, movedLast = false;
  let distFromKey = '', distField = null;
  let returnKey = '', returnGoal = null;
  let frames = 0;
  let searchFrames = 0;
  let scanFrames = 0, scanClear = true, safeSprintUntil = 0;
  let jamSkip = 0, anchorX = -99, anchorY = -99, anchorAt = 0;
  let recent = [];
  let lastAction = 'start';
  let deathCause = null;
  let viewport;
  const unsubscribe = on('dead', ({ cause }) => { deathCause = cause; });

  function step(){
    const x = G.plumber.x, y = G.plumber.y;
    A.addRunTime(1/60);
    A.updateReal(1/60);
    if (lastAction === 'door' || lastAction === 'spawn' || lastAction === 'door-hold'){
      const distance = Math.hypot(G.plumber.x - x, G.plumber.y - y);
      out.returnStats.seconds += 1/60;
      out.returnStats.distance += distance;
      if (lastAction !== 'door-hold' && distance < 1e-6) out.returnStats.stalledSeconds += 1/60;
    }
  }

  /* The headless run uses the harness canvas size and a centered, clamped
     camera; rendering itself is not stepped in this simulation. */
  function updateViewport(){
    const width = A.cvs.clientWidth, height = A.cvs.clientHeight;
    const scale = A.viewScale(width, height) * MAP.TILE_SIZE_PX;
    if (!(scale > 0)) throw new Error('Player bot requires a nonzero viewport');
    const halfW = width / (2 * scale), halfH = height / (2 * scale);
    const cx = W > halfW * 2 ? Math.max(halfW, Math.min(W - halfW, G.plumber.x)) : G.plumber.x;
    const cy = H > halfH * 2 ? Math.max(halfH, Math.min(H - halfH, G.plumber.y)) : G.plumber.y;
    viewport = { left: cx - halfW, right: cx + halfW, top: cy - halfH, bottom: cy + halfH };
  }
  function onScreen(x, y){
    return x + 1 > viewport.left && x < viewport.right && y + 1 > viewport.top && y < viewport.bottom;
  }

  /* What the player has seen so far on this floor. Called once per frame. */
  function look(){
    if (know.floor !== A.floorIdx){
      know = freshKnowledge(A.floorIdx, G.leaks.length);
      know.spawn = { x: Math.floor(G.plumber.x), y: Math.floor(G.plumber.y) };
      know.door = { x: G.exitTiles[0].x, y: G.exitTiles[0].y };
      returnKey = '';
      path = null;
    }
    const m = G.maskArr;
    const threshold = G.radar ? RADAR_SEE : SEE;
    for (let i = 0; i < N; i++){
      if (m[i] > threshold && onScreen(i % W, (i / W) | 0)) know.seen[i] = 1;
      if (returnPolicy === 'remembered' && know.seen[i] && !know.walkable[i] && G.grid[i] === TILE_TYPES.FLOOR){
        know.walkable[i] = TILE_TYPES.FLOOR; know.version++;
      }
    }
    /* The tile under the plumber is always drawn, even behind the vision cone,
       so standing on a tile is seeing it. Without this a tile directly behind
       the plumber is reached and never counts as searched. */
    const tile = IDX(Math.floor(G.plumber.x), Math.floor(G.plumber.y));
    know.seen[tile] = 1;
    know.visited[tile] = 1;
    if (returnPolicy === 'remembered' && !know.walkable[tile] && G.grid[tile] === TILE_TYPES.FLOOR){
      know.walkable[tile] = TILE_TYPES.FLOOR; know.version++;
    }

    G.leaks.forEach((L, k) => {
      if (know.leaks[k] || L.fixed) return;
      if (onScreen(L.x, L.y) && m[IDX(L.x, L.y)] > 0.02) know.leaks[k] = true;
    });
  }

  /* Walking distances from the plumber's tile, cached while it stays near. */
  function distancesFrom(tx, ty){
    const key = tx + ',' + ty;
    if (key === distFromKey) return distField;
    const dist = new Int32Array(N).fill(-1);
    const start = IDX(tx, ty);
    if (G.grid[start] !== TILE_TYPES.FLOOR) return (distField = null);
    const q = [start]; dist[start] = 0;
    for (let h = 0; h < q.length; h++){
      const c = q[h], cx = c % W, cy = (c / W) | 0;
      for (const [nx, ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]){
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = IDX(nx, ny);
        if (G.grid[ni] !== TILE_TYPES.FLOOR || dist[ni] >= 0) continue;
        dist[ni] = dist[c] + 1; q.push(ni);
      }
    }
    distFromKey = key; distField = dist;
    return dist;
  }

  /* Nearest walkable tile that satisfies `want`, as a path from the plumber. */
  function pathToNearest(px, py, want){
    const sx = Math.floor(px), sy = Math.floor(py);
    const start = IDX(sx, sy);
    if (G.grid[start] !== TILE_TYPES.FLOOR) return null;
    const prev = new Int32Array(N).fill(-1);
    prev[start] = start;
    const q = [start];
    for (let h = 0; h < q.length; h++){
      const c = q[h];
      if (want(c) && c !== start){
        const out = []; let at = c;
        while (at !== start){ out.push([at % W, (at / W) | 0]); at = prev[at]; }
        out.push([sx, sy]);
        return out.reverse();
      }
      const cx = c % W, cy = (c / W) | 0;
      for (const [nx, ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]){
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = IDX(nx, ny);
        if (G.grid[ni] !== TILE_TYPES.FLOOR || prev[ni] >= 0) continue;
        prev[ni] = c; q.push(ni);
      }
    }
    return null;
  }

  /* The walkable tiles beside the door, nearest first. */
  function doorStands(){
    const e = G.exitTiles[0];
    return [[e.x+1,e.y],[e.x-1,e.y],[e.x,e.y+1],[e.x,e.y-1]]
      .filter(([x,y]) => x >= 0 && y >= 0 && x < W && y < H && G.grid[IDX(x,y)] === TILE_TYPES.FLOOR);
  }

  /* What to do next: a known open leak, else search, else the door. */
  function chooseGoal(px, py){
    const openKnown = [];
    G.leaks.forEach((L, k) => { if (!L.fixed && know.leaks[k]) openKnown.push({ L, k }); });
    if (openKnown.length){
      const dist = distancesFrom(Math.floor(px), Math.floor(py));
      let best = null, bd = Infinity;
      for (const o of openKnown){
        const d = dist ? dist[IDX(o.L.sx, o.L.sy)] : -1;
        const dd = d >= 0 ? d : 1e9;
        if (dd < bd){ bd = dd; best = o; }
      }
      /* A leak whose standing spot is unreachable on foot is searched around, not
         walked to: the BFS below handles it like any unknown tile. */
      if (best && bd < 1e9) return { kind: 'leak', x: best.L.sx, y: best.L.sy, k: best.k };
    }
    const allSealed = G.leaks.every(L => L.fixed);
    if (allSealed && know.door){
      if (returnPolicy === 'remembered'){
        const key = Math.floor(px) + ',' + Math.floor(py) + ',' + know.version +
          ',' + (Math.hypot(know.door.x + 0.5 - px, know.door.y + 0.5 - py) < 1.25);
        if (key !== returnKey){
          returnGoal = chooseRememberedReturn(know.walkable, px, py, know.door, know.spawn);
          returnKey = key;
        }
        return returnGoal;
      }
      const s = doorStands();
      if (s.length){
        s.sort((a, b) => Math.abs(a[0]-px)+Math.abs(a[1]-py) - (Math.abs(b[0]-px)+Math.abs(b[1]-py)));
        return { kind: 'door', x: s[0][0], y: s[0][1] };
      }
    }
    if (allSealed || waterPolicy === 'off') return { kind: 'search' };
    /* A flat puddle has no gradient; resume searching rather than circling it. */
    return chooseVisibleWater(G.grid, G.wetArr, G.maskArr, know.visited, G.radar, px, py, onScreen) || { kind: 'search' };
  }

  /* Key steering along a path: the axis that moves toward the next waypoint,
     with the preference flipped when the last press moved nothing. Holding one
     axis jams the bot at corners a player slides around. */
  function steer(px, py, tx, ty){
    keys.w = keys.s = keys.a = keys.d = false;
    const dx = tx - px, dy = ty - py;
    const X = [dx > 0 ? 'd' : 'a', dx > 0 ? 1 : -1, 0];
    const Y = [dy > 0 ? 's' : 'w', 0, dy > 0 ? 1 : -1];
    const wantFirst = Math.abs(dx) > Math.abs(dy);
    const opts = (wantFirst !== swapped) ? [X, Y] : [Y, X];
    if (!movedLast) swapped = !swapped;
    movedLast = false;
    for (const [k2, ux, uy] of opts){
      if (Math.abs(ux*dx) + Math.abs(uy*dy) < 0.06) continue;
      if (!A.blocked(px + ux*0.15, py + uy*0.15, 0.33)){ keys[k2] = true; return; }
    }
    for (const [k2, ux, uy] of opts){
      if (Math.abs(ux*dx) + Math.abs(uy*dy) < 0.06) continue;
      if (!A.blocked(px + ux*0.2, py + uy*0.2, 0.30)){ keys[k2] = true; return; }
    }
  }

  /* The nearest awake lifeform, as a snapshot for tracing a death. */
  function nearestAwake(px, py){
    let best = null, bd = Infinity;
    for (const lf of G.lifeforms){
      if (lf.state === 'DORMANT') continue;
      const d = Math.hypot(lf.x - px, lf.y - py);
      if (d < bd){ bd = d; best = lf; }
    }
    if (!best) return { state: '-', d: Infinity, inView: false };
    return { state: best.state, x: best.x, y: best.y, d: +bd.toFixed(2),
      lineOfSight: G.los(best.x, best.y, px, py),
      inView: onScreen(best.x, best.y) && G.maskArr[IDX(Math.floor(best.x), Math.floor(best.y))] > (G.radar ? RADAR_SEE : SEE) };
  }

  /* The nearest lifeform the plumber knows about, by sight or by hearing. */
  function knownThreat(px, py){
    if (!withLifeforms) return null;
    let best = null, bd = Infinity;
    for (const lf of G.lifeforms){
      if (lf.state === 'DORMANT' || lf.rise <= 0.5) continue;
      const d = Math.hypot(lf.x - px, lf.y - py);
      const inView = onScreen(lf.x, lf.y) && G.maskArr[IDX(Math.floor(lf.x), Math.floor(lf.y))] > (G.radar ? RADAR_SEE : SEE);
      if ((inView || d <= WALK_HEARD) && d < bd){ bd = d; best = lf; }
    }
    return best && bd < THREAT ? { lf: best, d: bd } : null;
  }

  /* Runs after every game frame, however the frame was spent. Returns true
     when the run is over. A death rebuilds the floor, as a player's respawn does. */
  function afterTick(){
    if (A.STATE === 'play') return false;
    if (A.STATE === 'win'){ out.cleared = true; return true; }
    if (A.STATE === 'clear'){
      A.dismissClear();
      if (!withLifeforms) G.lifeforms.length = 0;
      path = null; pathGoal = ''; distFromKey = ''; distField = null;
      know = freshKnowledge(-1, 0); recent = []; searchFrames = 0;
      scanFrames = 0; scanClear = true; safeSprintUntil = 0;
      anchorX = -99; anchorY = -99; anchorAt = frames; jamSkip = 0; movedLast = false;
      return false;
    }
    if (A.STATE !== 'dead' || !deathCause) throw new Error('Unexpected bot run state: ' + A.STATE);
    const death = { floor: A.floorIdx + 1, frame: frames, cause: deathCause, recent: recent.slice() };
    out.deathLog.push(death);
    if (trace) trace({ event: 'death', ...death, recent: death.recent.filter((_, i) => i % 30 === 0) });
    recent = [];
    out.deaths++;
    if (deathCause === 'clock') out.clockOuts++;
    deathCause = null;
    if (A.lives <= 0){ out.why = 'out of lives on floor ' + (A.floorIdx + 1); return true; }
    A.retryFloor();
    if (!withLifeforms) G.lifeforms.length = 0;
    path = null; pathGoal = '';
    distFromKey = ''; distField = null; searchFrames = 0;
    scanFrames = 0; scanClear = true; safeSprintUntil = 0;
    anchorX = -99; anchorY = -99; anchorAt = frames; jamSkip = 0; movedLast = false;
    return false;
  }

  try {
  while (frames < maxFrames){
    frames++;
    updateViewport();
    look();
    const px = G.plumber.x, py = G.plumber.y;
    if (G.radar){
      scanFrames++;
      if (G.lifeforms.some(lf => onScreen(lf.x, lf.y) &&
          G.maskArr[IDX(Math.floor(lf.x), Math.floor(lf.y))] > RADAR_SEE &&
          Math.hypot(lf.x - px, lf.y - py) < SPRINT_CHECK_RANGE)) scanClear = false;
      if (scanClear && scanFrames >= SCAN_CONFIRM_FRAMES) safeSprintUntil = frames + SAFE_SPRINT_FRAMES;
      if (!scanClear) safeSprintUntil = 0;
    } else {
      scanFrames = 0; scanClear = true;
    }
    recent.push({ ...nearestAwake(px, py), px, py, clock: G.clock,
      radar: G.radar, battery: G.batt, stamina: G.plumber.stamina,
      moving: G.plumber.moving, sprint: !!keys.shift, action: lastAction,
      lifeforms: G.lifeforms.map(lf => ({ x: lf.x, y: lf.y, state: lf.state })) });
    keys.w = keys.s = keys.a = keys.d = false; keys.shift = false;
    if (recent.length > RECENT_FRAMES) recent.shift();

    if (trace && frames % 300 === 1){
      trace({ t: frames/60, floor: A.floorIdx, px: +px.toFixed(1), py: +py.toFixed(1), clock: +G.clock.toFixed(0),
        leaksKnown: know.leaks.filter(Boolean).length, leaks: G.leaks.length, open: G.leaks.filter(L=>!L.fixed).length,
        door: know.door, spawn: know.spawn, seenTiles: know.seen.reduce((a,b)=>a+b,0), goal: chooseGoal(px, py),
        radar: G.radar, battery: G.batt, stamina: G.plumber.stamina,
        moving: G.plumber.moving, nearest: recent[recent.length - 1],
        threat: !!knownThreat(px, py), lives: A.lives });
    }
    const threat = avoidancePolicy === 'flee' ? knownThreat(px, py) : null;
    const goal = threat ? null : chooseGoal(px, py);
    lastAction = threat ? 'avoid' : goal.kind;
    G.radar = false;
    if (threat){
      /* Step away from the threat to the walkable neighbour that puts most
         distance between them. Sprint while running. */
      keys.shift = true;
      const cx = Math.floor(px), cy = Math.floor(py);
      let best = null, bestD = threat.d;
      for (const [nx, ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]){
        if (G.grid[IDX(nx, ny)] !== TILE_TYPES.FLOOR) continue;
        const away = Math.hypot(nx + 0.5 - threat.lf.x, ny + 0.5 - threat.lf.y);
        if (away > bestD){ bestD = away; best = [nx + 0.5, ny + 0.5]; }
      }
      if (best) steer(px, py, best[0], best[1]);
    } else {
      if (radarPolicy === 'periodic' && goal.kind === 'search' && G.batt > 0){
        G.radar = searchFrames % RADAR_PERIOD < RADAR_FRAMES;
        searchFrames++;
      }

      /* Holding still is the game's own hold: repair when in reach of a known
         open leak, or wait at the door until it cycles. */
      if (goal.kind === 'leak' && A.leakReach(px, py) &&
          Math.hypot(px - (goal.x + 0.5), py - (goal.y + 0.5)) < 1.5){
        step();
        if (afterTick()) break;
        continue;
      }
      const door = G.exitTiles[0];
      if (goal.kind === 'door' && Math.hypot(door.x + 0.5 - px, door.y + 0.5 - py) < 1.25){
        lastAction = 'door-hold';
        step();
        if (afterTick()) break;
        continue;
      }

      const gid = goal.kind + ':' + (goal.x ?? '') + ',' + (goal.y ?? '');
      const cx = Math.floor(px), cy = Math.floor(py);
      const off = !path || Math.hypot(px - pathAt[0], py - pathAt[1]) > 2.5;
      /* A visited-tile search cannot finish merely because the tile is visible. */
      const last = path && path.length ? path[path.length - 1] : null;
      const searchDone = goal.kind === 'search' && last &&
        searchTargetDone(searchTarget, know.seen, know.visited, IDX(last[0], last[1]));
      if (gid !== pathGoal || off || searchDone || pathAge > REPLAN_FRAMES || !path || path.length === 0){
        if (goal.kind === 'search'){
          path = pathToNearest(px, py, c => G.grid[c] === TILE_TYPES.FLOOR && !know.seen[c]);
          searchTarget = path ? 'unseen' : 'unvisited';
          if (!path) path = pathToNearest(px, py, c => G.grid[c] === TILE_TYPES.FLOOR && !know.visited[c]);
        } else {
          const grid = returnPolicy === 'remembered' && (goal.kind === 'door' || goal.kind === 'spawn')
            ? know.walkable : G.grid;
          path = bfsPath(cx, cy, goal.x, goal.y, grid, W, H);
          if (goal.kind === 'door' || goal.kind === 'spawn') out.returnStats.replans++;
        }
        pathGoal = gid; pathAt = [px, py]; pathAge = 0; pathIndex = 1; jamSkip = 0;
      }
      pathAge++;

      if (!path){
        out.why = 'no walkable path for goal ' + goal.kind;
        break;
      }
      /* A door approach can be the current tile but still outside hold range. */
      if (path.length <= 1){
        if (goal.kind === 'door' && cx === goal.x && cy === goal.y){
          steer(px, py, goal.x + 0.5, goal.y + 0.5);
          const x = G.plumber.x, y = G.plumber.y;
          step();
          movedLast = Math.abs(G.plumber.x - x) + Math.abs(G.plumber.y - y) > 1e-6;
          if (afterTick()) break;
          continue;
        }
        path = null;
        step();
        if (afterTick()) break;
        continue;
      }
      /* Jammed at a corner: over a window the plumber has not gone a tile from
         where it was, so skip the waypoint it cannot reach. */
      if (frames - anchorAt > REPLAN_FRAMES){
        if (Math.hypot(px - anchorX, py - anchorY) < 1) jamSkip = 1;
        anchorX = px; anchorY = py; anchorAt = frames;
      }
      pathIndex = advanceWaypoint(path, pathIndex, px, py);
      if (jamSkip){ pathIndex = Math.min(pathIndex + 1, path.length - 1); jamSkip = 0; }
      const wp = path[pathIndex];
      steer(px, py, wp[0] + 0.5, wp[1] + 0.5);
      if (explorationPolicy === 'scan-sprint' && frames < safeSprintUntil && G.plumber.stamina > 0.5)
        keys.shift = true;
    }
    const bx0 = G.plumber.x, by0 = G.plumber.y;
    step();
    if (Math.abs(G.plumber.x - bx0) + Math.abs(G.plumber.y - by0) > 1e-6) movedLast = true;

    if (afterTick()) break;
  }
  } finally {
    unsubscribe();
    keys.w = keys.s = keys.a = keys.d = false; keys.shift = false;
  }
  out.floorsDone = Math.min(A.floorIdx, 5);
  out.seconds = frames / 60;
  if (!out.cleared && !out.why) out.why = frames >= maxFrames ? 'timeout on floor ' + (A.floorIdx + 1) : 'stopped on floor ' + (A.floorIdx + 1);
  return out;
}

/**
 * Names the cause reported by the game's death event.
 *
 * @param {{cause:'caught'|'clock'}} death
 * @returns {'caught'|'clock'}
 */
export function classifyDeath(death){
  return death.cause;
}
