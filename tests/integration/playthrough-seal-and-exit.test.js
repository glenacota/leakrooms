import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';
import { bfsPath } from '../helpers/bot.js';

const { A, G } = await loadGame();
const buildFloor = A.buildFloor;
const update = A.update;
const blocked = A.blocked;
const keys = A.keys;

/* Every level has to be completable through the real update() with real key
   state, so this drives the bot at one riser, then the next, then the door.
   All five are walked because the level table is the thing under test: a level
   that is unreachable where its neighbour is fine only shows up here. */
test('the bot seals every riser, then walks back out the door', () => {
  const t = softAssert();
  const W=76, H=76, IDX=(x,y)=>y*W+x;

  // Cache for distance fields in this test: key = "floorIdx,goalX,goalY"
  const distFieldCache = new Map();

  /* The door is a wall tile, so the bot cannot path to it. It paths to the
     floor tile beside it, which is how the game decides you are close enough
     to cycle the door. */
  function doorGoal(door){
    const cand=[[door.x+1,door.y],[door.x-1,door.y],[door.x,door.y+1],[door.x,door.y-1]]
      .filter(([x,y])=>x>=0&&y>=0&&x<W&&y<H&&G.grid[IDX(x,y)]===1);
    if(!cand.length) return null;
    const px=G.plumber.x, py=G.plumber.y;
    let b=cand[0], bd=Infinity;
    for(const [cx,cy] of cand){
      const d=Math.abs(cx-px)+Math.abs(cy-py);
      if(d<bd){ bd=d; b=[cx,cy]; }
    }
    return {x:b[0], y:b[1], tile:IDX(b[0],b[1])};
  }

  /* Distance field from a tile — walking distance, not Euclidean. */
  function distField(gx,gy){
    const cacheKey = `${A.floorIdx},${gx},${gy}`;
    if (distFieldCache.has(cacheKey)) return distFieldCache.get(cacheKey);
    const dist=new Int32Array(W*H).fill(-1);
    const g0=IDX(gx|0,gy|0);
    if(gx<0||gy<0||gx>=W||gy>=H||G.grid[g0]!==1) return null;
    const q=[g0]; dist[g0]=0;
    for(let h=0;h<q.length;h++){
      const c=q[h],cx=c%W,cy=(c/W)|0;
      const nb=[[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]];
      for(const [nx,ny] of nb){
        if(nx<0||ny<0||nx>=W||ny>=H) continue;
        const ni=IDX(nx,ny);
        if(G.grid[ni]!==1||dist[ni]>=0) continue;
        dist[ni]=dist[c]+1; q.push(ni);
      }
    }
    distFieldCache.set(cacheKey, dist);
    return dist;
  }

  const distTo=(f,tile)=> f ? (f[tile]>=0?f[tile]:9999) : 9999;

  // All five, because the level table is the thing under test.
  let arrived=0, descended=0, noPath=0, risersSealed=0, risersWanted=0;
  for (let s=0; s<A.LEVELS_N; s++){
    buildFloor(s, s*4441+13);
    distFieldCache.clear();
    if (G.lifeforms.length) G.lifeforms.length=0;
    A.STATE='play';
    A.floorIdx=0; A.lives=3;
    risersWanted += G.leaks.length;

    let path=null, wi=0, fromX=-99, fromY=-99, done=false;
    let swapped=false, hasMovedLastFrame=false;
    let goal=null, goalId=-1;
    let frames=0;
    let sealedThisLevel=0, allSealed=false;
    let fromHere=null, fromX0=-99, fromY0=-99, lastRiserKey='';
    const f0 = A.floorIdx;
    const door=G.exitTiles[0];

    while (frames < 60*210 && !done){
      frames++;
      const px=G.plumber.x, py=G.plumber.y;
      keys.w=keys.s=keys.a=keys.d=false; keys.shift=false;

      /* One goal at a time: the nearest open riser, or the door once the work is
         done. Recomputed every frame, so a riser sealing mid-walk hands the
         level straight to the next one. A stale cached goal would break that. */
      const open = G.leaks.filter(L=>!L.fixed);
      let best=null, riserGoal=null;
      if (open.length){
        if (!fromHere || Math.hypot(px-fromX0, py-fromY0) > 4){
          fromHere = distField(Math.floor(px), Math.floor(py));
          fromX0 = px; fromY0 = py;
        }
        let bd=Infinity;
        for(const L of open){
          const d = distTo(fromHere, IDX(L.sx, L.sy));
          if (d<bd){ bd=d; best=L; }
        }
        if (best){
          const rk = best.sx+','+best.sy;
          if (rk !== lastRiserKey){ lastRiserKey = rk; goalId=-1; }
          riserGoal={x:best.sx, y:best.sy};
        }
      }
      goal = riserGoal || doorGoal(door);
      if (!goal){ noPath++; break; }
      if (IDX(goal.x,goal.y)!==goalId){ goalId=IDX(goal.x,goal.y); path=null; }

      /* On arrival, stop and let the update run: the repair and the door are both
         holds, not walks. Both use the game's own predicates, so a tighter
         radius invented here would test a stricter game than the one that
         ships. */
      if (!best && Math.hypot(door.x+0.5-px, door.y+0.5-py) < 1.25){
        /* Snapshotted before the update. The frame the door cycles, nextFloor()
           rebuilds G for the next level, so anything read afterwards belongs to
           a level this bot has not played. */
        sealedThisLevel = G.leaks.filter(l=>l.fixed).length;
        allSealed = sealedThisLevel===G.leaks.length;
        update(1/60);
        if (A.STATE!=='play') A.STATE='play';
        if (A.floorIdx>f0){
          done=true; descended++;
          risersSealed += sealedThisLevel;
          if (allSealed) arrived++;
        }
        continue;
      }
      if (best && A.leakReach(px, py)){
        update(1/60);
        if (A.STATE!=='play') A.STATE='play';
        continue;
      }

      const stale = !path || wi>=path.length ||
                    Math.hypot(px-fromX, py-fromY) > 2.5;
      if (stale){ fromX=px; fromY=py; path=bfsPath(Math.floor(px),Math.floor(py),goal.x,goal.y, G.grid, W, H); wi=0; }
      if (!path){ noPath++; break; }
      while (wi<path.length-1 && Math.hypot(path[wi][0]+0.5-px, path[wi][1]+0.5-py) < 0.45) wi++;
      /* bfsPath returns [] when the player is already on the goal tile, which is
         arrival rather than failure. Standing still is right anyway: the leak
         reach and the 1.25-tile door check both run at the top of the next
         frame. */
      const wp = path.length ? path[Math.min(wi,path.length-1)] : [goal.x, goal.y];
      const dx=(wp[0]+0.5)-px, dy=(wp[1]+0.5)-py;

      /* Two things make this walk a maze: a lookahead that refuses to press into
         a wall, and flipping the axis preference when the last press moved
         nothing. Pressing one axis blindly just jams against a partition. */
      const X=[dx>0?'d':'a', dx>0?1:-1, 0];
      const Y=[dy>0?'s':'w', 0, dy>0?1:-1];
      const wantFirst = Math.abs(dx)>Math.abs(dy);
      const opts = (wantFirst!==swapped) ? [X,Y] : [Y,X];
      if(!hasMovedLastFrame) swapped=!swapped;
      hasMovedLastFrame=false;
      let moved=false;
      for (const [k2,ux,uy] of opts){
        if (Math.abs(ux*dx)+Math.abs(uy*dy) < 0.06) continue;
        if (!blocked(px+ux*0.15, py+uy*0.15, 0.33)){ keys[k2]=true; moved=true; break; }
      }
      if (!moved){
        for (const [k2,ux,uy] of opts){
          if (Math.abs(ux*dx)+Math.abs(uy*dy) < 0.06) continue;
          if (!blocked(px+ux*0.2, py+uy*0.2, 0.30)){ keys[k2]=true; break; }
        }
      }
      const bx0=G.plumber.x, by0=G.plumber.y;
      update(1/60);
      if (Math.abs(G.plumber.x-bx0)+Math.abs(G.plumber.y-by0) > 1e-6) hasMovedLastFrame=true;
      if (A.STATE!=='play') A.STATE='play';       // respawn on death, keep trying
    }
    if (process.env.V) console.log(`     level ${s}: ${frames} frames, ${sealedThisLevel} leaks, ${allSealed?'all sealed':'LEFT OPEN'}`);
  }
  keys.w=keys.s=keys.a=keys.d=false; keys.shift=false;
  t.assert(noPath===0, `${noPath} legs had no path — the objective is unreachable`);
  t.assert(arrived===A.LEVELS_N, `the bot sealed every riser on ${arrived}/${A.LEVELS_N} levels`);
  t.assert(risersSealed===risersWanted,
    `${risersSealed}/${risersWanted} leaks were sealed — the tallies do not agree`);
  t.assert(descended===A.LEVELS_N, `the bot walked back out on ${descended}/${A.LEVELS_N} levels`);
  console.log(`  bot: ${risersSealed} leaks sealed, ${descended}/${A.LEVELS_N} levels walked back out`);
  A.floorIdx=0;;
});