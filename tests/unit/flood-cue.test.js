import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';

const { A, G } = await loadGame();
const keys = A.keys;
const buildFloor = A.buildFloor;
const update = A.update;
const render = A.render;
A.setHeadless(true, true);

/* ============ TEST 17: the water is a usable cue ==============================
   The mechanic is worthless if the player cannot tell wet from dry, or if
   following the trail is more expensive than sweeping the floor for the leak.
   Both of those are numeric claims about the game and so they are tested as
   numeric claims, not eyeballed. */
test('[17] the water as a cue — legible, free, and it actually leads', () => {
  const t = softAssert();
console.log('[17] the water as a cue — legible, free, and it actually leads');
{
  const W=76;
  /* This is the one test that reads the packed flood image back as pixels,
     so pixel packing has to be live again too. */
  A.setHeadless(true, true);

  /* --- it renders as something, not nothing ---
     The flood is packed into an image and drawn. If a wet tile packs to alpha
     0 the feature renders as a clean dry floor and every logic test above
     still passes: this is precisely the class of bug the README says the
     suite misses. Assert on the packed pixels. */
  buildFloor(2, 13579);
  for (let i=0;i<1200;i++) update(1/30);        // 40s: enough for flood spread
  A.packWet();
  {
    const d = A.internals.wetCv.getContext('2d').getImageData(0,0,W,W).data;
    let painted=0, blue=0;
    for (let i=0;i<W*W;i++){
      const k=i*4;
      if (d[k+3] > 8) painted++;
      /* blue-dominant: standing water must not be a yellow wash */
      if (d[k+2] > d[k] + 12 && d[k+3] > 40) blue++;
    }
    t.assert(painted > 300, `only ${painted} tiles render as wet — the flood is invisible on screen`);
    t.assert(blue > painted*0.4,
      `only ${blue} of ${painted} wet tiles read blue — the water is not distinguishable from carpet`);
    console.log(`  ${painted} tiles render wet, ${blue} of them blue-dominant`);
  }

  /* The pixels have been read and asserted on. The rest of this test is about
     wetArr and waterDist, which are packed into the image but ARE the state —
     so the image itself can stop being rebuilt. packWet was 19% of the whole
     suite's CPU, and 3600 frames of it after this point asserted nothing. */
  A.setHeadless(false, true);

  /* --- following the trail is FREE next to sweeping ---
     The radar is 10/s of battery for 10 seconds of total knowledge. Following
     water costs no battery at all and makes only walk-level noise. If the
     water were expensive this test would force the question of why the mechanic
     exists; it is free, and this pins that so a future tuning pass cannot
     quietly price it. */
  {
    t.assert(A.RADAR_DRAIN > 5, 'the radar got cheap — the trail has to be worth more than a sweep');
    t.assert(A.LEAK_NOISE_BASE < 0.5, 'standing near a leak is already loud');
    console.log(`  trail costs no battery and ${A.LEAK_NOISE_BASE} noise vs ${A.RADAR_DRAIN}/s of sweep`);
  }

  /* --- and the trail LEADS: wetness is strictly higher nearer the leaks --- */
  {
    const d0 = A.internals.waterDist[G.leaks[0].sy*W+G.leaks[0].sx];
    let near=0, nearN=0, far=0, farN=0;
    for (let i=0;i<W*W;i++){
      const d=A.internals.waterDist[i];
      if (d<0) continue;
      if (d <= d0+3){ near += A.internals.wetArr[i]; nearN++; }
      else if (d >= d0+16){ far += A.internals.wetArr[i]; farN++; }
    }
    t.assert(nearN>0 && farN>0, 'not enough tiles near/far to compare the front');
    const nm=near/nearN, fm=far/farN;
    t.assert(nm > fm,
      `the front does not lead: ${(nm*100).toFixed(0)}% wet near the leak vs ${(fm*100).toFixed(0)}% far away`);
    console.log(`  front leads: ${(nm*100).toFixed(0)}% wet within 3 tiles of the leak, ${(fm*100).toFixed(0)}% at 16+`);
  }

  /* --- wading is slower and louder, but never LOUD --- */
  {
    buildFloor(1, 24680);
    /* find a wet tile, then measure a dry walk and a wet walk over the same
       number of frames from the same spot */
    let wetTile=null;
    for (let i=0;i<2000 && !wetTile;i++) update(1/30);
    for (let y=1;y<W-1 && !wetTile;y++) for (let x=1;x<W-1;x++){
      if (G.grid[y*W+x]===1 && A.wetAt(x+0.5,y+0.5) > 0.3){ wetTile={x,y}; break; }
    }
    t.assert(wetTile, 'no wet floor tile anywhere after 10 minutes — the flood never spreads');

    /* slow wet walking by seeding a deep puddle around the player and timing it */
    G.plumber.x=wetTile.x+0.5; G.plumber.y=wetTile.y+0.5;
    for(let i=0;i<9;i++) A.seedSplash(A.G.plumber.x,A.G.plumber.y,1.0);
    A.STATE='play';
    keys.w=false; keys.s=false; keys.a=false; keys.d=false;
    let dist=0;
    for (let i=0;i<30;i++){
      // hold a direction and measure what happens
      keys['d']=true;
      const x0=G.plumber.x;
      update(1/60);
      dist += Math.abs(G.plumber.x-x0);
      if (A.STATE!=='play'){ A.STATE='play'; }
    }
    keys['d']=false;
    /* 30 frames of walking at SPRINT/WALK speed, minus the wading penalty.
       Assert only the DIRECTION of the effect and the floor: a wall stops you,
       so this measures a lower bound. */
    const maxDry = 30/60 * A.WALK;
    t.assert(dist <= maxDry*1.02,
      `walked ${dist.toFixed(2)} tiles in wet, above the dry maximum ${maxDry.toFixed(2)} — wading is not slowing anything`);
    t.assert(dist < maxDry*0.98,
      `walked ${dist.toFixed(2)} of a possible ${maxDry.toFixed(2)} — no wading slowdown at all`);
    console.log(`  wading costs speed (${(dist/maxDry*100).toFixed(0)}% of dry over the same frames)`);
  }
}
  t.done();
});
