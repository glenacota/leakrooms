import test from 'node:test';
import { fakeAudioContext } from '../helpers/stubs.js';
import { softAssert } from '../helpers/soft-assert.js';
import { readCss, readHtml, readSrc } from '../helpers/src-text.js';
import { loadGame } from '../helpers/harness.js';

const { A, G, els, calls } = await loadGame();
const buildFloor = A.buildFloor;
const update = A.update;
const render = A.render;
const keys = A.keys;

/* ============ TEST 33: the noise meter ==========================
   The NOISE bar was drawn as G.noise/BATT_MAX — a sprint at 1.0 filled 1% of it
   and the door at 1.8 filled 1.8%, while the `hot` class fired on the raw level
   and turned the bar red at a level it could not show. Every value in the game
   is between 0 and 1.8, and the bar is divided by 100.

   Nothing in the sim noticed: the level is played by a bot, the HUD is read by
   a human, and a bar nobody in the suite looks at can be wrong forever. These
   are the numbers on the instrument, and the instrument is what tells the player
   what the Lifeform is hearing. */
test('[33] the noise meter — the scale, the marks, and the pipe that emits', () => {
  const t = softAssert();
console.log('[33] the noise meter — the scale, the marks, and the pipe that emits');
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
  /* 0.72 of 0.85 is 84.7%: the bar says 85, which is the whole claim. Asserted
     at the rounding the player actually sees, not at a number picked to make a
     test tidy. */
  t.assert(Math.abs(sprint-85) < 0.5, `a sprint fills the bar to ${sprint.toFixed(1)}%, expected 85`);
  near(wrench, 100, 'the wrench, the loudest sustained thing you do');
  near(door, 100, 'the door — past full scale is clamped, not overflowing');
  t.assert(val()===100, `the number beside the bar reads ${val()} at the wrench`);
  t.assert(walk < wade && wade < loud && loud < sprint && sprint < wrench,
    `the bar does not rank the actions the AI ranks (${walk}, ${wade}, ${loud}, ${sprint}, ${wrench})`);
  /* and the threshold is marked where it actually is, from the constant */
  near(parseFloat(H.noiseLoud.style.left), pct(A.LOUD), 'the LOUD hairline');

  /* and the red is LOUD, on YOUR noise, not a stale copy of it. 0.45 was
     hard-coded next to a threshold that lives at 0.5. */
  show(0.46);
  t.assert(!H.noiseWrap.classList.contains('hot'),
    'the bar goes red below LOUD — it is still testing the old 0.45');
  show(A.LOUD);
  t.assert(H.noiseWrap.classList.contains('hot'), 'LOUD does not turn the bar red');

  /* the standing hiss of the open pipes, as its own fill UNDER yours. It is the
     number the agents steer by, and it is not about you. */
  show(0.22, 0.24);
  near(parseFloat(H.noiseLeak.style.width), pct(0.24), 'the leak fill');
  show(0.22, 0);
  t.assert(H.noiseLeak.style.width==='0%', 'the leak fill is still drawn with every pipe sealed');

  /* --- and the thing this whole split exists for: standing still ---
     Standing beside a burst pipe used to fill the bar to the top, which reads as
     "you are screaming" when you are standing perfectly still and something is
     on its way to the PIPE. Your share has to be zero when you have done
     nothing, and the building's has to still be there. */
  {
    buildFloor(1, 60606);
    const L = G.leaks.find(l=>!l.fixed);
    /* two tiles from the pipe, not ON it: standing inside REPAIR_REACH starts a
       repair, and a repair is the loudest thing you can do — which is the whole
       point of it, and not what this block is about */
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
    /* wet boots are louder than dry ones, and this spot may be flooded — so the
       number to check is the one the movement stage itself used */
    const stepPower = A.wetAt(G.player.x, G.player.y) > 0.25 ? 0.30 : 0.22;
    near(G.selfNoise, stepPower, 'your own noise after twenty frames of walking');
    keys['d'] = false;
    for (let i=0;i<40;i++) update(1/60);          // 0.66s of decay at 1.55/s
    A.updateHUD();
    t.assert(G.selfNoise===0, `your noise is still at ${G.selfNoise.toFixed(2)} a second after you stopped`);
  }


  /* and the peak, because a sprint is 0.26s long and the fill alone cannot say
     whether it happened */
  /* below full scale, so the decay is visible at all — a peak of 1.0 would sit
     clamped at the right-hand end for its whole life */
  show(0.1); G.noisePeak = 0.6; A.updateHUD();
  /* one frame of decay (0.004) happens before the draw, so the tick sits a
     fraction under the level it is holding */
  near(parseFloat(H.noisePeak.style.left), pct(0.6-0.004), 'the peak tick');
  const before = parseFloat(H.noisePeak.style.left);
  for (let i=0;i<30;i++) A.updateHUD();
  const after = parseFloat(H.noisePeak.style.left);
  t.assert(after < before, `the peak tick never came down (${before}% -> ${after}%)`);

  /* --- and it holds up while the game is actually being played, which is the
     only place the numbers above are a lie if the sim does not produce them --- */
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
    `sprint ${running.toFixed(0)}%, wrench 100%, door clamps; peak ${before.toFixed(0)}% -> ${after.toFixed(0)}%`);

  /* ============ WHERE THE PIPE MAKES ITS NOISE ============
     A pipe is broken in a WALL; you stand on the floor tile beside it to wrench
     it. The noise was emitted from the wall tile — L.x/L.y, the masonry — and
     alert() hands the source coordinate straight to the entity as the place to
     walk to. So a Lifeform that heard a pipe was sent to the inside of a wall
     and stood there grinding its collision disc against brick, which is a bug
     no bot in this suite can see because a bot never walks toward a leak.

     It is asserted the way it fails: stand an entity next to an open pipe, run
     one real frame, and check that where it was told to go is a tile it can
     stand on. */
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
    /* a walkable neighbour of the stand tile: close enough that the pipe's own
       noise reaches it, which is the whole point of a standing noise source */
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
    /* park the player at the far side of the map: the claim under test is about
       hearing, and a Lifeform that can SEE the player is hunting for a reason
       this test did not set up */
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


/* ---- WALLS MUFFLE A SOUND -------------------------------------------------
   hearRadius() says how far a power carries through open floor. Until now
   nothing subtracted the building: the only thing between a sound and an ear
   was the distance, and the line of walls between them was sampled on a
   diagonal, which counts the walls that happen to lie on that diagonal and
   ignores the ones you are looking at. So a walk three walls away was heard
   exactly as loudly as a walk five tiles away in the open, which is the one
   piece of cover this maze offers.

   Three claims: a walk is lost behind three walls and not in the open, and a
   sprint — LOUD, 12.6 tiles — still crosses one wall and wakes a sleeping coil.
   The powers themselves are asserted unchanged: this is the shape of the room,
   not the loudness of the game. */
test('[44] walls muffle a sound, and the loudest one still carries', () => {
  const t = softAssert();
console.log('[44] walls muffle a sound, and the loudest one still carries');
{
  const W = 76, H = 76;
  const FLOOR_T = 1;
  const at = (x,y)=> (x<0||y<0||x>=W||y>=H) ? FLOOR_T : G.grid[y*W+x];

  /* A straight run of floor with exactly `walls` masonry tiles in it, and one
     more floor tile past them — so the listener is five tiles from the sound,
     three walls in. Scanned, not planted: a real maze position is the claim,
     and a hand-built grid would only prove the arithmetic. */
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

  /* Search a few seeds for a floor that has the geometry to ask the question
     in — a BSP maze at this size almost always does, and the fallback is a
     second building rather than a skipped assertion. */
  let murdled = null, clear = null;
  for (const seed of [4242, 60606, 88, 9001, 31337, 12345]){
    A.buildFloor(0, seed);
    murdled = findRun(3); clear = findClear();
    if (murdled && clear) break;
  }
  t.assert(!!(murdled && clear), 'no floor in six seeds has three walls and five clear tiles in a row — the scan is wrong');

  /* BEHIND THREE WALLS: a walk is 6.6 tiles, three walls take nine off that. */
  A.buildFloor(0, 4242);
  {
    const a = put(murdled.ear, 'WALK');
    A.sustainedNoise(0.22, murdled.src.x, murdled.src.y);
    t.assert(a.state==='WALK',
      `a walk three walls and five tiles away still turned the listener to ${a.state} — the walls are not in the way`);
  }

  /* THE SAME DISTANCE, NOTHING IN BETWEEN. */
  A.buildFloor(0, 4242);
  {
    const a = put(clear.ear, 'WALK');
    A.sustainedNoise(0.22, clear.src.x, clear.src.y);
    t.assert(a.state==='SEARCH',
      `a walk four tiles away in the open left the listener ${a.state} — and now nothing carries at all`);
  }

  /* ...and one wall is not cover from a sprint. LOUD crosses masonry. */
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

  /* The table itself is untouched: this is the shape of the room, not the
     loudness of the game. */
  t.assert(A.LOUD===0.5, `LOUD is ${A.LOUD} — the noise contract is not this task's to move`);
  t.assert(A.SPRINT_NOISE===0.72 && A.REPAIR_NOISE===0.85,
    'a noise power moved — only WALL_COST was supposed to change');
  console.log('  walk lost behind three walls, heard in the open, sprint crosses one');
}
  t.done();
});
