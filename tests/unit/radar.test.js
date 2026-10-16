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
    // 6 units at 5.6/s is 1.07s, so run 2s of frames
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

  /* --- while on, NOTHING is dark. Not the room behind you, not the far wall,
         not solid rock in the middle of a block. --- */
  G.radar = true;
  A.snapMask();
  {
    let dark=0, behind=0;
    for (let i=0;i<W*W;i++) if (A.internals.maskArr[i] < 0.999) dark++;
    // specifically: a tile directly behind the character, which is the one
    // thing the cone is certain to hide when the radar is off
    const px=Math.floor(G.player.x), py=Math.floor(G.player.y);
    for (const [dx,dy] of [[-3,0],[0,3],[3,0],[0,-3],[-6,-6],[7,5]]){
      const x=px+dx, y=py+dy;
      if (x<0||y<0||x>=W||y>=W) continue;
      if (A.internals.maskArr[y*W+x] < 0.999) behind++;
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
    const px=Math.floor(G.player.x), py=Math.floor(G.player.y);
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

  /* --- the reveal: a scrawl is read when the sweep puts it on screen ---
     There is nothing left in the world that NEEDS finding — the door is where
     you came in and the pipes announce themselves in water — so the radar is
     down to reading the carpet. That makes the on-screen rule the whole of
     what it does, and it is checked directly rather than left to the playthrough
     bot: a scrawl just off screen must NOT be read, and the frame it comes on
     screen it must be.

     The battery is held at full throughout. The radar dying mid-search is the
     economy, and test 4 covers that; here we are testing the RULE, and a rule
     you cannot observe because the tool ran out is not a rule. */
  {
    buildFloor(1, 3131);
    /* The rule is "read iff on screen", so it is tested by PLACING the player
       rather than walking there. Driving the player in a straight line by
       writing G.player directly fights unstick() — it shoves the player back
       out of every wall the line passes through — and the test ends up
       measuring the collision code. Placement tests the rule and nothing else. */
    const spotWith=(e, want)=>{
      for (let y=1;y<W-1;y++) for (let x=1;x<W-1;x++){
        if (G.grid[y*W+x]!==1) continue;
        G.player.x=x+0.5; G.player.y=y+0.5;
        if (A.onScreen(e.x+0.5, e.y+0.5) === want) return {x:x+0.5, y:y+0.5};
      }
      return null;
    };
    let negatives=0, positives=0;
    const reset=()=>{ for (const o of G.graffiti) o.seen=false; };
    for (const gr of G.graffiti){
      reset();
      // off screen: must NOT be read
      const off = spotWith(gr, false);
      if (off){
        G.player.x=off.x; G.player.y=off.y;
        G.radar=true;
        for (let i=0;i<5;i++){ G.batt=100; update(1/60); }
        if (!A.onScreen(gr.x+0.5, gr.y+0.5)){
          t.assert(gr.seen===false,
            `a scrawl was read while off screen — the sweep is seeing too much`);
          negatives++;
        }
      }
      // on screen: MUST be read
      reset();
      const on = spotWith(gr, true);
      if (on){
        G.player.x=on.x; G.player.y=on.y;
        G.radar=true; G.batt=100;
        update(1/60);
        t.assert(gr.seen, 'a scrawl was on screen and not read by the sweep');
        positives++;
      }
    }
    reset();
    t.assert(positives===G.graffiti.length && negatives>0,
      `checked ${negatives} off-screen and ${positives}/${G.graffiti.length} on-screen cases`);
    console.log(`  reveal rule holds: ${positives} on-screen read, ${negatives} off-screen not read`);
  }
}
  t.done();
});
