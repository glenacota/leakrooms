import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';
import { makeInWall } from '../helpers/oracles.js';
const { A, G } = await loadGame();
const buildFloor = A.buildFloor;
const update = A.update;
const blocked = A.blocked;
const keys = A.keys;
const seededRNG = A.mulberry32(0xC0FFEE);
const inWall = makeInWall(G);
A.setHeadless(false, false);

/* ============ TEST 2: player is never soft-locked in geometry ============ */
test('[2] collision — 20000 random walks must not enter walls', () => {
  const t = softAssert();
console.log('[2] collision — 20000 random walks must not enter walls');
{
  buildFloor(0, 999);
  let inside=0;
  for (let i=0;i<20000;i++){
    keys['w']=seededRNG()<0.34; keys['a']=seededRNG()<0.34;
    keys['s']=seededRNG()<0.34; keys['d']=seededRNG()<0.34;
    update(0.016);
    keys.w=keys.a=keys.s=keys.d=false;
    if (inWall(G.player.x, G.player.y, 0.33, true)) inside++;
    if (!Number.isFinite(G.player.x) || !Number.isFinite(G.player.y)) { inside += 1000; break; }
  }
  t.assert(inside===0, `${inside} frames with player inside geometry / NaN`);
  console.log('  player never penetrated geometry, no NaN');
}
  t.done();
});

/* ============ TEST 6: configuration-space connectivity =============
   Tile connectivity is NOT the same as navigability: a 1-wide corridor can be
   connected on the grid yet still trap a disc of the player's radius. This
   samples the player's collision disc across free space at 1/4-tile
   resolution and flood-fills it. If every free position is reachable from
   the spawn, then no position on the map can soft-lock the player.        */
test('[6] config-space connectivity — 25 floors at 1/4-tile resolution', () => {
  const t = softAssert();
console.log('[6] config-space connectivity — 25 floors at 1/4-tile resolution');
{
  const STEP=0.25, R=0.33;
  const NX=Math.floor(76/STEP), NY=Math.floor(76/STEP);
  let trappedTotal=0, cellsTotal=0;
  for (let f=0; f<25; f++){
    buildFloor(f, 50000+f*613);
    const free=new Uint8Array(NX*NY);
    for (let j=0;j<NY;j++) for (let i=0;i<NX;i++){
      const x=(i+0.5)*STEP, y=(j+0.5)*STEP;
      free[j*NX+i] = blocked(x,y,R) ? 0 : 1;
    }
    cellsTotal += free.reduce((a,b)=>a+b,0);

    // spawn: nearest free sample to the true player position
    const si=Math.floor(G.player.x/STEP), sj=Math.floor(G.player.y/STEP);
    let start=-1, best=1e9;
    for (let j=0;j<NY;j++) for (let i=0;i<NX;i++){
      if (!free[j*NX+i]) continue;
      const d=(i-si)*(i-si)+(j-sj)*(j-sj);
      if (d<best){ best=d; start=j*NX+i; }
    }
    t.assert(start>=0, `floor ${f}: spawn has no free disc position at all`);
    if (start<0) continue;

    const seen=new Uint8Array(NX*NY);
    const q=[start]; seen[start]=1; let reached=0;
    for (let h=0; h<q.length; h++){
      const c=q[h]; reached++;
      const i=c%NX, j=(c/NX)|0;
      const nb=[[i+1,j],[i-1,j],[i,j+1],[i,j-1]];
      for (const [ni,nj] of nb){
        if (ni<0||nj<0||ni>=NX||nj>=NY) continue;
        const n=nj*NX+ni;
        if (free[n] && !seen[n]){ seen[n]=1; q.push(n); }
      }
    }
    const totalFree=free.reduce((a,b)=>a+b,0);
    const unreachable=totalFree-reached;
    if (unreachable>0){
      trappedTotal+=unreachable;
      // locate one trapped pocket for the message
      for (let k=0;k<free.length;k++){
        if (free[k] && !seen[k]){
          const i=k%NX, j=(k/NX)|0;
          console.log(`  floor ${f}: ${unreachable} free positions unreachable. First at `+
                      `(${(i*STEP).toFixed(2)},${(j*STEP).toFixed(2)})`);
          let g='';
          for (let y=j-6;y<=j+6;y++){ let r='';
            for (let x=i-6;x<=i+6;x++){
              r += (x<0||y<0||x>=NX||y>=NY)? '!' : (free[y*NX+x]?'.':'#'); }
            g+=r+'\n'; }
          console.log(g);
          break;
        }
      }
    }
  }
  console.log(`  ${cellsTotal} free disc positions sampled across 25 floors`);
  t.assert(trappedTotal===0, `${trappedTotal} positions are legal but unreachable — the player can soft-lock there`);
}
  t.done();
});

/* ============ TEST 9: wall contact must not accelerate ===============
   The corner assist used a fixed 0.30-tile perpendicular nudge, applied every
   frame. Holding into a wall therefore slid the avatar sideways at ~18 tiles
   per second — it looked like the player sped up on contact. The nudge must be
   bounded by the step, so pressing into a wall can never move you faster
   along the wall than you move normally.                                     */
test('[9] wall contact does not accelerate the avatar', () => {
  const t = softAssert();
console.log('[9] wall contact does not accelerate the avatar');
{
  buildFloor(3, 8642);
  const keys = A.keys;

  // walk into the nearest wall for a second and measure lateral drift
  let best=null;
  for (let y=2;y<74 && !best;y++) for (let x=2;x<74;x++){
    if (G.grid[y*76+x]!==1) continue;
    if (G.grid[(y+1)*76+x]!==0) continue;      // wall below
    best={x:x+0.5, y:y+0.5}; break;
  }
  t.assert(best, 'no wall-adjacent tile found');
  if (!best){ keys.w=keys.a=keys.s=keys.d=false; }
  else {
    G.player.x=best.x; G.player.y=best.y;
    for(let i=0;i<5;i++) update(1/60);
    const y0=G.player.y, x0=G.player.x;
    keys.s=true;                                  // push down into the wall
    for(let i=0;i<60;i++) update(1/60);           // one second
    keys.s=false;
    const drift = Math.abs(G.player.y - y0);
    const creep = Math.abs(G.player.x - x0);
    console.log(`  1s pushing into a wall: lateral drift ${drift.toFixed(3)} tiles, `+
                `along-wall creep ${creep.toFixed(3)}`);
    // walk speed is 3.3 tiles/s. A step-bounded nudge cannot exceed that,
    // and certainly not the ~18 tiles/s the fixed 0.30 nudge produced.
    t.assert(drift < 3.4, `pressing into a wall slid the avatar ${drift.toFixed(2)} tiles in 1s — faster than walking (3.3)`);
    t.assert(creep < 3.4, `pressing into a wall crept ${creep.toFixed(2)} tiles along it in 1s`);
  }
  keys.w=keys.a=keys.s=keys.d=false;

  // and a free sprint must still reach full speed (the bound must not cap it)
  buildFloor(3, 8642);
  let room=null;
  for (let y=2;y<74 && !room;y++) for (let x=2;x<74;x++){
    if (G.grid[y*76+x]===1 && G.grid[y*76+x+1]===1 && G.grid[y*76+x+2]===1 &&
        G.grid[y*76+x+3]===1 && G.grid[y*76+x+4]===1 && G.grid[y*76+x+5]===1){
      room={x:x+0.5,y:y+0.5}; break; }
  }
  if (room){
    G.player.x=room.x; G.player.y=room.y;
    for(let i=0;i<5;i++) update(1/60);
    const sx0=G.player.x;
    keys.d=true; keys.shift=true;
    for(let i=0;i<60;i++) update(1/60);
    keys.d=false; keys.shift=false;
    const dist=Math.abs(G.player.x-sx0);
    console.log(`  1s sprinting in the open: ${dist.toFixed(2)} tiles (expect ~${(6.0).toFixed(1)})`);
    t.assert(dist > 5.0, `sprint only covered ${dist.toFixed(2)} tiles in 1s — movement was over-constrained`);
  }
}
  t.done();
});

/* ============ TEST 10: pressing into a wall must not slide sideways ====
   Reported as: "going up facing a wall, the avatar moves faster towards the
   right, and when the wall is over the avatar it is teleported far right."
   The perpendicular corner-assist tried its two signs in a FIXED order, so it
   always picked +x — holding up against a wall walked the avatar right until
   it left the screen — and the immobile fallback could relocate 0.9 tiles in
   one frame.                                                                     */
test('[10] pressing into a wall produces no lateral drift and no teleport', () => {
  const t = softAssert();
console.log('[10] pressing into a wall produces no lateral drift and no teleport');
{
  const keys = A.keys;
  const release = ()=>{ keys.w=keys.a=keys.s=keys.d=false; keys.shift=false; };

  // find a floor tile with a wall DIRECTLY above it
  let spot=null;
  for (let y=3;y<74 && !spot;y++) for (let x=3;x<74;x++){
    if (G.grid[y*76+x]===1 && G.grid[(y-1)*76+x]===0) { spot={x:x+0.5,y:y+0.5}; break; }
  }
  t.assert(spot, 'no wall-above tile found');

  if (spot){
    buildFloor(3, 555);
    // re-locate on THIS floor
    spot=null;
    for (let y=3;y<74 && !spot;y++) for (let x=3;x<74;x++){
      if (G.grid[y*76+x]===1 && G.grid[(y-1)*76+x]===0){ spot={x:x+0.5,y:y+0.5}; break; }
    }
    G.player.x=spot.x; G.player.y=spot.y;
    release();
    for(let i=0;i<5;i++) update(1/60);
    const x0=G.player.x, y0=G.player.y;
    keys.w=true;                                 // hold UP into the wall
    let maxJump=0, prevX=G.player.x, prevY=G.player.y;
    for(let i=0;i<60;i++){
      update(1/60);
      maxJump=Math.max(maxJump, Math.hypot(G.player.x-prevX, G.player.y-prevY));
      prevX=G.player.x; prevY=G.player.y;
    }
    release();
    const dx=G.player.x-x0, dy=G.player.y-y0;
    console.log(`  1s holding up into a wall: dx=${dx.toFixed(3)} dy=${dy.toFixed(3)}, `+
                `largest single-frame jump ${maxJump.toFixed(3)} tiles`);
    t.assert(Math.abs(dx) < 0.02,
      `avatar drifted ${dx.toFixed(3)} tiles sideways while pressing straight up into a wall — should be 0`);
    t.assert(maxJump < 0.20,
      `single-frame jump of ${maxJump.toFixed(3)} tiles — that is a teleport, not a nudge`);
    // it should end up FLUSH with the wall: centre-to-face distance == radius
    const wallFace = Math.floor(G.player.y);          // boundary below the wall tile
    const gap = G.player.y - wallFace;
    console.log(`  final gap to wall face ${gap.toFixed(3)} tiles (collision radius ${A.R})`);
    t.assert(gap >= A.R - 0.02 && gap <= A.R + 0.12,
      `ended ${gap.toFixed(3)} tiles from the wall face; expected flush at ~${A.R} (not sunk in, not short)`);
  }
  release();

  // same for a pure horizontal press, and for sprint
  for (const [k,label] of [['a','left'],['d','right']]){
    let sp=null;
    for (let y=3;y<74 && !sp;y++) for (let x=4;x<74;x++){
      if (G.grid[y*76+x]===1 && G.grid[y*76+x-1]===0 && G.grid[y*76+x-2]===0){ sp={x:x+0.5,y:y+0.5}; break; }
    }
    if(!sp) continue;
    G.player.x=sp.x; G.player.y=sp.y;
    release(); for(let i=0;i<5;i++) update(1/60);
    const y0=G.player.y;
    keys[k]=true;
    for(let i=0;i<60;i++) update(1/60);
    release();
    const drift=Math.abs(G.player.y-y0);
    t.assert(drift < 0.05, `pressing ${label} into a wall drifted ${drift.toFixed(3)} tiles vertically`);
  }
  console.log('  no lateral drift on any axis, no teleports');
}
  t.done();
});
