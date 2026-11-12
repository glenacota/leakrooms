/* The player bot: a bot that plays with what a player can see and hear.

   It never reads the leak list or the door position before a player could have
   found them:
     - a leak is known once water shows beside its standing spot in view;
     - the door is known once it is in view (the vision mask);
     - a lifeform is known while it is in view, or while it is close enough to
       hear a walking plumber (WALK_HEARD);
     - floor tiles are known once they have been in view;
     - the radar is switched on only when the bot is stuck (its goal is a search:
       no leak known and no water in view) and the battery has charge.
   The game's own predicates still decide reach, repair and the door cycle, so a
   stricter or looser rule invented here would test a different game.

   Floors advance through the game's own path (the door calls nextFloor, which
   rebuilds from RUN_SEED), so the clock and the lives behave as they do for a
   player. */
import { bfsPath } from './bot.js';
import { FLOOR, MAP_H, MAP_W } from '../../src/config/constants.js';

const W = MAP_W, H = MAP_H, N = W * H;
const IDX = (x, y) => y * W + x;

const SEE = 0.2;          // vision-mask value that counts as in view
const WET = 0.05;         // wetness that reads as damp in view, close to a leak
const WATER_CLUE = 0.5;   // wetness that reads as water to follow; damp carpet near the start is not a clue
const LEAK_SIGHT = 2;     // tiles around a standing spot where water shows the leak
const WALK_HEARD = 6.6;   // tiles a walking plumber is heard: HEAR_BASE 4 + HEAR_GAIN * walk power, see constants.js
const THREAT = 9;         // tiles at which a known lifeform is worth stepping away from
const REPLAN_FRAMES = 90; // re-plan at least this often, so a stale path cannot stall the bot
const RECENT_FRAMES = 180; // three seconds of lifeform context kept for tracing a death
/* A lifeform this close has caught the plumber. The catches seen so far were
   about half a tile; one tile allows for a lifeform's step between frames. */
export const CAUGHT_TILES = 1;

function freshKnowledge(floor, leakCount){
  return { floor, door: false, leaks: new Array(leakCount).fill(false), seen: new Uint8Array(N) };
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
 * @param {function} [o.trace] - called every 5 game seconds with what the bot knows.
 * @returns {{cleared:boolean, floorsDone:number, deaths:number, clockOuts:number,
 *   seconds:number, why:string, deathLog:Array}} deathLog holds one snapshot per death
 *   for classifyDeath().
 */
export function playPlayerRun({ A, G, keys, seed, withLifeforms, maxSeconds, trace }){
  const out = { cleared: false, floorsDone: 0, deaths: 0, clockOuts: 0, seconds: 0, why: '', deathLog: [] };
  const maxFrames = Math.round(60 * maxSeconds);

  A.RUN_SEED = seed;
  A.floorIdx = 0;
  A.runTime = 0;
  A.buildFloor(0, seed);
  A.STATE = 'play';

  let know = freshKnowledge(-1, 0);
  let path = null, pathGoal = '', pathAt = [-99, -99], pathAge = 0;
  let swapped = false, movedLast = false;
  let distFromKey = '', distField = null;
  let frames = 0;
  let jamSkip = 0, anchorX = -99, anchorY = -99, anchorAt = 0;
  let recent = []; // the nearest awake lifeform, for the last RECENT_FRAMES frames

  /* What the player has seen so far on this floor. Called once per frame. */
  function look(){
    if (know.floor !== A.floorIdx){
      know = freshKnowledge(A.floorIdx, G.leaks.length);
      path = null;
    }
    const m = G.maskArr;
    for (let i = 0; i < N; i++) if (m[i] > SEE) know.seen[i] = 1;
    /* The tile under the plumber is always drawn, even behind the vision cone,
       so standing on a tile is seeing it. Without this a tile directly behind
       the plumber is reached and never counts as searched. */
    know.seen[IDX(Math.floor(G.plumber.x), Math.floor(G.plumber.y))] = 1;

    const door = G.exitTiles[0];
    if (!know.door && A.fixtureVis(door) > SEE) know.door = true;

    G.leaks.forEach((L, k) => {
      if (know.leaks[k] || L.fixed) return;
      for (let dy = -LEAK_SIGHT; dy <= LEAK_SIGHT; dy++)
        for (let dx = -LEAK_SIGHT; dx <= LEAK_SIGHT; dx++){
          const x = L.sx + dx, y = L.sy + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          if (m[IDX(x, y)] > SEE && A.wetAt(x, y) > WET) know.leaks[k] = true;
        }
    });
  }

  /* Walking distances from the plumber's tile, cached while it stays near. */
  function distancesFrom(tx, ty){
    const key = tx + ',' + ty;
    if (key === distFromKey) return distField;
    const dist = new Int32Array(N).fill(-1);
    const start = IDX(tx, ty);
    if (G.grid[start] !== FLOOR) return (distField = null);
    const q = [start]; dist[start] = 0;
    for (let h = 0; h < q.length; h++){
      const c = q[h], cx = c % W, cy = (c / W) | 0;
      for (const [nx, ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]){
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = IDX(nx, ny);
        if (G.grid[ni] !== FLOOR || dist[ni] >= 0) continue;
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
    if (G.grid[start] !== FLOOR) return null;
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
        if (G.grid[ni] !== FLOOR || prev[ni] >= 0) continue;
        prev[ni] = c; q.push(ni);
      }
    }
    return null;
  }

  /* The walkable tiles beside the door, nearest first. */
  function doorStands(){
    const e = G.exitTiles[0];
    return [[e.x+1,e.y],[e.x-1,e.y],[e.x,e.y+1],[e.x,e.y-1]]
      .filter(([x,y]) => x >= 0 && y >= 0 && x < W && y < H && G.grid[IDX(x,y)] === FLOOR);
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
      const s = doorStands();
      if (s.length){
        s.sort((a, b) => Math.abs(a[0]-px)+Math.abs(a[1]-py) - (Math.abs(b[0]-px)+Math.abs(b[1]-py)));
        return { kind: 'door', x: s[0][0], y: s[0][1] };
      }
    }
    /* Water in view is the clue to a leak nobody has reached yet. Follow the
       deepest visible water, nearest first among equals. Once the standing spot
       is in view the leak is known and the branch above takes over. */
    const m = G.maskArr;
    let wetBest = null, wetVal = 0, wetD = Infinity;
    for (let i = 0; i < N; i++){
      if (m[i] <= SEE) continue;
      const x = i % W, y = (i / W) | 0;
      const v = A.wetAt(x, y);
      if (v <= WATER_CLUE) continue;
      const d = Math.abs(x + 0.5 - px) + Math.abs(y + 0.5 - py);
      if (v > wetVal + 1e-6 || (Math.abs(v - wetVal) <= 1e-6 && d < wetD)){
        wetVal = v; wetD = d; wetBest = [x, y];
      }
    }
    if (wetBest) return { kind: 'water', x: wetBest[0], y: wetBest[1] };
    return { kind: 'search' };
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
    return { state: best.state, d: +bd.toFixed(2),
      inView: G.maskArr[IDX(Math.floor(best.x), Math.floor(best.y))] > SEE };
  }

  /* The nearest lifeform the plumber knows about, by sight or by hearing. */
  function knownThreat(px, py){
    if (!withLifeforms) return null;
    let best = null, bd = Infinity;
    for (const lf of G.lifeforms){
      if (lf.state === 'DORMANT' || lf.rise <= 0.5) continue;
      const d = Math.hypot(lf.x - px, lf.y - py);
      const inView = G.maskArr[IDX(Math.floor(lf.x), Math.floor(lf.y))] > SEE;
      if ((inView || d <= WALK_HEARD) && d < bd){ bd = d; best = lf; }
    }
    return best && bd < THREAT ? { lf: best, d: bd } : null;
  }

  /* Runs after every game frame, however the frame was spent. Returns true
     when the run is over. A death rebuilds the floor, as a player's respawn does. */
  function afterTick(){
    if (A.STATE === 'play') return false;
    if (A.floorIdx >= 5){ out.cleared = true; return true; }
    out.deathLog.push({ floor: A.floorIdx + 1, frame: frames, clockOut: G.clock <= 0, recent: recent.slice() });
    recent = [];
    out.deaths++;
    if (G.clock <= 0) out.clockOuts++;
    if (A.lives <= 0){ out.why = 'out of lives on floor ' + (A.floorIdx + 1); return true; }
    A.buildFloor(A.floorIdx, seed);
    A.STATE = 'play';
    path = null; pathGoal = ''; know = freshKnowledge(-1, 0);
    return false;
  }

  while (frames < maxFrames){
    frames++;
    look();
    const px = G.plumber.x, py = G.plumber.y;
    keys.w = keys.s = keys.a = keys.d = false; keys.shift = false;
    G.radar = false;
    recent.push(nearestAwake(px, py));
    if (recent.length > RECENT_FRAMES) recent.shift();

    if (trace && frames % 300 === 1){
      trace({ t: frames/60, floor: A.floorIdx, px: +px.toFixed(1), py: +py.toFixed(1), clock: +G.clock.toFixed(0),
        leaksKnown: know.leaks.filter(Boolean).length, leaks: G.leaks.length, open: G.leaks.filter(L=>!L.fixed).length,
        door: know.door, seenTiles: know.seen.reduce((a,b)=>a+b,0), goal: chooseGoal(px, py).kind });
    }
    const threat = knownThreat(px, py);
    if (threat){
      /* Step away from the threat to the walkable neighbour that puts most
         distance between them. Sprint while running. */
      keys.shift = true;
      const cx = Math.floor(px), cy = Math.floor(py);
      let best = null, bestD = threat.d;
      for (const [nx, ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]){
        if (G.grid[IDX(nx, ny)] !== FLOOR) continue;
        const away = Math.hypot(nx + 0.5 - threat.lf.x, ny + 0.5 - threat.lf.y);
        if (away > bestD){ bestD = away; best = [nx + 0.5, ny + 0.5]; }
      }
      if (best) steer(px, py, best[0], best[1]);
    } else {
      const goal = chooseGoal(px, py);

      /* The radar is the last resort. It goes on only when stuck (a search goal:
         no leak known, no water in view) and the battery has charge. A live radar
         pings the floor at NOISE.RADAR, so it can wake lifeforms, and the battery
         drains at RADAR_DRAIN until the game switches it off. */
      if (goal.kind === 'search' && G.batt > 0) G.radar = true;

      /* Holding still is the game's own hold: repair when in reach of a known
         open leak, or wait at the door until it cycles. */
      if (goal.kind === 'leak' && A.leakReach(px, py) &&
          Math.hypot(px - (goal.x + 0.5), py - (goal.y + 0.5)) < 1.5){
        A.updateReal(1/60);
        if (afterTick()) break;
        continue;
      }
      const door = G.exitTiles[0];
      if (goal.kind === 'door' && Math.hypot(door.x + 0.5 - px, door.y + 0.5 - py) < 1.25){
        A.updateReal(1/60);
        if (afterTick()) break;
        continue;
      }

      const gid = goal.kind + ':' + (goal.x ?? '') + ',' + (goal.y ?? '');
      const cx = Math.floor(px), cy = Math.floor(py);
      const off = !path || Math.hypot(px - pathAt[0], py - pathAt[1]) > 2.5;
      /* A search path is done when its target is reached or seen: the next
         unseen tile is then picked, not the old one walked to again. */
      const last = path && path.length ? path[path.length - 1] : null;
      const searchDone = goal.kind === 'search' && last &&
        (know.seen[IDX(last[0], last[1])] || Math.hypot(px - (last[0] + 0.5), py - (last[1] + 0.5)) < 0.6);
      if (gid !== pathGoal || off || searchDone || pathAge > REPLAN_FRAMES || !path || path.length === 0){
        if (goal.kind === 'search'){
          path = pathToNearest(px, py, c => G.grid[c] === FLOOR && !know.seen[c]);
        } else {
          path = bfsPath(cx, cy, goal.x, goal.y, G.grid, W, H);
        }
        pathGoal = gid; pathAt = [px, py]; pathAge = 0; jamSkip = 0;
      }
      pathAge++;

      if (!path){
        out.why = 'no walkable path for goal ' + goal.kind;
        break;
      }
      /* Arrived at a search target: it is seen now, so the next frame picks the
         next unseen tile. */
      if (path.length <= 1){
        path = null;
        A.updateReal(1/60);
        if (afterTick()) break;
        continue;
      }
      /* Jammed at a corner: over a window the plumber has not gone a tile from
         where it was, so skip the waypoint it cannot reach. */
      if (frames - anchorAt > REPLAN_FRAMES){
        if (Math.hypot(px - anchorX, py - anchorY) < 1) jamSkip++;
        anchorX = px; anchorY = py; anchorAt = frames;
      }
      let wi = 1 + jamSkip;
      while (wi < path.length - 1 &&
             Math.hypot(path[wi][0] + 0.5 - px, path[wi][1] + 0.5 - py) < 0.45) wi++;
      if (wi > path.length - 1) wi = path.length - 1;
      const wp = path[wi];
      steer(px, py, wp[0] + 0.5, wp[1] + 0.5);
    }

    const bx0 = G.plumber.x, by0 = G.plumber.y;
    A.updateReal(1/60);
    if (Math.abs(G.plumber.x - bx0) + Math.abs(G.plumber.y - by0) > 1e-6) movedLast = true;

    if (afterTick()) break;
  }

  keys.w = keys.s = keys.a = keys.d = false; keys.shift = false;
  out.floorsDone = Math.min(A.floorIdx, 5);
  out.seconds = frames / 60;
  if (!out.cleared && !out.why) out.why = frames >= maxFrames ? 'timeout on floor ' + (A.floorIdx + 1) : 'stopped on floor ' + (A.floorIdx + 1);
  return out;
}

/**
 * Names the cause of one death from the snapshot playPlayerRun records.
 * 'caught': an awake lifeform was within CAUGHT_TILES in the last three seconds.
 * 'clock': the floor clock ran out and no lifeform was that close.
 * 'unexplained': neither. Those deaths need a closer look at the trace.
 *
 * @param {{clockOut:boolean, recent:Array<{d:number}>}} death
 * @returns {'caught'|'clock'|'unexplained'}
 */
export function classifyDeath(death){
  if (death.recent.some(x => x.d <= CAUGHT_TILES)) return 'caught';
  if (death.clockOut) return 'clock';
  return 'unexplained';
}
