import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';

const { A, G } = await loadGame();
const buildFloor = A.buildFloor;
const update = A.update;
A.setHeadless(false, true);

/* ============ TEST 14: the radar ===============================
   Off by default. While on, the whole floor is visible — no dark spots. It
   drains more than twice what the torch it replaced did, and that is the only
   thing keeping it from being a free win.

   The dangerous failure is not "the radar does too little", it is "the radar
   does too much for too little": a sweep that were cheap, or that leaked on
   after hitting zero, would remove the entire battery economy. */
test('[14] the radar — off by default, total while on, expensive', () => {
  const t = softAssert();
console.log('[14] the radar — off by default, total while on, expensive');
{
  const W=76;

  buildFloor(0, 9090);
  t.assert(G.radar===false, 'the radar starts on — it is a tool you pay for, not a light');

  /* --- cost: a full battery must be a decision, not a convenience --- */
  t.assert(A.RADAR_DRAIN > 4.0,
    `the radar drains ${A.RADAR_DRAIN}/s — the torch it replaced cost 2.4 and could be held indefinitely`);
  const seconds = 100/A.RADAR_DRAIN;
  t.assert(seconds < 25,
    `a full battery buys ${seconds.toFixed(0)}s of sweep — that is long enough to stop thinking about it`);
  console.log(`  ${A.RADAR_DRAIN}/s — a full battery is ${seconds.toFixed(0)} seconds of seeing everything`);

  /* --- drain, and it switches itself off at zero rather than going negative */
  {
    G.radar = true; G.batt = 6;
    // 6 units at 10/s is 0.6s, so run 2s of frames
    for (let i=0;i<120;i++) update(1/60);
    t.assert(G.radar===false, 'the radar stayed on after the battery ran out');
    t.assert(G.batt===0, `battery went to ${G.batt}, want exactly 0`);
    t.assert(G.batt>=0, 'battery went negative');
  }
  /* --- and it drains again from a fresh charge, at the same rate --- */
  {
    G.batt = 100; G.radar = true;
    for (let i=0;i<60;i++) update(1/60);
    const used = 100 - G.batt;
    t.assert(Math.abs(used - A.RADAR_DRAIN) < 0.05,
      `1 second of sweep cost ${used.toFixed(2)}, want ${A.RADAR_DRAIN}`);
    t.assert(G.radar===true, 'the radar switched itself off with a full battery');
    G.radar = false; G.batt = 100;
  }

  /* --- a full battery is exactly 10 seconds of sweep (Numbers Policy: B) ---
     Pass/fail: 100 units drain at RADAR_DRAIN/s in 10s. If the number feels
     too stingy in play, move RADAR_DRAIN down; if too generous, move it up. */
  {
    G.batt = 100; G.radar = true;
    const frames = 10 * 60; // 10 seconds at 60 Hz
    for (let i=0;i<frames;i++) update(1/60);
    t.assert(G.radar===false, 'the radar stayed on past a full 10s battery');
    t.assert(G.batt===0, `battery after 10s of sweep is ${G.batt}, want exactly 0`);
    G.radar = false; G.batt = 100;
  }

  /* --- while on, NOTHING is dark. Not the room behind you, not the far wall,
         not solid rock in the middle of a block. --- */
  G.radar = true;
  A.snapMask();
  {
    let dark=0, behind=0;
    for (let i=0;i<W*W;i++) if (A.internals.maskArr[i] < 0.149) dark++;
    // specifically: a tile directly behind the character, which is the one
    // thing the cone is certain to hide when the radar is off
    const px=Math.floor(G.plumber.x), py=Math.floor(G.plumber.y);
    for (const [dx,dy] of [[-3,0],[0,3],[3,0],[0,-3],[-6,-6],[7,5]]){
      const x=px+dx, y=py+dy;
      if (x<0||y<0||x>=W||y>=W) continue;
      if (A.internals.maskArr[y*W+x] < 0.149) behind++;
    }
    t.assert(dark===0, `${dark} tiles are still dark with the radar on — it has to have no dark spots`);
    t.assert(behind===0, `${behind} tiles around the player are dark with the radar on`);
    console.log(`  radar on: 0 of ${W*W} tiles dark`);
  }

  /* --- off again, the cone comes straight back, including BEHIND you --- */
  G.radar = false;
  A.snapMask();
  {
    /* Find a floor tile genuinely behind the character and out of its cone —
       the radar-off case has to be a real occlusion, not just "somewhere
       dark", or the assertion proves nothing. */
    const px=Math.floor(G.plumber.x), py=Math.floor(G.plumber.y);
    let checked=0;
    for (let d=2; d<=8; d++){
      const x=px-d, y=py;
      if (x<0||y<0||x>=W||y>=W) continue;
      const i=y*W+x;
      if (G.grid[i]!==1) continue;
      if (A.internals.visArr[i] >= 0.999) continue;      // same lit region, not a scope test
      checked++;
      if (A.internals.maskArr[i] > 0.02){
        t.assert(false, `a tile ${d} tiles behind the character is still lit with the radar off`);
      }
    }
    let dark=0;
    for (let i=0;i<W*W;i++) if (A.internals.maskArr[i] < 0.02) dark++;
    t.assert(checked>0 || dark>200,
      'with the radar off the cone restores no darkness anywhere');
    t.assert(dark>200, `only ${dark} tiles dark with the radar off — the cone is not doing anything`);
    console.log(`  radar off: ${dark} tiles dark again, including ${checked} tiles behind the player`);
  }

}
  t.done();
});

/* ============ TEST 14b: the radar makes noise while it is on ============
   Switching the radar on is not silent: it pings at RADAR (0.5) every frame
   while it is active, loud enough to wake sleepers and pull hunters. The
   noise is the player's own (mine=true), so it shows on the noise bar. */
test('[14b] the radar hums at RADAR while on, and goes quiet when off', () => {
  const t = softAssert();
  buildFloor(0, 9090);

  /* The radar starts silent. */
  t.assert(G.selfNoise===0, 'the radar is silent before it is switched on');

  /* Turn it on: sustained noise at 0.5 from the first frame. */
  G.radar = true; G.batt = 100;
  update(1/60);
  t.assert(G.selfNoise===A.NOISE.RADAR,
    `one frame of radar leaves selfNoise at ${G.selfNoise.toFixed(2)}, want ${A.NOISE.RADAR}`);
  for (let i=0;i<119;i++) update(1/60);
  t.assert(G.selfNoise===A.NOISE.RADAR,
    `two seconds of radar lets selfNoise slip to ${G.selfNoise.toFixed(2)}, want ${A.NOISE.RADAR}`);

  /* The noise bar reflects it. */
  A.updateHUD();
  t.assert(parseFloat(G.selfNoise.toFixed(2))===0.5,
    `selfNoise reads ${G.selfNoise.toFixed(2)}, want 0.50`);

  /* Switch it off: the hum stops and the meter decays at 1.55/s. */
  G.radar = false;
  for (let i=0;i<60;i++) update(1/60);   // 1 second of decay
  t.assert(G.selfNoise===0, `one second after switching off, selfNoise is ${G.selfNoise.toFixed(2)}, want 0`);
  console.log(`  radar hums at ${A.RADAR_NOISE} while on, decays to 0 within a second of going off`);;
});

