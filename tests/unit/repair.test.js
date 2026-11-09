import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';

const { A, G, calls } = await loadGame();
const keys = A.keys;
const buildFloor = A.buildFloor;
const update = A.update;
A.setHeadless(false, false);

/* ============ TEST 16: the repair ===============================
   Five seconds, standing still. The failure modes are all about the bar: it
   filling while you walk away, losing saved progress on interruption, filling
   without noise, or completing twice. Each of those makes the mechanic free or broken. With
   several leaks on a level there are two more: sealing the one you are at
   while another is still open, and double-counting the tallies. */
test('[16] the repair — five seconds, standing still', () => {
  const sa = softAssert();
console.log('[16] the repair — five seconds, standing still');
{
  const W=76;

  /* --- placing the player ON a leak, without fighting unstick() ---
     WHICH leak is the argument: every assertion below is about a single riser,
     and on a four-riser level the interesting question is whether the game seals
     the one you are standing at and leaves the rest alone. */
  const firstOpen = () => G.leaks.find(L=>!L.fixed);
  const standAt = (L) => {
    const r = L || firstOpen();
    G.plumber.x = r.sx+0.5; G.plumber.y = r.sy+0.5;
    return r;
  };

  /* --- the spot exists and is in reach --- */
  buildFloor(1, 77777);
  const L0 = standAt();
  sa.assert(A.leakReach(G.plumber.x, G.plumber.y),
    'standing on the leak does not put you in repair reach');
  sa.assert(A.leakReach(L0.sx+0.5, L0.sy+0.5),
    'the centre of the repair spot is not in reach');
  /* and it must NOT be in reach from across the room, or the repair is a
     proximity accident rather than a decision */
  sa.assert(!A.leakReach(L0.sx+0.5 + A.REPAIR_REACH + 0.5, L0.sy+0.5),
    'you can wrench the leak from outside the reach radius');

  /* --- holding still fills the bar, and it takes the stated five seconds --- */
  {
    /* Pinned to ONE riser. The loop deliberately does not hop to the next open
       leak when this one seals — that is a different test (below), and a loop
       that retargets mid-hold silently measures the whole level's work and
       calls it one repair. */
    standAt(L0);
    keys.w=keys.s=keys.a=keys.d=false; keys.shift=false;
    let frames=0, t=0;
    while (L0.repair < A.REPAIR_TIME && !L0.fixed && frames < 4000){
      G.plumber.x = L0.sx+0.5; G.plumber.y = L0.sy+0.5;
      update(1/60); t += 1/60; frames++;
    }
    const sealed = G.leaks.filter(l=>l.fixed);
    sa.assert(L0.fixed, `held still for ${t.toFixed(1)}s and the leak never sealed`);
    sa.assert(sealed.length===1, `${sealed.length} leaks sealed from one hold — it took the lot at once`);
    sa.assert(sealed[0]===L0, 'the riser that sealed was not the one the player was standing at');
    /* exactly the stated time, within a frame — a bar that fills early is a
       bar that was not asking for anything */
    sa.assert(Math.abs(t - A.REPAIR_TIME) < 0.06,
      `the repair took ${t.toFixed(2)}s, want ${A.REPAIR_TIME}s`);
    console.log(`  held still: one riser sealed in ${t.toFixed(2)}s (stated ${A.REPAIR_TIME}s), `+
      `${G.openLeaks} still open`);
  }

  /* --- exactly once: repairing a sealed leak does nothing --- */
  {
    sa.assert(L0.fixed===true, 'the leak did not stay sealed');
    const before = G.stat.sealed;
    const openBefore = G.openLeaks;
    standAt(L0);
    for (let i=0;i<600;i++){
      G.plumber.x = L0.sx+0.5; G.plumber.y = L0.sy+0.5;
      update(1/60);
    }
    sa.assert(L0.repair===0, `a sealed leak still has ${L0.repair}s of progress on it`);
    sa.assert(G.stat.sealed===before, `sealLeak ran ${G.stat.sealed-before} extra times`);
    sa.assert(G.openLeaks===openBefore, 'standing on a sealed riser changed the open count');
    /* the others are still going, so the floor is still making noise */
    sa.assert(G.leakPower>0, 'every riser went quiet while some were still open');
    console.log('  a sealed riser cannot be re-wrenched; the open ones keep dripping');
  }

  /* --- Breaking contact pauses repair but preserves progress per leak --- */
  {
    buildFloor(1, 31415);
    const L = standAt();
    A.tickRepair(1, false, false);
    const partial = L.repair;
    sa.assert(partial > 0 && partial < A.REPAIR_TIME, `progress after one second is ${partial}`);
    sa.assert(L.repairing, 'repair was not marked active while the plumber stood still');
    const wrenchDelay = L.wrenchT;

    G.noise = G.selfNoise = 0;
    A.tickRepair(1/60, true, false);
    sa.assert(L.repair===partial, `moving changed saved progress from ${partial} to ${L.repair}`);
    sa.assert(!L.repairing, 'repair remained active while the plumber moved');
    sa.assert(G.noise===0 && G.selfNoise===0, 'interrupted repair emitted repair noise');
    sa.assert(L.wrenchT===wrenchDelay, 'moving advanced the wrench sound timer while repair was paused');

    A.tickRepair(1/60, false, true);
    sa.assert(L.repair===partial, `a wall bump changed saved progress from ${partial} to ${L.repair}`);
    sa.assert(!L.repairing, 'repair remained active after a wall bump');

    G.plumber.x = L.sx + A.REPAIR_REACH + 1;
    G.plumber.y = L.sy + 0.5;
    A.tickRepair(1/60, false, false);
    sa.assert(L.repair===partial, `leaving reach changed saved progress from ${partial} to ${L.repair}`);
    sa.assert(!L.repairing, 'repair remained active after leaving reach');
    sa.assert(L.wrenchT===wrenchDelay, 'leaving reach advanced the wrench sound timer');

    standAt(L);
    A.tickRepair(1/60, false, false);
    sa.assert(L.repair > partial, 'repair did not resume from its saved progress');
    sa.assert(L.repairing, 'repair was not marked active after resuming');
    sa.assert(L.wrenchT < wrenchDelay, 'resuming repair did not continue the wrench sound timer');
    console.log(`  interruption preserves ${partial.toFixed(2)}s of progress and repair resumes`);
  }

  /* --- progress on one leak is independent of work on another --- */
  {
    buildFloor(A.LEVELS_N-1, 31416);
    const [first, second] = G.leaks.filter(leak=>!leak.fixed);
    sa.assert(first && second, 'the last floor needs two open leaks for the independence check');
    if (first && second){
      standAt(first);
      A.tickRepair(0.5, false, false);
      const firstProgress = first.repair;
      standAt(second);
      A.tickRepair(0.5, false, false);
      sa.assert(first.repair===firstProgress, 'working on another leak changed the first leak progress');
      sa.assert(second.repair===0.5, `second leak progress is ${second.repair}, expected 0.5`);
      sa.assert(!first.repairing && second.repairing, 'the active repair marker is on the wrong leak');
    }
  }

  /* --- the wrench is LOUD, and loud enough to wake a dormant lifeform --- */
  {
    /* Level 5, because that is the level with four things in it — the assertion
       below needs a dormant one, and level 1 has a single walker. */
    buildFloor(A.LEVELS_N-1, 5150);
    const L = standAt();
    /* a dormant agent placed right next to the leak must WAKE from the repair
       alone — the whole tension of the mechanic is that standing still
       announces you, so this asserts the announcement is real. */
    const sleeper = G.lifeforms.find(a=>a.state==='DORMANT');
    sa.assert(sleeper, 'level 5 has no dormant Lifeform to wake — the tension cannot exist');
    if (sleeper){
      sleeper.x = L.sx+0.5; sleeper.y = L.sy+0.5; sleeper.born=0;
      for (let i=0;i<90;i++){
        G.plumber.x = L.sx+0.5; G.plumber.y = L.sy+0.5;
        update(1/60);
        if (sleeper.state!=='DORMANT') break;
      }
      sa.assert(sleeper.state!=='DORMANT',
        'a Lifeform lying on the leak never woke to the wrench — the repair is silent');
      console.log('  wrenching wakes a Lifeform standing on the leak');
    }
  }

  /* --- the door is sealed until EVERY riser is ---
     With four bursts on a level this is the rule that matters most and the one
     most easily half-implemented: "the door is shut" can mean "no riser is
     sealed" (wrong), "the riser you last touched is sealed" (wrong), or "all of
     them are" (right). The middle one is the bug that lets a player walk out
     on a level they have left three-quarters flooded, and it is invisible until
     you test it deliberately. */
  {
    buildFloor(3, 24680);          // level 4: four leaks
    sa.assert(G.leaks.length===4, `expected 4 leaks on level 4, got ${G.leaks.length}`);
    /* nextFloor() increments a global, and this file is not at floor 0 by now.
       The question is "did the level end", so the baseline is where it started. */
    const f0 = A.floorIdx;
    const door = G.exitTiles[0];
    const atDoor = ()=>{ G.plumber.x = door.x+0.5; G.plumber.y = door.y+0.5; };
    const others = G.leaks.slice(0, G.leaks.length-1);

    /* Sitting on the door with the work undone: nothing happens, however long
       the player is willing to stand there. */
    atDoor();
    for (let i=0;i<400;i++){ G.batt=100; update(1/60); }
    sa.assert(A.floorIdx===f0,
      `descended with leaks open — the door is supposed to stay shut (floorIdx ${A.floorIdx})`);
    sa.assert(G.descend===0, `the door cycled ${G.descend.toFixed(2)}s with leaks open`);

    /* Seal all but the last, one at a time, and try the door after EACH. This is
       the case the old three-exit rule could not even express. */
    for (const L of others){
      A.sealLeak(L);
      atDoor();
      for (let i=0;i<200;i++){ G.batt=100; update(1/60); }
      sa.assert(A.floorIdx===f0,
        `descended with ${G.openLeaks} riser(s) still open — the gate is not "all of them"`);
      sa.assert(G.descend===0, `the door cycled ${G.descend.toFixed(2)}s with ${G.openLeaks} open`);
    }
    console.log(`  door stays sealed through all ${others.length} partial repairs`);

    /* and only the last one opens it, which proves the gate is the leaks and
       not some side effect of the loop above */
    const last = G.leaks[G.leaks.length-1];
    A.sealLeak(last);
    atDoor();
    let opened=false;
    for (let i=0;i<200 && !opened;i++){
      G.batt=100; update(1/60);
      if (A.floorIdx>f0) opened=true;
    }
    sa.assert(opened, 'with every riser sealed the door never opened — the gate is not the leaks');
    console.log('  sealing the LAST riser opens the door');
    /* put the global back — the remaining tests assume floor 0-ish state */
    A.floorIdx=0;
  }

  /* Test 17 is the ONLY test that reads a packed image back as pixels, so
     pixel packing is switched off again from here. Tests 18 and 19 assert on
     draw CALLS and on the mask array, neither of which needs the images
     rebuilt every frame. */
  A.setHeadless(false, true);
}
  sa.done();
});
