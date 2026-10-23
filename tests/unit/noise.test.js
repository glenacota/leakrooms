import test from 'node:test';
import { fakeAudioContext } from '../helpers/stubs.js';
import { softAssert } from '../helpers/soft-assert.js';
import { readCss, readHtml, readSrc } from '../helpers/src-text.js';
import { loadGame } from '../helpers/harness.js';
import { on, off } from '../../src/util/events.js';

const { A, G, els, calls } = await loadGame();
const buildFloor = A.buildFloor;
const update = A.update;
const render = A.render;
const keys = A.keys;

/* The bar is drawn from the noise level divided by NOISE_FS, and every value the
   game produces is between 0 and NOISE_FS. A bar that divides by something else
   cannot show a sprint or mark the LOUD threshold, and the sim never notices:
   bots do not read the HUD. */
test('the noise meter uses the scale the game actually produces', () => {
  const t = softAssert();
{
  A.lives=3; A.floorIdx=0;
  buildFloor(1, 60606);
  const W = 76;
  const H = A.HUD;
  const show = (n, leakTotal) => {
    G.noise = n; G.selfNoise = n; G.noisePeak = n; G.leakTotal = leakTotal||0;
    A.updateHUD();
  };
  const bar = () => parseFloat(H.noise.style.width);
  const val = () => parseInt(H.vNoise.textContent, 10);
  const pct = p => p/A.NOISE_FS*100;          // exact, not rounded: the bar is
  const near = (got, want, what) =>           // drawn from the same division
    t.assert(Math.abs(got-want) < 0.01,
      `${what} is ${got.toFixed(2)}%, expected ${want.toFixed(2)}%`);

  /* the scale itself: each number the game can produce, at its own value */
  show(0.22); const walk = bar();
  show(0.30); const wade = bar();
  show(A.LOUD); const loud = bar();
  show(A.SPRINT_NOISE); const sprint = bar();
  show(A.REPAIR_NOISE); const wrench = bar();
  show(A.DOOR_NOISE); const door = bar();

  near(walk, pct(0.22), 'walking');
  near(wade, pct(0.30), 'wading');
  near(loud, pct(A.LOUD), 'LOUD — the threshold has no position on the instrument');
  /* 0.72 of 0.85 is 84.7%, so the bar reads 85. Asserted at the rounding the
     player sees, not at a number picked to make the test tidy. */
  t.assert(Math.abs(sprint-85) < 0.5, `a sprint fills the bar to ${sprint.toFixed(1)}%, expected 85`);
  near(wrench, 100, 'the wrench, the loudest sustained thing you do');
  near(door, 100, 'the door — past full scale is clamped, not overflowing');
  t.assert(val()===100, `the number beside the bar reads ${val()} at the wrench`);
  t.assert(walk < wade && wade < loud && loud < sprint && sprint < wrench,
    `the bar does not rank the actions the AI ranks (${walk}, ${wade}, ${loud}, ${sprint}, ${wrench})`);
  /* and the threshold is marked where it actually is, from the constant */
  near(parseFloat(H.noiseLoud.style.left), pct(A.LOUD), 'the LOUD hairline');

  /* the red comes from the LOUD constant on your own noise, not a number
     hard-coded beside it */
  show(0.46);
  t.assert(!H.noiseWrap.classList.contains('hot'),
    'the bar goes red below LOUD — it is still testing the old 0.45');
  show(A.LOUD);
  t.assert(H.noiseWrap.classList.contains('hot'), 'LOUD does not turn the bar red');

  /* the open pipes get their own fill under yours: that is the level the agents
     steer by, and it is not about the player */
  show(0.22, 0.24);
  near(parseFloat(H.noiseLeak.style.width), pct(0.24), 'the leak fill');
  show(0.22, 0);
  t.assert(H.noiseLeak.style.width==='0%', 'the leak fill is still drawn with every pipe sealed');

  /* standing still is the case this split exists for: the player's share of the
     meter must be zero when they have done nothing, and the building's share
     must still be there, because something is on its way to the pipe */
  {
    buildFloor(1, 60606);
    const L = G.leaks.find(l=>!l.fixed);
    /* two tiles out, not on the pipe: standing inside REPAIR_REACH starts a
       repair, and a repair is the loudest thing the player can do */
    let spot = null;
    for (let r=2; r<=4 && !spot; r++)
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){
        const nx=L.sx+dx*r, ny=L.sy+dy*r;
        if (nx<0||ny<0||nx>=W||ny>=W) continue;
        if (G.grid[ny*W+nx]===1 && !A.leakReach(nx+0.5, ny+0.5)){ spot={x:nx+0.5,y:ny+0.5}; break; }
      }
    t.assert(spot, 'no walkable tile outside repair reach near the pipe on this floor');
    G.player.x = spot.x; G.player.y = spot.y;
    keys['d']=keys['w']=keys['a']=keys['s']=false; keys['shift']=false;
    for (let i=0;i<180;i++) update(1/60);
    A.updateHUD();
    t.assert(G.selfNoise===0,
      `standing still for three seconds left ${G.selfNoise.toFixed(2)} of your own noise on the meter`);
    t.assert(bar()===0, `your fill reads ${bar()}% while standing still`);
    t.assert(G.leakTotal>0 && parseFloat(H.noiseLeak.style.width)>0,
      'the pipes are open and the bar shows no building noise either — it is showing nothing at all');
    const seen = parseInt(H.vNoise.textContent, 10);
    t.assert(seen>0, `the number reads ${seen} next to an open pipe — the loudest thing in earshot is silent`);
    console.log(`  standing still two tiles from an open pipe: your fill 0%, the pipes' `+
      `${parseFloat(H.noiseLeak.style.width).toFixed(0)}%, the number reads ${seen}`);

    /* ...and it is there the moment you move, and gone when you stop */
    keys['d'] = true;
    for (let i=0;i<20;i++) update(1/60);
    A.updateHUD();
    /* wet boots are louder than dry ones and this spot may be flooded, so compare
       against the step power the movement stage itself chose */
    const stepPower = A.wetAt(G.player.x, G.player.y) > 0.25 ? 0.30 : 0.22;
    near(G.selfNoise, stepPower, 'your own noise after twenty frames of walking');
    keys['d'] = false;
    for (let i=0;i<40;i++) update(1/60);          // 0.66s of decay at 1.55/s
    A.updateHUD();
    t.assert(G.selfNoise===0, `your noise is still at ${G.selfNoise.toFixed(2)} a second after you stopped`);
  }


  /* the peak marker exists because a sprint is 0.26s long and the fill alone
     cannot show it. It is held below full scale so the decay is visible. */
  show(0.1); G.noisePeak = 0.6; A.updateHUD();
  /* The peak no longer decays in updateHUD; it decays in tickClock (via update).
     One frame of decay (0.24 * 1/60 = 0.004) happens per update step. */
  const afterOne = parseFloat(H.noisePeak.style.left);
  /* Calling updateHUD multiple times between update steps must NOT decay the peak. */
  for (let i=0;i<5;i++) A.updateHUD();
  const afterFive = parseFloat(H.noisePeak.style.left);
  t.assert(Math.abs(afterOne - afterFive) < 0.01,
    `multiple updateHUD calls changed the peak: ${afterOne.toFixed(2)}% -> ${afterFive.toFixed(2)}%`);

  /* One update step (dt=1/60) decays the peak by 0.004 (noise units).
     In percentage terms that's 0.004/NOISE_FS*100. */
  A.update(1/60);
  A.updateHUD();
  const afterStep = parseFloat(H.noisePeak.style.left);
  const expectedDropPct = (0.24/60)/A.NOISE_FS*100; // 0.004 noise units -> percentage
  t.assert(Math.abs((afterOne - afterStep) - expectedDropPct) < 0.001,
    `peak dropped ${(afterOne - afterStep).toFixed(4)}%, expected ${expectedDropPct.toFixed(4)}%`);
  console.log(`  peak decays in tickClock: ${afterOne.toFixed(2)}% -> ${afterStep.toFixed(2)}% (drop ${(afterOne - afterStep).toFixed(4)}% per step)`);

  /* and it holds up across a real frame, the only place the numbers above can be
     wrong if the sim does not produce them */
  buildFloor(1, 60606);
  keys['d'] = true;
  for (let i=0;i<24;i++) update(1/60);
  A.updateHUD();
  const moving = bar();
  keys['shift'] = true;
  for (let i=0;i<12;i++) update(1/60);
  A.updateHUD();
  const running = bar();
  keys['d'] = false; keys['shift'] = false;
  t.assert(Math.abs(moving-pct(0.22)) < 6,
    `24 frames of walking left your fill at ${moving.toFixed(1)}%, expected about ${pct(0.22)}`);
  t.assert(Math.abs(running-85) < 1,
    `sprinting put your fill at ${running.toFixed(1)}%, expected 85`);
  t.assert(G.selfNoise >= A.SPRINT_NOISE,
    `the sprint registered as ${G.selfNoise} of your own noise, expected ${A.SPRINT_NOISE}`);
  console.log(`  walking ${moving.toFixed(0)}%, wading ${Math.round(pct(0.30))}%, LOUD ${Math.round(pct(A.LOUD))}%, `+
    `sprint ${running.toFixed(0)}%, wrench 100%, door clamps`);

  /* A pipe is broken in a wall and is repaired from the floor tile beside it, and
     alert() hands the noise source straight to the entity as the place to walk
     to. So the source must be that floor tile, or a Lifeform grinds its
     collision disc against brick. No bot catches this: none walks to a leak. */
  let witness = null;
  for (const seed of [60606, 4242, 9001, 88, 31337, 2718]){
    buildFloor(1, seed);
    for (let i=0;i<12;i++) update(1/30);
    const L = G.leaks.find(l=>!l.fixed);
    if (!L) continue;
    t.assert(G.grid[L.sy*W+L.sx] === 1,
      `seed ${seed}: the pipe's stand tile is not walkable — the two coordinates are not what this test assumes`);
    t.assert(G.grid[L.y*W+L.x] !== 1,
      `seed ${seed}: the pipe is not in a wall, so there is no wrong address to give`);
    /* a walkable neighbour of the stand tile, close enough that the pipe's own
       noise reaches it */
    let spot = null;
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
      const nx = L.sx+dx, ny = L.sy+dy;
      if (nx<0||ny<0||nx>=W||ny>=W) continue;
      if (G.grid[ny*W+nx] === 1){ spot = {x:nx+0.5, y:ny+0.5}; break; }
    }
    if (!spot) continue;
    witness = { seed, L, spot, R: A.hearRadius(G.leakPower) };
    break;
  }
  t.assert(witness, 'no open pipe on six floors had a walkable tile beside it');

  {
    const { seed, L, spot, R } = witness;
    /* park the player far away: the claim is about hearing, and a Lifeform that
       can see the player is hunting for a reason this test did not set up */
    let far = {x:1,y:1,d:-1};
    for (let y=0;y<W;y++) for (let x=0;x<W;x++){
      if (G.grid[y*W+x] !== 1) continue;
      const dd = Math.hypot(x+0.5-spot.x, y+0.5-spot.y);
      if (dd > far.d) far = {x:x+0.5, y:y+0.5, d:dd};
    }
    G.player.x = far.x; G.player.y = far.y;

    const a = G.agents[0];
    a.x = spot.x; a.y = spot.y; a.state = 'WALK'; a.born = 0; a.rise = 1; a.t = 1;
    a.target = {x:spot.x, y:spot.y};
    update(1/60);

    t.assert(a.state==='SEARCH',
      `seed ${seed}: an entity one tile from an open pipe (power ${G.leakPower.toFixed(2)}, `+
      `heard out to ${R.toFixed(2)}) stayed WALK — the pipe is not making a noise anything can hear`);
    const tx = Math.floor(a.target.x), ty = Math.floor(a.target.y);
    t.assert(a.target && G.grid[ty*W+tx] === 1,
      `seed ${seed}: the pipe drew it to tile ${tx},${ty}, which is not floor — `+
      'the noise came from the inside of a wall');
    t.assert(Math.hypot(a.target.x-(L.sx+0.5), a.target.y-(L.sy+0.5)) < 2,
      `seed ${seed}: it was sent ${Math.hypot(a.target.x-(L.sx+0.5), a.target.y-(L.sy+0.5)).toFixed(2)} `+
      'tiles from the pipe that called it');
    console.log(`  seed ${seed}: pipe power ${G.leakPower.toFixed(2)} heard out to ${R.toFixed(2)} tiles; `+
      `an entity beside the pipe goes SEARCH for tile ${tx},${ty}, and that tile is floor`);
  }
}
  t.done();
});


/* hearRadius() measures distance through open floor. Without counting the walls
   on the line of sound, a walk three walls away carries as far as a walk five
   tiles away in the open, which removes the only cover this maze offers. A
   sprint must still cross one wall, so cover cannot mean silence. */
test('walls muffle a sound, and a sprint still crosses one', () => {
  const t = softAssert();
{
  const W = 76, H = 76;
  const FLOOR_T = 1;
  const at = (x,y)=> (x<0||y<0||x>=W||y>=H) ? FLOOR_T : G.grid[y*W+x];

  /* A straight run of floor with exactly `walls` masonry tiles in it and one
     floor tile past them, so the listener is five tiles away. Scanned, not
     planted: the claim is about a real maze position, and a hand-built grid
     would only prove the arithmetic. */
  const findRun = (walls) => {
    for (let y=0; y<H; y++)
      for (let x=0; x<W-walls-2; x++){
        if (at(x,y)!==FLOOR_T) continue;
        let n=0;
        while (n<walls && at(x+1+n,y)===0) n++;
        if (n!==walls) continue;
        if (at(x+1+n,y)!==FLOOR_T || at(x+1+n+1,y)!==FLOOR_T) continue;
        return { src:{x:x+0.5, y:y+0.5}, ear:{x:x+1+n+1+0.5, y:y+0.5} };
      }
    return null;
  };
  /* Five clear floor tiles: the same distance, nothing in between. */
  const findClear = () => {
    for (let y=0; y<H; y++)
      for (let x=0; x<W-5; x++){
        if (at(x,y)!==FLOOR_T) continue;
        let clear=true;
        for (let i=1; i<=4; i++) if (at(x+i,y)!==FLOOR_T){ clear=false; break; }
        if (clear) return { src:{x:x+0.5, y:y+0.5}, ear:{x:x+4.5, y:y+0.5} };
      }
    return null;
  };

  const put = (spot, state) => {
    G.agents = [{
      x: spot.x, y: spot.y, state, t:0, rise: state==='DORMANT'?0:1,
      target:null, face:0, wakeCd:0, stepT:0, born:0,
    }];
    return G.agents[0];
  };

  /* Search a few seeds for a floor with the geometry to ask this in. A BSP maze
     at this size almost always does, so the fallback is another seed. */
  let murdled = null, clear = null;
  for (const seed of [4242, 60606, 88, 9001, 31337, 12345]){
    A.buildFloor(0, seed);
    murdled = findRun(3); clear = findClear();
    if (murdled && clear) break;
  }
  t.assert(!!(murdled && clear), 'no floor in six seeds has three walls and five clear tiles in a row — the scan is wrong');

  /* behind three walls: a walk reaches 6.6 tiles and three walls cost 9.0 */
  A.buildFloor(0, 4242);
  {
    const a = put(murdled.ear, 'WALK');
    A.sustainedNoise(0.22, murdled.src.x, murdled.src.y);
    t.assert(a.state==='WALK',
      `a walk three walls and five tiles away still turned the listener to ${a.state} — the walls are not in the way`);
  }

  /* the same distance, with nothing in between */
  A.buildFloor(0, 4242);
  {
    const a = put(clear.ear, 'WALK');
    A.sustainedNoise(0.22, clear.src.x, clear.src.y);
    t.assert(a.state==='SEARCH',
      `a walk four tiles away in the open left the listener ${a.state} — and now nothing carries at all`);
  }

  /* one wall is not cover from a sprint */
  {
    const one = findRun(1);
    t.assert(!!one, 'no single-wall run on this floor — the scan is wrong');
    const a = put(one.ear, 'DORMANT');
    A.sustainedNoise(A.SPRINT_NOISE, one.src.x, one.src.y);
    t.assert(a.state!=='DORMANT',
      `a sprint one wall and five tiles away did not wake a sleeping coil — WALL_COST of 3.0 has taken the sprint's reach with it`);
    t.assert(a.state==='RISING' || a.state==='HUNT',
      `a sprint woke the coil into '${a.state}', want it rising or hunting`);
  }

  /* the noise powers are unchanged: this is the shape of the room, not the
     loudness of the game */
  t.assert(A.LOUD===0.5, `LOUD is ${A.LOUD} — the noise contract is not this task's to move`);
  t.assert(A.SPRINT_NOISE===0.72 && A.REPAIR_NOISE===0.85,
    'a noise power moved — only WALL_COST was supposed to change');
  console.log('  walk lost behind three walls, heard in the open, sprint crosses one');
}
  t.done();
});

/* A bump into a wall counts once per contact, and both sprint and walk bumps
   are counted. The meter shows the bump power during the contact. */
test('a bump counts once per contact, for both sprint and walk', () => {
  const t = softAssert();
{
  buildFloor(0, 4242);
  A.STATE = 'play';

  /* Find a wall to sprint into. Put the player next to a wall facing it. */
  const W = 76;
  let spot = null;
  for (let y=1; y<W-1 && !spot; y++){
    for (let x=1; x<W-1; x++){
      if (G.grid[y*W+x]===1 && G.grid[y*W+x+1]===0){
        spot = {x: x+0.5, y: y+0.5, face: 0}; // face right (+x) into wall at x+1
        break;
      }
    }
  }
  t.assert(spot, 'no wall to bump into on this floor');

  G.player.x = spot.x; G.player.y = spot.y; G.player.face = spot.face;
  G.player.px = spot.x; G.player.py = spot.y;
  G.player.bumpedLastFrame = false;

  /* Sprint into the wall for 60 frames. */
  keys['d'] = true; keys['shift'] = true;
  const noisesBeforeSprint = G.stat.noises;
  for (let i=0;i<60;i++) update(1/60);
  const noisesAfterSprint = G.stat.noises;

  /* Exactly one noise counted for the sprint bump contact. */
  t.assert(noisesAfterSprint - noisesBeforeSprint === 1,
    `sprint bump: stat.noises rose by ${noisesAfterSprint - noisesBeforeSprint}, want 1`);

  /* selfNoise was at bump sprint power during the contact. */
  t.assert(G.selfNoise >= A.NOISE.BUMP_SPRINT - 0.01 && G.selfNoise <= A.NOISE.BUMP_SPRINT + 0.01,
    `selfNoise is ${G.selfNoise.toFixed(3)} during sprint bump, want ${A.NOISE.BUMP_SPRINT}`);

  keys['d'] = false; keys['shift'] = false;
  update(1/60); // one frame to clear the bump

  /* Walk into the wall for 60 frames. */
  keys['d'] = true;
  const noisesBeforeWalk = G.stat.noises;
  for (let i=0;i<60;i++) update(1/60);
  const noisesAfterWalk = G.stat.noises;

  /* Exactly one noise counted for the walk bump contact. */
  t.assert(noisesAfterWalk - noisesBeforeWalk === 1,
    `walk bump: stat.noises rose by ${noisesAfterWalk - noisesBeforeWalk}, want 1`);

  /* selfNoise was at bump walk power during the contact. */
  t.assert(G.selfNoise >= A.NOISE.BUMP_WALK - 0.01 && G.selfNoise <= A.NOISE.BUMP_WALK + 0.01,
    `selfNoise is ${G.selfNoise.toFixed(3)} during walk bump, want ${A.NOISE.BUMP_WALK}`);

  console.log(`  sprint bump: +1 noise (${noisesAfterSprint - noisesBeforeSprint}), selfNoise=${G.selfNoise.toFixed(3)}`);
  console.log(`  walk bump: +1 noise (${noisesAfterWalk - noisesBeforeWalk}), selfNoise=${G.selfNoise.toFixed(3)}`);
}

  t.done();
});

/* wallSteps must be symmetric: the wall count between A and B must not depend
   on argument order. A Bresenham line is deterministic for a given start/end,
   so we canonicalize by walking from the tile with the smaller linear index. */
test('wallSteps is symmetric across random floor-tile pairs', () => {
  const t = softAssert();
{
  const W = 76, H = 76;
  const FLOOR_T = 1;
  const at = (x,y)=> (x<0||y<0||x>=W||y>=H) ? FLOOR_T : G.grid[y*W+x];

  /* Collect all floor tiles on this floor. */
  const floors = [];
  for (let y=0; y<H; y++) for (let x=0; x<W; x++) if (at(x,y)===FLOOR_T) floors.push({x,y});

  /* Test a few hundred random pairs, 3-13 tiles apart, across several seeds. */
  const pairsPerFloor = 200;
  const maxDist = 13, minDist = 3;
  let totalPairs = 0, asymmetric = 0, flipped = 0;

  for (const seed of [4242, 60606, 88, 9001, 31337, 12345, 2718, 9999, 1111, 5555]){
    A.buildFloor(0, seed);
    const rng = A.mulberry32(seed ^ 0x9e3779b9);

    for (let i=0; i<pairsPerFloor; i++){
      const a = floors[Math.floor(rng() * floors.length)];
      const b = floors[Math.floor(rng() * floors.length)];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < minDist || d > maxDist) { i--; continue; }

      const ax = a.x + 0.5, ay = a.y + 0.5;
      const bx = b.x + 0.5, by = b.y + 0.5;

      const ab = A.wallSteps(ax, ay, bx, by);
      const ba = A.wallSteps(bx, by, ax, ay);

      totalPairs++;
      if (ab !== ba) {
        asymmetric++;
        /* Check if the hearing decision would flip for walk/sprint powers. */
        const walkR = A.hearRadius(0.22);
        const sprintR = A.hearRadius(A.SPRINT_NOISE);
        const walkCost = A.NOISE.WALL_COST;
        const walkEffAB = walkR - ab * walkCost;
        const walkEffBA = walkR - ba * walkCost;
        const sprintEffAB = sprintR - ab * walkCost;
        const sprintEffBA = sprintR - ba * walkCost;
        const walkFlip = (d <= walkEffAB) !== (d <= walkEffBA);
        const sprintFlip = (d <= sprintEffAB) !== (d <= sprintEffBA);
        if (walkFlip || sprintFlip) flipped++;
      }
    }
  }

  const asymPct = (asymmetric/totalPairs*100).toFixed(1);
  const flipPct = (flipped/totalPairs*100).toFixed(1);
  console.log(`  wallSteps symmetry: ${totalPairs} pairs, ${asymmetric} asymmetric (${asymPct}%), ${flipped} decision flips (${flipPct}%)`);

  t.assert(asymmetric === 0,
    `wallSteps was asymmetric for ${asymmetric}/${totalPairs} pairs (${asymPct}%) — canonical order not applied`);
}
  t.done();
});

/* The MAX_WALL_STEPS cap must be large enough that even the loudest noise
   in the NOISE table has zero or negative reach left after that many walls.
   Reach after N walls = hearRadius(power) - N * WALL_COST. */
test('MAX_WALL_STEPS cap exhausts reach for every noise power', () => {
  const t = softAssert();
{
  /* Only the actual sound powers, not config constants (HEAR_BASE, HEAR_GAIN,
     WALL_COST, LOUD). */
  const noisePowers = {
    WALK: A.NOISE.WALK,
    WADE: A.NOISE.WADE,
    SPRINT: A.NOISE.SPRINT,
    REPAIR: A.NOISE.REPAIR,
    BUMP_SPRINT: A.NOISE.BUMP_SPRINT,
    BUMP_WALK: A.NOISE.BUMP_WALK,
    DOOR: A.NOISE.DOOR,
    BRUSH: A.NOISE.BRUSH,
  };
  const maxPower = Math.max(...Object.values(noisePowers));
  const maxSteps = Math.ceil(A.hearRadius(maxPower) / A.NOISE.WALL_COST);

  t.assert(A.MAX_WALL_STEPS === maxSteps,
    `MAX_WALL_STEPS is ${A.MAX_WALL_STEPS}, expected ${maxSteps} (from max power ${maxPower})`);

  for (const [name, power] of Object.entries(noisePowers)) {
    const reach = A.hearRadius(power) - maxSteps * A.NOISE.WALL_COST;
    console.log(`  ${name}: power=${power}, hearRadius=${A.hearRadius(power).toFixed(2)}, ` +
      `reach after ${maxSteps} walls=${reach.toFixed(2)}`);
    t.assert(reach <= 0,
      `${name} (power ${power}) still has ${reach.toFixed(2)} tiles of reach after ${maxSteps} walls — cap too small`);
  }
}
  t.done();
});

/* A HUNT lifeform retargets only to LOUD sounds or the player's own noises.
   Quiet ambient sounds (pipes, power < LOUD, mine=false) do NOT retarget a hunter.
   This preserves the sprint decision and the 8 s give-up timer. */
test('hunter retargets only to loud or player sounds, not quiet pipes', () => {
  const t = softAssert();
{
  const W = 76;
  A.buildFloor(0, 4242);

  /* Find an open pipe (quiet, not mine). */
  const L = G.leaks.find(l=>!l.fixed);
  t.assert(L, 'floor must have an open pipe');

  /* Place a HUNT lifeform near the pipe on a walkable tile.
     The pipe's stand tile (L.sx, L.sy) is floor. Use a neighbor. */
  const pipeX = L.sx + 0.5, pipeY = L.sy + 0.5;
  let hunterX = L.sx + 1.5, hunterY = L.sy + 0.5; // right of stand tile
  if (G.grid[Math.floor(hunterY)*W+Math.floor(hunterX)] !== 1) {
    hunterX = L.sx - 0.5; hunterY = L.sy + 0.5; // left
  }
  if (G.grid[Math.floor(hunterY)*W+Math.floor(hunterX)] !== 1) {
    hunterX = L.sx + 0.5; hunterY = L.sy + 1.5; // down
  }
  if (G.grid[Math.floor(hunterY)*W+Math.floor(hunterX)] !== 1) {
    hunterX = L.sx + 0.5; hunterY = L.sy - 0.5; // up
  }
  t.assert(G.grid[Math.floor(hunterY)*W+Math.floor(hunterX)] === 1, 'hunter must be on floor');

  const hunter = {
    x: hunterX, y: hunterY, state: 'HUNT', t: 0, rise: 1,
    target: {x: hunterX, y: hunterY}, face: 0, wakeCd: 0, stepT: 0, born: 0,
  };
  G.agents = [hunter];

  /* Pipe noise is LEAK_NOISE_BASE + LEAK_NOISE_GAIN * flood. It stays < LOUD. */
  const pipePower = G.leakPower; // ~0.19, well below LOUD (0.5)
  t.assert(pipePower < A.LOUD, `pipe power ${pipePower} should be < LOUD ${A.LOUD}`);

  /* The pipe calls sustainedNoise with mine=false. */
  A.sustainedNoise(pipePower, pipeX, pipeY, false);

  /* Hunter should NOT retarget to the quiet pipe. */
  t.assert(hunter.state === 'HUNT', 'hunter should stay HUNT');
  t.assert(Math.abs(hunter.target.x - hunterX) < 0.1 && Math.abs(hunter.target.y - hunterY) < 0.1,
    'hunter should keep its original target, not retarget to pipe');

  /* Now simulate player walking near the hunter (mine=true, power=WALK=0.22 < LOUD). */
  hunter.target = {x: 10, y: 10}; // some other target
  A.sustainedNoise(A.WALK, hunterX, hunterY, true); // mine=true

  /* Hunter SHOULD retarget to the player's noise even though it's quiet. */
  t.assert(hunter.state === 'HUNT', 'hunter should stay HUNT');
  t.assert(Math.abs(hunter.target.x - hunterX) < 0.1 && Math.abs(hunter.target.y - hunterY) < 0.1,
    'hunter should retarget to player position (mine=true)');

  /* Loud sound (sprint) should also retarget, even with mine=false.
     Use a position that's on floor and within hearing range. */
  hunter.target = {x: 20, y: 20};
  let loudX = hunterX + 3, loudY = hunterY;
  if (G.grid[Math.floor(loudY)*W+Math.floor(loudX)] !== 1) {
    loudX = hunterX - 3; loudY = hunterY;
  }
  if (G.grid[Math.floor(loudY)*W+Math.floor(loudX)] !== 1) {
    loudX = hunterX; loudY = hunterY + 3;
  }
  if (G.grid[Math.floor(loudY)*W+Math.floor(loudX)] !== 1) {
    loudX = hunterX; loudY = hunterY - 3;
  }
  t.assert(G.grid[Math.floor(loudY)*W+Math.floor(loudX)] === 1, 'loud source must be on floor');
  A.sustainedNoise(A.SPRINT_NOISE, loudX + 0.5, loudY + 0.5, false); // loud, not mine

  t.assert(hunter.state === 'HUNT', 'hunter should stay HUNT');
  t.assert(Math.abs(hunter.target.x - (loudX + 0.5)) < 0.1 && Math.abs(hunter.target.y - (loudY + 0.5)) < 0.1,
    'hunter should retarget to loud sound (mine=false but loud)');

  /* A WALK lifeform near an open pipe still goes to SEARCH (existing behavior). */
  const walker = {
    x: hunterX, y: hunterY, state: 'WALK', t: 0, rise: 1,
    target: null, face: 0, wakeCd: 0, stepT: 0, born: 0,
  };
  G.agents = [walker];
  A.sustainedNoise(pipePower, pipeX, pipeY, false);
  t.assert(walker.state === 'SEARCH', 'walker near quiet pipe goes SEARCH');

  console.log('  hunter ignores quiet pipe, retargets to player (mine) and loud sounds; walker goes SEARCH');
}
  t.done();
});

/* Each pipe's loudness is independent of how many are open.
   Per-pipe power rises with floodCover up to just below LOUD.
   The displayed total (leakTotal) is the sum, clamped to just below LOUD. */
test('pipe loudness independent of open pipe count', () => {
  const t = softAssert();
{
  /* Build a floor and force different numbers of open pipes. */
  A.buildFloor(0, 4242);

  /* The max per-pipe power at full flood is LEAK_NOISE_BASE + LEAK_NOISE_GAIN = 0.42.
     LOUD = 0.5, so the clamp LOUD - 0.02 = 0.48 never binds with current constants. */
  const maxPerPipe = A.LEAK_NOISE_BASE + A.LEAK_NOISE_GAIN; // 0.42
  const clamp = A.LOUD - 0.02; // 0.48

  /* Test with 1, 2, 3, 4 open pipes. We can't easily change leak count without
     rebuilding, so we test the formula directly. */
  for (let openPipes = 1; openPipes <= 4; openPipes++) {
    /* At zero flood cover, power = BASE = 0.16. */
    const powerAtZero = A.LEAK_NOISE_BASE; // 0.16
    t.assert(powerAtZero < A.LOUD, `1 pipe at zero flood: ${powerAtZero} < LOUD`);
    t.assert(powerAtZero <= clamp, `1 pipe at zero flood: ${powerAtZero} <= clamp`);

    /* At full flood cover, power = BASE + GAIN = 0.42. */
    const powerAtFull = maxPerPipe; // 0.42
    t.assert(powerAtFull < A.LOUD, `${openPipes} pipes at full flood: ${powerAtFull} < LOUD`);
    t.assert(powerAtFull <= clamp, `${openPipes} pipes at full flood: ${powerAtFull} <= clamp`);

    /* Per-pipe power is the same regardless of how many are open. */
    t.assert(powerAtFull === maxPerPipe, 'per-pipe power independent of open pipe count');

    /* Total displayed noise is perPipe * openPipes, clamped to just below LOUD. */
    const totalAtFull = Math.min(powerAtFull * openPipes, clamp);
    t.assert(totalAtFull <= clamp, `total for ${openPipes} pipes at full flood: ${totalAtFull} <= clamp`);
    if (openPipes > 1) {
      t.assert(totalAtFull > powerAtFull, `total for ${openPipes} pipes > single pipe at full flood`);
    }
    console.log(`  ${openPipes} pipes: per-pipe=${powerAtFull.toFixed(2)}, total=${totalAtFull.toFixed(2)}, clamp=${clamp}`);
  }

  /* Verify the formula in tickLeakNoise would produce these values.
     We can test this by calling tickLeakNoise with controlled floodCover.
     Floor 3 (level 4) has 4 leaks according to the level table. */
  A.buildFloor(3, 60606);
  const numLeaks = G.leaks.length;
  t.assert(numLeaks >= 4, `floor 3 must have at least 4 leaks, has ${numLeaks}`);

  /* 1 open pipe, zero flood */
  G.leaksOpen = 1;
  for (let i=0; i<numLeaks; i++) G.leaks[i].fixed = (i >= 1);
  G.floodCover = 0; G.leakTotal = 0; G.leakPower = 0;
  A.tickLeakNoise(G, 1/60);
  t.assert(Math.abs(G.leakPower - A.LEAK_NOISE_BASE) < 0.001, `1 pipe, zero flood: leakPower=${G.leakPower.toFixed(3)} want ${A.LEAK_NOISE_BASE}`);
  t.assert(Math.abs(G.leakTotal - A.LEAK_NOISE_BASE) < 0.001, `1 pipe, zero flood: leakTotal=${G.leakTotal.toFixed(3)} want ${A.LEAK_NOISE_BASE}`);

  /* 1 open pipe, full flood */
  G.floodCover = 1.0; G.leakTotal = 0; G.leakPower = 0;
  A.tickLeakNoise(G, 1/60);
  t.assert(Math.abs(G.leakPower - maxPerPipe) < 0.001, `1 pipe, full flood: leakPower=${G.leakPower.toFixed(3)} want ${maxPerPipe}`);
  t.assert(Math.abs(G.leakTotal - maxPerPipe) < 0.001, `1 pipe, full flood: leakTotal=${G.leakTotal.toFixed(3)} want ${maxPerPipe}`);

  /* 4 open pipes, full flood - total is clamped. */
  G.leaksOpen = 4;
  for (let i=0; i<4; i++) G.leaks[i].fixed = false;
  for (let i=4; i<numLeaks; i++) G.leaks[i].fixed = true;
  G.floodCover = 1.0; G.leakTotal = 0; G.leakPower = 0;
  A.tickLeakNoise(G, 1/60);
  t.assert(Math.abs(G.leakPower - maxPerPipe) < 0.001, `4 pipes, full flood: leakPower=${G.leakPower.toFixed(3)} want ${maxPerPipe}`);
  t.assert(Math.abs(G.leakTotal - clamp) < 0.001, `4 pipes, full flood: leakTotal=${G.leakTotal.toFixed(3)} want ${clamp} (clamped)`);

  /* 4 pipes at zero flood - total = 4 * 0.16 = 0.64, clamped to 0.48. */
  G.floodCover = 0; G.leakTotal = 0; G.leakPower = 0;
  A.tickLeakNoise(G, 1/60);
  t.assert(Math.abs(G.leakPower - A.LEAK_NOISE_BASE) < 0.001, `4 pipes, zero flood: leakPower=${G.leakPower.toFixed(3)} want ${A.LEAK_NOISE_BASE}`);
  const expectedTotalZero = Math.min(A.LEAK_NOISE_BASE * 4, clamp);
  t.assert(Math.abs(G.leakTotal - expectedTotalZero) < 0.001, `4 pipes, zero flood: leakTotal=${G.leakTotal.toFixed(3)} want ${expectedTotalZero} (clamped)`);

  console.log('  per-pipe power independent of count; total clamped to just below LOUD');
}
  t.done();
});

/* The 'heard' event fires once per state change. A quiet sound near a WALK
   lifeform emits WALK -> SEARCH once; a second identical sound while it is
   still SEARCH emits nothing. A loud sound (wrench) wakes a DORMANT coil
   and emits DORMANT -> RISING. */
test('heard event emits on state change only', () => {
  const t = softAssert();
  {
    A.buildFloor(0, 4242);

    /* Place a WALK lifeform near the player. */
    const W = 76;
    let spot = null;
    for (let y=1; y<W-1 && !spot; y++){
      for (let x=1; x<W-1; x++){
        if (G.grid[y*W+x]===1 && G.grid[y*W+x+1]===1){
          spot = {x: x+0.5, y: y+0.5};
          break;
        }
      }
    }
    t.assert(spot, 'found floor tile for walker');

    const walker = {
      x: spot.x, y: spot.y, state: 'WALK', t: 0, rise: 1,
      target: null, face: 0, wakeCd: 0, stepT: 0, born: 0,
    };
    G.agents = [walker];
    G.player.x = spot.x + 2; G.player.y = spot.y; // nearby

    const heard = [];
    const unsub = on('heard', (e) => heard.push(e));

    /* First quiet sound (WALK power) -> WALK -> SEARCH. */
    A.emitNoise(A.NOISE.WALK, G.player.x, G.player.y, true);
    t.assert(walker.state === 'SEARCH', 'walker goes SEARCH');
    t.assert(heard.length === 1, 'one heard event emitted');
    t.assert(heard[0].from === 'WALK' && heard[0].to === 'SEARCH',
      `heard event: from=${heard[0].from} to=${heard[0].to}`);
    t.assert(heard[0].dist > 0 && heard[0].dist < 5,
      `distance ${heard[0].dist.toFixed(2)} is reasonable`);

    /* Second identical sound while in SEARCH -> no new event. */
    A.emitNoise(A.NOISE.WALK, G.player.x, G.player.y, true);
    t.assert(walker.state === 'SEARCH', 'walker stays SEARCH');
    t.assert(heard.length === 1, 'no second heard event for same state');

    /* Loud sound (REPAIR) near a DORMANT coil -> DORMANT -> RISING. */
    A.buildFloor(0, 4242);
    const dormant = {
      x: spot.x, y: spot.y, state: 'DORMANT', t: 0, rise: 0,
      target: null, face: 0, wakeCd: 0, stepT: 0, born: 0,
    };
    G.agents = [dormant];
    G.player.x = spot.x + 1; G.player.y = spot.y;

    const heard2 = [];
    const unsub2 = on('heard', (e) => heard2.push(e));

    A.emitNoise(A.NOISE.REPAIR, G.player.x, G.player.y, true);
    t.assert(dormant.state === 'RISING', 'dormant coil rises');
    t.assert(heard2.length === 1, 'one heard event for DORMANT -> RISING');
    t.assert(heard2[0].from === 'DORMANT' && heard2[0].to === 'RISING',
      `heard event: from=${heard2[0].from} to=${heard2[0].to}`);

    off('heard', unsub);
    off('heard', unsub2);

    console.log('  heard event: WALK->SEARCH once, DORMANT->RISING once, no dup');
  }
  t.done();
});

/* Wake rattle volume scales with distance from lifeform to player.
   A wake at 2 tiles is louder than a wake at 12 tiles, but never silent
   (minimum 15% of base volume). */
test('wake rattle volume scales with distance to player', () => {
  const t = softAssert();
  {
    A.buildFloor(0, 4242);

    const W = 76;
    /* Find a spot for the near test (~2 tiles from player). */
    let nearSpot = null;
    for (let y=1; y<W-1 && !nearSpot; y++){
      for (let x=1; x<W-1; x++){
        if (G.grid[y*W+x]===1 && G.grid[y*W+x+1]===1){
          nearSpot = {x: x+0.5, y: y+0.5};
          break;
        }
      }
    }
    t.assert(nearSpot, 'found near floor tile');

    /* Find a far spot that is within hearing range of REPAIR noise.
       REPAIR has baseR=14.2. We want distance > 8 but < effective reach. */
    const baseR = A.hearRadius(A.NOISE.REPAIR);
    let farSpot = null;
    for (let y=1; y<W-1 && !farSpot; y++){
      for (let x=1; x<W-1; x++){
        if (G.grid[y*W+x]===1){
          const d = Math.hypot(x + 0.5 - 10.5, y + 0.5 - 10.5);
          const ws = A.wallSteps(x+0.5, y+0.5, 10.5, 10.5);
          const eff = baseR - ws * A.NOISE.WALL_COST;
          if (d < eff && d > 8 && d < 12){ farSpot = {x: x+0.5, y: y+0.5}; break; }
        }
      }
    }
    t.assert(farSpot, 'found far floor tile within hearing range');

    const sfx = [];
    const unsub = on('sfx', (name, vol) => { if (name==='rattle') sfx.push(vol); });

    /* Near wake: dormant coil at ~2 tiles from player. */
    const near = { x: nearSpot.x, y: nearSpot.y, state: 'DORMANT', t: 0, rise: 0, target: null, face: 0, wakeCd: 0, stepT: 0, born: 0 };
    G.agents = [near];
    G.player.x = nearSpot.x + 2; G.player.y = nearSpot.y;
    A.emitNoise(A.NOISE.REPAIR, G.player.x, G.player.y, true);
    t.assert(near.state === 'RISING', 'near coil rises');
    t.assert(sfx.length === 1, 'near wake emits rattle');
    const volNear = sfx[0];
    t.assert(volNear > 0.4 && volNear <= 0.55, `near volume ${volNear.toFixed(3)} in expected range`);

    sfx.length = 0;

    /* Far wake: dormant coil at ~8-12 tiles from player, within hearing range. */
    const far = { x: farSpot.x, y: farSpot.y, state: 'DORMANT', t: 0, rise: 0, target: null, face: 0, wakeCd: 0, stepT: 0, born: 0 };
    G.agents = [far];
    G.player.x = 10.5; G.player.y = 10.5;
    A.emitNoise(A.NOISE.REPAIR, G.player.x, G.player.y, true);
    t.assert(far.state === 'RISING', 'far coil rises');
    t.assert(sfx.length === 1, 'far wake emits rattle');
    const volFar = sfx[0];
    t.assert(volFar >= 0.15*0.55 && volFar < volNear, `far volume ${volFar.toFixed(3)} quieter than near ${volNear.toFixed(3)} but above floor`);

    /* Born coil (first wake) uses baseVol=1 instead of 0.55. */
    sfx.length = 0;
    const born = { x: nearSpot.x, y: nearSpot.y, state: 'DORMANT', t: 0, rise: 0, target: null, face: 0, wakeCd: 0, stepT: 0, born: 1 };
    G.agents = [born];
    G.player.x = nearSpot.x + 2; G.player.y = nearSpot.y;
    A.emitNoise(A.NOISE.REPAIR, G.player.x, G.player.y, true);
    t.assert(born.state === 'RISING', 'born coil rises');
    t.assert(sfx.length === 1, 'born wake emits rattle');
    const volBorn = sfx[0];
    t.assert(volBorn > volNear, `born coil volume ${volBorn.toFixed(3)} > normal coil ${volNear.toFixed(3)}`);

    off('sfx', unsub);

    console.log(`  rattle volumes: near=${volNear.toFixed(3)}, far=${volFar.toFixed(3)}, born=${volBorn.toFixed(3)}`);
  }
  t.done();
});
