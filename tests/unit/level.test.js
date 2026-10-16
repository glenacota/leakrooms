import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';

const { A, G } = await loadGame();
const buildFloor = A.buildFloor;
A.setHeadless(false, false);

test('[1] maze generation — 400 floors', () => {
  const t = softAssert();
console.log('\n[1] maze generation — 400 floors');
{
  let totalFloors=0, totalTiles=0, minOpen=1, maxOpen=0;
  for (let s=0; s<400; s++){
    buildFloor(s % 5, s*104729+17);
    const g = G.grid, W = 76, H = 76;
    // flood fill from every floor tile; count reachable components
    const seen = new Uint8Array(W*H);
    const comps = [];
    for (let y=0;y<H;y++) for (let x=0;x<W;x++){
      const i=y*W+x;
      if (g[i]!==1 || seen[i]) continue;
      const stack=[i]; seen[i]=1; let n=0;
      while(stack.length){
        const c=stack.pop(); n++;
        const cx=c%W, cy=(c/W)|0;
        const nb=[[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]];
        for(const [nx,ny] of nb){
          if(nx<0||ny<0||nx>=W||ny>=H) continue;
          const ni=ny*W+nx;
          if(g[ni]===1 && !seen[ni]){ seen[ni]=1; stack.push(ni); }
        }
      }
      comps.push(n);
    }
    t.assert(comps.length===1, `seed ${s}: ${comps.length} disconnected regions (${comps.join(',')})`);
    t.assert(comps[0] > 1200, `seed ${s}: only ${comps[0]} reachable tiles`);
    totalTiles += comps[0];
    minOpen=Math.min(minOpen,comps[0]); maxOpen=Math.max(maxOpen,comps[0]);

    /* THE DOOR: exactly one, on a wall tile, touching walkable floor, and it
       is where the player came in — i.e. in the room they spawn in. A door the
       player has to search for is a different game, and a door they cannot
       walk back to inside three minutes is an unwinnable level. */
    t.assert(G.exitTiles.length===1, `seed ${s}: got ${G.exitTiles.length} exits, want 1`);
    const door = G.exitTiles[0];
    t.assert(g[door.y*W+door.x]===0, `seed ${s}: the door at ${door.x},${door.y} is not a wall tile`);
    const doorTouch=[[door.x+1,door.y],[door.x-1,door.y],[door.x,door.y+1],[door.x,door.y-1]]
      .some(([x,y])=> x>=0&&y>=0&&x<W&&y<H && g[y*W+x]===1);
    t.assert(doorTouch, `seed ${s}: door at ${door.x},${door.y} touches no floor`);
    t.assert(door.found===undefined && door.open===0,
      `seed ${s}: the door carries discovery state — there is nothing left to find`);

    /* THE RISERS: exactly what this level says it has, every one on a wall tile
       with a standable spot beside it. */
    const spec = A.LEVELS[Math.min(s%A.LEVELS.length, A.LEVELS_N-1)];
    t.assert(G.leaks.length===spec.leaks,
      `seed ${s}: level ${s%A.LEVELS.length} has ${G.leaks.length} pipes, want ${spec.leaks}`);
    t.assert(G.leaksOpen===spec.leaks, `seed ${s}: leaksOpen is ${G.leaksOpen}, want ${spec.leaks}`);
    t.assert(G.pipes===spec.leaks, `seed ${s}: pipes tally is ${G.pipes}, want ${spec.leaks}`);
    for (const L of G.leaks){
      t.assert(g[L.y*W+L.x]===0, `seed ${s}: a riser is not on a wall tile`);
      t.assert(g[L.sy*W+L.sx]===1, `seed ${s}: a riser's repair spot is not floor`);
      t.assert(L.fixed===false && L.repair===0, `seed ${s}: a riser starts already worked`);
    }
    /* The pipes must not be stacked on one wall: four bursts four tiles apart
       are four repairs in the same breath, which is a counting exercise and not
       a level. Measured on the STANDING SPOTS, because that is what decides
       whether one five-second hold can reach two pipes. */
    for (let a=0;a<G.leaks.length;a++) for (let b=a+1;b<G.leaks.length;b++){
      const d = Math.hypot(G.leaks[a].sx-G.leaks[b].sx, G.leaks[a].sy-G.leaks[b].sy);
      t.assert(d > A.REPAIR_REACH,
        `seed ${s}: two pipes can be sealed by one hold (spots ${d.toFixed(2)} apart)`);
      const dw = Math.hypot(G.leaks[a].x-G.leaks[b].x, G.leaks[a].y-G.leaks[b].y);
      t.assert(dw>=3, `seed ${s}: two pipes are ${dw.toFixed(1)} tiles apart`);
    }

    /* THE LIFEFORMS: exactly what this level says it has, and never standing in
       the room the player walks into. */
    t.assert(G.agents.length===spec.forms,
      `seed ${s}: level ${s%A.LEVELS.length} has ${G.agents.length} lifeforms, want ${spec.forms}`);
    // player spawn must be on floor and not stuck
    {
      let ins=false;
      for(const [sx,sy] of [[-.3,-.3],[.3,-.3],[-.3,.3],[.3,.3],[0,-.3],[0,.3],[-.3,0],[.3,0]]){
        const tx=Math.floor(G.player.x+sx), ty=Math.floor(G.player.y+sy);
        if (tx<0||ty<0||tx>=W||ty>=H || g[ty*W+tx]===0){ ins=true; break; }
      }
      t.assert(!ins, `seed ${s}: player spawns inside geometry`);
    }
    t.assert(g[Math.floor(G.player.y)*W+Math.floor(G.player.x)]===1, `seed ${s}: spawn not on floor`);
    // light bake sane
    let lit=0, maxL=0, nan=0;
    for (let i=0;i<g.length;i++){
      const v=A.internals.lightArr[i];
      if (Number.isNaN(v)) nan++;
      if (v>0.25) lit++;
      maxL=Math.max(maxL,v);
    }
    t.assert(nan===0, `seed ${s}: ${nan} NaN light samples`);
    t.assert(maxL>0.9 && maxL<=2.2, `seed ${s}: peak light ${maxL.toFixed(2)} out of range`);
    const frac = lit/g.length;
    let floorTiles=0, visible=0, bright=0;
    for (let i=0;i<g.length;i++){
      if (g[i]!==1) continue;
      floorTiles++;
      if (A.internals.lightArr[i] >= 0.115) visible++;
      if (A.internals.lightArr[i] >= 0.42) bright++;
    }
    const vf=visible/floorTiles, bf=bright/floorTiles;
    t.assert(vf>0.99, `seed ${s}: only ${(vf*100).toFixed(0)}% of floor is visible (want 100% — never pitch black)`);
    t.assert(bf>0.15, `seed ${s}: only ${(bf*100).toFixed(0)}% of floor is strongly lit`);
    // every ROOM must contain at least one genuinely lit tile
    let darkRooms=0, litRooms=0;
    for(const rm of G.rooms){
      let best=0;
      for(let y=rm.ry;y<rm.ry+rm.rh;y++)
        for(let x=rm.rx;x<rm.rx+rm.rw;x++)
          best=Math.max(best, A.internals.lightArr[y*76+x]);
      if (best>0.5) litRooms++; else darkRooms++;
    }
    globalThis.__lit=globalThis.__lit||0; globalThis.__dark=globalThis.__dark||0;
    globalThis.__lit+=litRooms; globalThis.__dark+=darkRooms;
    totalFloors++;
  }
  const LR=globalThis.__lit/(globalThis.__lit+globalThis.__dark);
  t.assert(LR>0.72, `only ${(LR*100).toFixed(0)}% of rooms are lit across 400 floors (want >72%)`);
  console.log(`  ${(LR*100).toFixed(0)}% of rooms are lit overall.`);
  console.log(`  ${totalFloors} floors OK. avg reachable tiles ${Math.round(totalTiles/totalFloors)}, range ${minOpen}-${maxOpen}`);
}
  t.done();
});

/* ============ TEST 11: room shape and gate size ====================
   Spec: "smaller rooms, like mostly not above 120 tiles large, flowing one
   into the other through smaller door-like gates, e.g. 2 tiles large."
   So: room area capped, and the openings that link rooms are 2 tiles wide
   rather than full-width gaps.                                             */
test('[11] room shape (area cap) and 2-tile gates', () => {
  const t = softAssert();
console.log('[11] room shape (area cap) and 2-tile gates');
{
  let rooms=0, floors=0, side=[], maxArea=0, over120=0;
  for (let f=0; f<30; f++){
    buildFloor(f, 4000+f*613);
    floors++;
    for (const r of G.rooms){
      rooms++;
      side.push((r.rw+r.rh)/2);
      const area = r.rw*r.rh;
      if (area > maxArea) maxArea = area;
      if (area > 120) over120++;
    }
  }
  const mean = side.reduce((a,b)=>a+b,0)/side.length;
  console.log(`  ${(rooms/floors).toFixed(0)} rooms/floor, mean side ${mean.toFixed(1)} tiles, `+
              `max area ${maxArea} tiles`);
  t.assert(rooms/floors > 40, `only ${(rooms/floors).toFixed(0)} rooms per floor`);
  t.assert(over120 === 0, `${over120} rooms exceed 120 tiles of area (max was ${maxArea})`);

  /* Gate width. A doorway through a wall band shows as W O O W along an axis;
     a 1-tile gap shows as W O W. Tunnels flare where they meet a room, so
     wide runs are expected — but 1-tile pinholes should be rare. */
  buildFloor(0, 4000);
  const sol=(x,y)=> (x<0||y<0||x>=76||y>=76) ? true : G.grid[y*76+x]===0;
  let one=0, two=0;
  for (let x=0;x<76;x++) for (let y=2;y<74;y++){
    if (sol(x,y-1) && !sol(x,y)   &&  sol(x,y+1))            one++;
    if (sol(x,y-1) && !sol(x,y)   && !sol(x,y+1) && sol(x,y+2)) two++;
  }
  for (let y=0;y<76;y++) for (let x=2;x<74;x++){
    if (sol(x-1,y) && !sol(x,y)   &&  sol(x+1,y))            one++;
    if (sol(x-1,y) && !sol(x,y)   && !sol(x+1,y) && sol(x+2,y)) two++;
  }
  const ratio = one/Math.max(1,two);
  console.log(`  vertical-wall openings: ${two} two-tile, ${one} one-tile `+
              `(${one+two} total)`);
  t.assert(two > one*2, `only ${two} two-tile gates vs ${one} one-tile — gates are too narrow`);
  t.assert(ratio < 0.5, `${(ratio*100).toFixed(0)}% of gates are 1 tile wide — rooms are pinholed, not linked`);

  // rooms must actually link to each other, not sit sealed in solid rock
  let isolated=0;
  for (const r of G.rooms){
    let opens=0;
    const per=[[-1,0],[1,0],[0,-1],[0,1]];
    for (let y=r.ry-1;y<=r.ry+r.rh;y++) for (let x=r.rx-1;x<=r.rx+r.rw;x++){
      if (x<0||y<0||x>=76||y>=76) continue;
      if (G.grid[y*76+x]===1) continue;
      for (const [dx,dy] of per) if (G.grid[(y+dy)*76+(x+dx)]===1) opens++;
    }
    if (opens < 2) isolated++;
  }
  console.log(`  rooms with fewer than 2 doorway tiles: ${isolated}/${G.rooms.length}`);
  t.assert(isolated === 0, `${isolated} rooms are effectively sealed — they do not flow into each other`);
}
  t.done();
});

/* ============ TEST 30: the level stages — genLevel is pure ============
   buildFloor is now four pure stages and assembly. genLevel is the stage
   that decides everything about the geometry — door, pipes, fixtures,
   pickups, graffiti — so it is tested here WITHOUT a floor: twenty seeds,
   no buildFloor, every field asserted well-formed, and the same seed must
   produce the same level twice. */
test('[30] the level stages — genLevel is pure and well-formed', () => {
  const t = softAssert();
console.log('[30] the level stages — genLevel is pure and well-formed');
{
  for (let s=0; s<20; s++){
    const seed = 1000 + s*7777;
    const W = 76;
    const tag = `seed ${seed}`;
    const level = A.genLevel(A.mulberry32(seed));
    const g = (x,y)=> level.grid[y*W+x];
    const floor = (x,y)=> x>=0 && y>=0 && x<W && y<W && g(x,y)===1;

    // grid
    t.assert(level.grid.length === W*W, `${tag}: grid is ${level.grid.length} tiles, want ${W*W}`);

    // exit: interior wall tile touching floor, closed, and opening the right way
    t.assert(level.exit.length >= 1, `${tag}: no exit`);
    for (const e of level.exit){
      t.assert(e.open === 0, `${tag}: exit is not closed`);
      t.assert(e.x>0 && e.y>0 && e.x<W-1 && e.y<W-1, `${tag}: exit at ${e.x},${e.y} is on the border`);
      t.assert(g(e.x,e.y)===0, `${tag}: exit at ${e.x},${e.y} is not wall`);
      t.assert(floor(e.x+1,e.y)||floor(e.x-1,e.y)||floor(e.x,e.y+1)||floor(e.x,e.y-1),
        `${tag}: exit at ${e.x},${e.y} touches no floor`);
      /* The facing is what the whole door is drawn around, and it is a claim
         about the geometry: the side it names must be the side with floor on
         it. A facing derived from anything but this tile produces a door in
         the east wall whose leaf opens into the west one, and nothing else in
         the suite would notice. */
      const DIR = { S:[0,1], N:[0,-1], E:[1,0], W:[-1,0] };
      t.assert(DIR[e.facing], `${tag}: exit facing is ${JSON.stringify(e.facing)}, want one of S N E W`);
      const [dx,dy] = DIR[e.facing];
      t.assert(floor(e.x+dx, e.y+dy),
        `${tag}: exit at ${e.x},${e.y} faces ${e.facing} but there is no floor on that side`);
      /* South only, and this is a rendering contract rather than a taste one:
         bakeTiles paints exactly one face per wall tile, the south one, so a
         door anywhere else is drawn on an unlit ceiling top. Slot selection
         (wallSlotFor) and wallFacing both have to agree on this, and the only
         way that stays true as either is edited is for it to be asserted here.
         Test 32 proves the leaf follows the hold; this proves the door is on a
         wall that exists to be painted. */
      t.assert(e.facing === 'S',
        `${tag}: exit at ${e.x},${e.y} faces ${e.facing}, but only a south-facing wall has a lit face to sit on`);
      t.assert(floor(e.x, e.y+1),
        `${tag}: exit at ${e.x},${e.y} has no floor south of it, so no face is painted there`);
    }

    // leaks: exactly spec.leaks, each a wall tile with a legal stand spot in a real room
    t.assert(level.leaks.length === level.spec.leaks,
      `${tag}: ${level.leaks.length} pipes, want ${level.spec.leaks}`);
    for (const L of level.leaks){
      t.assert(L.fixed===false && L.repair===0 && L.fixedAt===0, `${tag}: riser not pristine`);
      t.assert(g(L.x,L.y)===0, `${tag}: riser at ${L.x},${L.y} is not wall`);
      t.assert(floor(L.sx,L.sy), `${tag}: stand spot ${L.sx},${L.sy} is not floor`);
      /* L.room may be null: a stand spot in a partition band is in no rect,
         and the game treats that as "no guaranteed pickup here", not as a
         broken riser. */
    }

    // fixtures: sane radius and intensity, on the map
    for (const f of level.fixtures){
      t.assert(f.r > 0 && f.i > 0, `${tag}: fixture with r=${f.r} i=${f.i}`);
      t.assert(f.x>=0 && f.y>=0 && f.x<W && f.y<W, `${tag}: fixture off the map`);
    }

    // batteries and graffiti: placed, not taken
    t.assert(level.batteries.length > 0, `${tag}: no battery pickups`);
    for (const b of level.batteries)
      t.assert(b.taken === false && b.x>=0 && b.y>=0 && b.x<W && b.y<W, `${tag}: bad battery cell`);
    t.assert(level.graffiti.length > 0, `${tag}: no graffiti`);
    for (const gr of level.graffiti)
      t.assert(gr.seen === false && typeof gr.text === 'string' && gr.text.length > 0, `${tag}: bad graffiti`);

    // purity: same seed, same level
    const again = A.genLevel(A.mulberry32(seed));
    t.assert(JSON.stringify(again.leaks) === JSON.stringify(level.leaks),
      `${tag}: genLevel is not deterministic`);
    t.assert(JSON.stringify(again.exit) === JSON.stringify(level.exit),
      `${tag}: the door moved between two identical seeds`);
  }
  console.log('  20 seeds, no buildFloor: door, pipes, fixtures, pickups, graffiti all well-formed');
}
  t.done();
});
/* ============ TEST 32: the door is a door ========================
   `e.open` was written once, at placement, and never again — so every door
   on every floor rendered permanently shut, and the renderer's read of it was
   a value that could not change. The state of the one door on the floor was
   therefore a stroke alpha and a word, and the 1.5s hold had no representation
   in the world at all. None of that is visible to a bot that walks to the door
   and waits, which is why the suite was green through all of it.

   These assertions are on the field the renderer actually reads. */
test('[32] the door — the leaf, the facing, and the state that drives both', () => {
  const t = softAssert();
console.log('[32] the door — the leaf, the facing, and the state that drives both');
{
  const settle = n => { for (let i=0;i<n;i++) A.update(1/60); };
  const standAt = (e, tiles) => {
    const DIR = { S:[0,1], N:[0,-1], E:[1,0], W:[-1,0] }[e.facing];
    G.player.x = e.x + 0.5 + DIR[0]*tiles;
    G.player.y = e.y + 0.5 + DIR[1]*tiles;
  };
  const sealAll = () => {
    for (const L of G.leaks){ L.fixed = true; L.repair = 1; }
    G.leaksOpen = 0;
  };

  for (const seed of [4242, 88, 9001]){
    /* buildFloor takes the floor number as an argument and does not touch the
       run's own floorIdx, so a loop that descends has to put it back — the
       second seed otherwise starts on floor 1 with a floor 0 layout and every
       assertion about it is about a level that does not exist. */
    A.lives=3; A.floorIdx=0; A.runTime=0;
    buildFloor(0, seed);
    const e = G.exitTiles[0];
    const tag = `seed ${seed}`;

    /* SHUT. With a pipe still open the door cannot end the level, so the leaf
       must be at zero and must STAY at zero no matter how long you stand on
       the threshold — this is the state that was silently untestable before. */
    standAt(e, 0.9); settle(30);
    t.assert(G.leaksOpen > 0, `${tag}: nothing is leaking, the shut state cannot be tested`);
    t.assert(G.descend === 0, `${tag}: descended with ${G.leaksOpen} pipe(s) open`);
    t.assert(e.open < 0.02, `${tag}: the leaf is ${e.open.toFixed(3)} open on a floor with pipes still leaking`);

    /* AJAR. The last seal puts it on the latch, not through it: enough swing
       to read as READY from across the room, nowhere near a floor change. */
    sealAll(); standAt(e, 4); settle(60);
    t.assert(e.open > 0.2 && e.open < 0.6,
      `${tag}: an armed door rests at ${e.open.toFixed(3)}, want the ajar stop near 0.34`);
    t.assert(A.floorIdx === 0, `${tag}: standing four tiles away ended the level`);

    /* CRANKING. On the threshold the swing follows G.descend, so the thing the
       player watches is the thing the sim is doing — and the descent itself is
       still monotonic and still gated on the pipes. */
    standAt(e, 0.9); settle(30);
    t.assert(G.descend > 0.3, `${tag}: the hold is not accumulating (${G.descend.toFixed(2)}s)`);
    t.assert(e.open > 0.34, `${tag}: the leaf did not follow the hold (${e.open.toFixed(3)})`);
    const midOpen = e.open;

    /* BACKING OFF drains the cycle, and with it the leaf — a door that stayed
       cranked open while the progress drained would be lying twice. */
    G.descend = 1.2; e.open = 0.9; standAt(e, 6); settle(60);
    t.assert(G.descend === 0, `${tag}: stepping off left ${G.descend.toFixed(2)}s on the clock`);
    t.assert(e.open < midOpen, `${tag}: the leaf stayed open after the cycle drained`);

    /* and all the way through: the hold still ends the level, once. */
    standAt(e, 0.9);
    let frames = 0;
    while (A.floorIdx === 0 && frames < 400){ A.update(1/60); frames++; }
    t.assert(A.floorIdx === 1, `${tag}: the hold never reached the floor change in ${frames} frames`);
    t.assert(G.descend === 0, `${tag}: the new floor opened with ${G.descend.toFixed(2)}s still on the door`);
    t.assert(G.exitTiles[0].open < 0.02, `${tag}: the new floor's door did not start shut`);
  }
  console.log('  shut on a wet floor, ajar on the latch, cranking on the hold, shut again after');
  console.log('  the new floor, and the facing names the side with floor on it');
}
  t.done();
});

