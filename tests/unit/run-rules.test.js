import test from 'node:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fakeAudioContext } from '../helpers/stubs.js';
import { softAssert } from '../helpers/soft-assert.js';
import { readCss, readHtml, readSrc } from '../helpers/src-text.js';
import { loadGame } from '../helpers/harness.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const { A, G, els, calls, store, press } = await loadGame();
const seededRNG = A.mulberry32(0xC0FFEE);
const moveEnt = A.moveEnt;
const blocked = A.blocked;
const keys = A.keys;
const emitNoise = A.emitNoise;
const buildFloor = A.buildFloor;
const update = A.update;
const render = A.render;


/* ============ TEST 22: the shape of the run — the five levels and the clock ===
   These are RULES, not tuning: the level table is a promise about what each
   level contains and the clock is a promise about how long you get. Neither is
   observable anywhere else in the suite — test 1 checks the built levels are
   internally consistent, and test 4 checks a bot can survive, but neither pins
   the numbers, so a well-behaved refactor could quietly turn a five-level run
   into a six-riser one or a three-minute clock into a five-minute one and the
   whole file would still go green. */
test('[22] the run — five levels, three minutes, one door', () => {
  const t = softAssert();
console.log('[22] the run — five levels, three minutes, one door');
{
  /* --- the level table is exactly the design --- */
  t.assert(A.LEVELS_N===5, `the run has ${A.LEVELS_N} levels, want 5`);
  /* Level 2 was one thing in the building and became two — the committed table
     in game.js says so, and its own comment says why ("twice the work, the
     building starts paying attention"). This literal was not moved with it, so
     the assertion that exists to pin the design was the thing disagreeing with
     the design. Pin what the game actually does; if the intent really is one
     lifeform on level 2, change game.js and this together, not one. */
  const want = [[1,1],[2,2],[3,2],[4,3],[4,4]];
  t.assert(A.LEVELS.length===want.length, `the level table has ${A.LEVELS.length} entries`);
  for (let i=0;i<want.length;i++){
    t.assert(A.LEVELS[i].leaks===want[i][0],
      `level ${i+1} has ${A.LEVELS[i].leaks} leaks, want ${want[i][0]}`);
    t.assert(A.LEVELS[i].forms===want[i][1],
      `level ${i+1} has ${A.LEVELS[i].forms} lifeforms, want ${want[i][1]}`);
  }
  console.log(`  level table: ${A.LEVELS.map((l,i)=>`${i+1}:${l.leaks}L/${l.forms}F`).join(' ')}`);

  /* --- and the BUILT levels match the table, on every level --- */
  for (let f=0; f<A.LEVELS_N; f++){
    buildFloor(f, 90210+f*131);
    t.assert(G.leaks.length===A.LEVELS[f].leaks, `built level ${f+1} has ${G.leaks.length} pipes`);
    t.assert(G.agents.length===A.LEVELS[f].forms, `built level ${f+1} has ${G.agents.length} lifeforms`);
    t.assert(G.exitTiles.length===1, `built level ${f+1} has ${G.exitTiles.length} doors`);
    t.assert(G.clock===180, `level ${f+1} opens with ${G.clock}s, want 180`);
  }
  console.log('  every built level matches its row and opens on 3:00');

  /* --- the clock counts down, and only down --- */
  {
    buildFloor(0, 4242);
    A.STATE='play';
    A.lives=3;
    t.assert(G.clock===180, 'the clock does not open on 3:00');
    A.updateReal(30);
    const t1 = G.clock;
    t.assert(Math.abs(t1-150) < 0.02, `30 seconds of play left ${t1}s on the clock, want 150`);
    A.updateReal(10);
    t.assert(G.clock < t1, 'the clock stopped');
    t.assert(Math.abs(G.clock-140) < 0.05, `the clock is running at the wrong rate: ${G.clock}`);
    console.log(`  the clock runs at wall speed (30s of play = ${t1}s)`);
  }

  /* --- it is fatal. A deadline that only scolds you is advice, and three
         minutes of advice is not a rule. It costs a life, exactly like being
         caught, and rewinds the level. --- */
  {
    buildFloor(0, 4242);
    A.STATE='play';
    A.lives=3; A.floorIdx=0;
    G.clock = 0.5;
    A.updateReal(1);
    t.assert(A.STATE!=='play', 'the clock ran out and nothing happened');
    const sub = els['dead-sub'].textContent;
    t.assert(/CLOCK/.test(sub), `running out of time said "${sub}"`);
    t.assert(A.lives===2, 'running out of time cost no life');
    /* and it is announced before it is fatal, so the last thirty seconds are
       the player's to spend rather than a surprise */
    buildFloor(0, 4242);
    A.STATE='play';
    A.lives=3;
    G.clock = 30.2;
    A.updateReal(0.5);
    t.assert(els['flashnote'].textContent.indexOf('THIRTY')>=0,
      `the last thirty seconds were silent (flash said "${els['flashnote'].textContent}")`);
    console.log('  the clock costs a life at zero and warns at thirty');
  }

  /* --- and it does NOT run while the game is paused ---
     A deadline that keeps draining behind a menu is the one version of this
     that would make players stop opening the pause screen at all.

     Tested through the REAL loop, not through update(): update() is not
     responsible for the pause, the frame is, and calling update() directly
     while paused would be testing a rule the game does not have. */
  {
    buildFloor(0, 4242);
    A.STATE='pause';
    const before = G.clock;
    let now = Date.now();
    const realPerf = global.performance;
    global.performance = { now: ()=> now };
    try {
      now += 1000; A.frame(now);
      t.assert(G.clock===before, 'the clock ran down while the game was paused');
      A.STATE='play';
      now += 1000; A.frame(now);
      t.assert(G.clock < before, 'the clock did not run once the game was live again');
    } finally {
      global.performance = realPerf;
      /* the loop leaves its own bookkeeping advanced; restore the world */
      buildFloor(0, 4242);
    }
    console.log('  the clock is frozen while paused');
  }

  /* --- the water is slow. The front is the clock's excuse and the player's
         only map of the level, so it has to be readable: at 1.4s a tile the
         floor was a lake inside half a minute and following it downhill stopped
         being something a player does. --- */
  t.assert(A.LEAK_SPREAD >= 3, `the water front is ${A.LEAK_SPREAD}s per tile — that is the old, unreadable speed`);
  /* ...and the recession has to clear the building inside the clock it is
     played against. The flood reaches G.wetMaxDist, which is 82-148 tiles out
     depending on the floor, so the drain is measured against the largest of
     those rather than against the arrival pace. */
  t.assert(A.LEAK_RETREAT < A.LEAK_SPREAD,
    `the recession is ${A.LEAK_RETREAT}s/tile against an arrival of ${A.LEAK_SPREAD} — the drain is a mop-up`);
  /* A TYPICAL floor, not the worst one. G.wetMaxDist runs 82-148 tiles out
     depending on the floor and the seed, and a floor flooded all the way to its
     far corner SHOULD still be draining when the clock goes — that is what a
     drowned level costs you. What must not happen is a normal floor still
     soaking on the walk home, so the bound is the mid-range floor (about 110
     tiles) plus the tail after the front reaches the pipes: the last tiles fade
     from 1 to the WET_EDGE snap in roughly ln(1/0.012) time constants. */
  t.assert(110*A.LEAK_RETREAT + 25 < A.FLOOR_CLOCK,
    `a typical floor (110 tiles at ${A.LEAK_RETREAT}s plus the tail) does not drain inside the ${A.FLOOR_CLOCK}s clock`);
  /* The wet band between dry carpet and open flood, in tiles, on both sides.
     It is what makes the waterline read as a shore rather than a hard edge,
     and it is only a band while the two directions agree. */
  {
    const bandUp   = A.WET_RISE / A.LEAK_SPREAD;
    const bandDown = A.WET_FALL / A.LEAK_RETREAT;
    t.assert(bandDown >= bandUp*0.9,
      `the wet band going out is ${bandDown.toFixed(1)} tiles against ${bandUp.toFixed(1)} coming in — `+
      'the recession dries faster than the waterline leaves and the edge goes hard');
    console.log(`  soak band: ${bandUp.toFixed(1)} tiles in, ${bandDown.toFixed(1)} tiles out`);
  }
  {
    /* measured, not asserted from the constant: 20 seconds of play must not
       move the waterline more than a few tiles. */
    buildFloor(0, 6161);
    const wet0 = A.internals.wetArr.reduce((a,b)=>a+(b>0.5?1:0),0);
    A.updateReal(20);
    const wet1 = A.internals.wetArr.reduce((a,b)=>a+(b>0.5?1:0),0);
    const tiles = (wet1-wet0)/3700;
    t.assert(tiles < 0.10, `20 seconds grew the flood by ${(tiles*100).toFixed(1)}% of the floor — too fast to read`);
    console.log(`  20s of play spreads the water ${(tiles*100).toFixed(1)}% of the floor`);
  }

  /* --- the door is where you came in, and you never have to find it --- */
  {
    buildFloor(0, 8080);
    const door = G.exitTiles[0];
    t.assert(G.exitTiles.length===1, `level 1 has ${G.exitTiles.length} doors`);
    const d = Math.hypot(door.x+0.5-G.player.x, door.y+0.5-G.player.y);
    t.assert(d < 14, `the door is ${d.toFixed(1)} tiles from the spawn — you did not come in through it`);
    /* and nothing in the game is looking for it: there is no discovery flag to
       flip and no search to run, which is the whole difference from the three
       exits this rule replaced. */
    t.assert(!('found' in door), 'the door still carries a found flag — something is looking for it');
    console.log(`  the door opens ${d.toFixed(1)} tiles from the spawn, with nothing to find`);
  }

  /* --- and the win card reports the RUN, not the floor it got printed on ---
     G.stat is thrown away and rebuilt by buildFloor, so the card used to read
     the LAST level's counters: a run that sealed 1+2+3+4+4 pipes across five
     levels and died once on level 2 reported four seals and no deaths. The card
     is the only place the whole run is ever summed, so this drives a whole run
     the real way — through the start button, through nextFloor(), one real
     death and a retry — and then reads what the card actually says. */
  {
    els['btn-start'].click();                       // the real start path clears the tally
    A.STATE = 'play';
    t.assert(A.runStat.sealed===0 && A.runStat.deaths===0 && A.runStat.noises===0,
      `starting a run left the totals at ${A.runStat.sealed}/${A.runStat.deaths}/${A.runStat.noises}`);
    let sealed = 0, noises = 0;
    for (let f=0; f<A.LEVELS_N; f++){
      if (f>0) A.nextFloor();   // walk through the door
      A.STATE = 'play';
      t.assert(G.leaks.length > 0, `level ${f+1} opened with no pipes to seal`);
      for (const L of G.leaks){ A.sealLeak(L); sealed++; }
      A.emitNoise(0.3, G.player.x, G.player.y);
      A.emitNoise(0.3, G.player.x, G.player.y);
      noises += 2;
      t.assert(A.runStat.sealed===sealed,
        `after ${f+1} level(s) the run has sealed ${A.runStat.sealed}, want ${sealed}`);
      if (f===1){
        /* die once, on level 2, the real way — the clock, not a direct call */
        G.clock = 0.5;
        A.updateReal(1);
        t.assert(A.STATE==='dead', 'the death on level 2 did not happen');
        t.assert(A.runStat.deaths===1, `the run has ${A.runStat.deaths} deaths, want 1`);
        els['btn-retry'].click();                   // the floor is rebuilt; the tally must not be
        A.STATE = 'play';
        t.assert(A.runStat.deaths===1 && A.runStat.sealed===sealed,
          'retrying the level cleared the run totals');
      }
    }
    A.nextFloor();        // floorIdx hits FLOORS: the card is printed
    t.assert(A.STATE==='win', `the run ended on STATE=${A.STATE}, not the win screen`);
    t.assert(G.stat.sealed !== sealed,
      'this assertion needs G.stat to differ from the run total or it proves nothing');
    const card = els['win-stats'].innerHTML;
    t.assert(card.includes(`<b>${sealed}</b> pipes`),
      `the win card does not report ${sealed} sealed pipes (said: ${card.slice(0,90)}...)`);
    t.assert(card.includes(`Deaths: <b>1</b>`), `the win card does not report 1 death (said: ${card.slice(0,90)}...)`);
    t.assert(card.includes(`Noise made: <b>${noises}</b>`),
      `the win card does not report ${noises} noises (said: ${card.slice(0,90)}...)`);
    console.log(`  the win card counts the run: ${sealed} pipes sealed, 1 death, ${noises} noises`);
    /* leave the world where the next test expects to find it */
    A.STATE = 'splash';
    A.lives=3; A.floorIdx=0; A.runTime=0;
    buildFloor(0, 4242);
  }
}
  t.done();
});

