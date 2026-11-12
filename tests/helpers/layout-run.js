/* The omniscient layout run: walks every floor of one run with the bot that
   reads the leak list and the door. Shared by the per-run layout test files, so
   each file only states its preset and seed. */
import { bfsPath } from './bot.js';
import { DIFFICULTIES } from '../../src/config/presets.js';
import { applyDifficulty } from '../../src/config/tuning.js';

const W = 76, H = 76, IDX = (x, y) => y*W + x;

/**
 * Walks every floor with the omniscient bot under one preset and seed.
 *
 * @param {string} preset - key of DIFFICULTIES.
 * @param {number} seed - base seed; each floor derives its own from it.
 * @returns {{walked:number, sealed:number, total:number, clockOuts:number, why:string}}
 */
export function playLayout(A, G, preset, seed){
  const buildFloor = A.buildFloor;
  applyDifficulty(DIFFICULTIES[preset]);
  const res = { walked: 0, sealed: 0, total: 0, clockOuts: 0, why: '' };
  const distFieldCache = new Map();

  /* Walking distances from one tile, cached per floor. */
  function distField(gx, gy){
    const key = `${A.floorIdx},${gx},${gy}`;
    if (distFieldCache.has(key)) return distFieldCache.get(key);
    const dist = new Int32Array(W*H).fill(-1);
    const g0 = IDX(gx|0, gy|0);
    if (gx < 0 || gy < 0 || gx >= W || gy >= H || G.grid[g0] !== 1) return null;
    const q = [g0]; dist[g0] = 0;
    for (let h = 0; h < q.length; h++){
      const c = q[h], cx = c % W, cy = (c / W) | 0;
      for (const [nx, ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]){
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = IDX(nx, ny);
        if (G.grid[ni] !== 1 || dist[ni] >= 0) continue;
        dist[ni] = dist[c] + 1; q.push(ni);
      }
    }
    distFieldCache.set(key, dist);
    return dist;
  }

  /* The walkable tile beside the door nearest the plumber: the door is a wall. */
  function doorGoal(door){
    const cand = [[door.x+1,door.y],[door.x-1,door.y],[door.x,door.y+1],[door.x,door.y-1]]
      .filter(([x,y]) => x >= 0 && y >= 0 && x < W && y < H && G.grid[IDX(x,y)] === 1);
    if (!cand.length) return null;
    const px = G.plumber.x, py = G.plumber.y;
    let b = cand[0], bd = Infinity;
    for (const [cx, cy] of cand){
      const d = Math.abs(cx - px) + Math.abs(cy - py);
      if (d < bd){ bd = d; b = [cx, cy]; }
    }
    return { x: b[0], y: b[1] };
  }

  for (let s = 0; s < A.LEVELS_N; s++){
    buildFloor(s, seed + s*4441 + 13);
    A.STATE = 'play';
    A.floorIdx = 0;
    G.lifeforms.length = 0;
    res.total += G.leaks.length;

    const door = G.exitTiles[0];
    const maxFrames = 60 * (DIFFICULTIES[preset].clock + 30);
    let path = null, wi = 0, fromX = -99, fromY = -99;
    let swapped = false, movedLast = false, goalId = -1;
    let fromHere = null, fromX0 = -99, fromY0 = -99, lastRiserKey = '';
    let descended = false, frames = 0, sealedNow = 0, allSealed = false;
    let anchorX = -99, anchorY = -99, anchorAt = 0;

    while (frames < maxFrames && !descended){
      frames++;
      /* Snapshot before any update: the frame that cycles the door rebuilds G
         for the next floor, so counts read after it belong to the wrong floor. */
      sealedNow = G.leaks.filter(l => l.fixed).length;
      allSealed = sealedNow === G.leaks.length;
      const px = G.plumber.x, py = G.plumber.y;
      A.keys.w = A.keys.s = A.keys.a = A.keys.d = false; A.keys.shift = false;

      /* One goal at a time: the nearest open leak, else the door. Recomputed each
         frame, so a seal mid-walk hands over to the next leak at once. */
      const open = G.leaks.filter(L => !L.fixed);
      let best = null, riserGoal = null;
      if (open.length){
        if (!fromHere || Math.hypot(px - fromX0, py - fromY0) > 4){
          fromHere = distField(Math.floor(px), Math.floor(py));
          fromX0 = px; fromY0 = py;
        }
        let bd = Infinity;
        for (const L of open){
          const f = fromHere ? fromHere[IDX(L.sx, L.sy)] : -1;
          const d = f >= 0 ? f : 9999;
          if (d < bd){ bd = d; best = L; }
        }
        if (best){
          const rk = best.sx + ',' + best.sy;
          if (rk !== lastRiserKey){ lastRiserKey = rk; goalId = -1; }
          riserGoal = { x: best.sx, y: best.sy };
        }
      }
      const goal = riserGoal || doorGoal(door);
      if (!goal){ res.why = 'no goal tile on level ' + (s+1); break; }
      if (IDX(goal.x, goal.y) !== goalId){ goalId = IDX(goal.x, goal.y); path = null; }

      /* Holds are the game's own: repair at a leak in reach, the door cycle at
         the door. The reach and door predicates are the game's, not a tighter
         radius invented here. */
      if (!best && Math.hypot(door.x + 0.5 - px, door.y + 0.5 - py) < 1.25){
        A.updateReal(1/60);
        /* The door cycle moves the game to its level-clear state. That is the
           goal, not a loss, so it is checked first and the state is put back. */
        if (A.floorIdx > 0){ descended = true; if (A.STATE !== 'play') A.STATE = 'play'; continue; }
        if (A.STATE !== 'play'){ res.why = 'lost the floor on the door hold, level ' + (s+1); break; }
        continue;
      }
      if (best && A.leakReach(px, py)){
        A.updateReal(1/60);
        if (A.STATE !== 'play'){ res.why = 'lost the floor while repairing, level ' + (s+1); break; }
        continue;
      }

      const stale = !path || wi >= path.length || Math.hypot(px - fromX, py - fromY) > 2.5;
      if (stale){
        fromX = px; fromY = py;
        path = bfsPath(Math.floor(px), Math.floor(py), goal.x, goal.y, G.grid, W, H);
        wi = 0;
      }
      if (!path){ res.why = 'no path on level ' + (s+1); break; }
      while (wi < path.length - 1 && Math.hypot(path[wi][0] + 0.5 - px, path[wi][1] + 0.5 - py) < 0.45) wi++;
      /* Jammed: over a window of frames the plumber has not gone a tile from
         where it was. Jitter at a corner looks like movement frame to frame, so
         the check is on net distance over time. Skip the waypoint it cannot reach. */
      if (frames - anchorAt > 90){
        if (Math.hypot(px - anchorX, py - anchorY) < 1 && path && wi < path.length - 1) wi++;
        anchorX = px; anchorY = py; anchorAt = frames;
      }
      const wp = path.length ? path[Math.min(wi, path.length - 1)] : [goal.x, goal.y];
      const dx = (wp[0] + 0.5) - px, dy = (wp[1] + 0.5) - py;

      /* A lookahead that refuses to press into a wall, and a flipped axis
         preference when the last press moved nothing. */
      const X = [dx > 0 ? 'd' : 'a', dx > 0 ? 1 : -1, 0];
      const Y = [dy > 0 ? 's' : 'w', 0, dy > 0 ? 1 : -1];
      const wantFirst = Math.abs(dx) > Math.abs(dy);
      const opts = (wantFirst !== swapped) ? [X, Y] : [Y, X];
      if (!movedLast) swapped = !swapped;
      movedLast = false;
      let moved = false;
      for (const [k2, ux, uy] of opts){
        if (Math.abs(ux*dx) + Math.abs(uy*dy) < 0.06) continue;
        if (!A.blocked(px + ux*0.15, py + uy*0.15, 0.33)){ A.keys[k2] = true; moved = true; break; }
      }
      if (!moved){
        for (const [k2, ux, uy] of opts){
          if (Math.abs(ux*dx) + Math.abs(uy*dy) < 0.06) continue;
          if (!A.blocked(px + ux*0.2, py + uy*0.2, 0.30)){ A.keys[k2] = true; break; }
        }
      }
      const bx0 = G.plumber.x, by0 = G.plumber.y;
      A.updateReal(1/60);
      if (Math.abs(G.plumber.x - bx0) + Math.abs(G.plumber.y - by0) > 1e-6) movedLast = true;
      if (A.floorIdx > 0){ descended = true; if (A.STATE !== 'play') A.STATE = 'play'; continue; }
      if (A.STATE !== 'play'){
        if (G.clock <= 0) res.clockOuts++;
        res.why = (G.clock <= 0 ? 'clock ran out' : 'lost the floor') + ' on level ' + (s+1);
        break;
      }
    }

    if (descended && allSealed) res.walked++;
    res.sealed += sealedNow;
    if (!descended && !res.why) res.why = 'timeout on level ' + (s+1);
    if (!descended) break;
  }
  A.keys.w = A.keys.s = A.keys.a = A.keys.d = false; A.keys.shift = false;
  return res;
}
