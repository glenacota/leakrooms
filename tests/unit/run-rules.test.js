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


/* The level table and the clock are the promises this file defends. Other
   tests check that the built levels are self-consistent and that a bot can
   survive, but neither pins the numbers, so a tidy refactor could quietly
   turn a five-level run into a six-riser one and the suite would stay green. */
test('the run is five levels, three minutes and one door', () => {
  const t = softAssert();
{
  t.assert(A.LEVELS_N===5, `the run has ${A.LEVELS_N} levels, want 5`);
  /* Level 2 carries two lifeforms. This literal and the table in
     src/config/levels.js have to change together; pin what the game does. */
  const want = [[1,1],[2,2],[3,2],[4,3],[4,4]];
  t.assert(A.LEVELS.length===want.length, `the level table has ${A.LEVELS.length} entries`);
  for (let i=0;i<want.length;i++){
    t.assert(A.LEVELS[i].leaks===want[i][0],
      `level ${i+1} has ${A.LEVELS[i].leaks} leaks, want ${want[i][0]}`);
    t.assert(A.LEVELS[i].lifeforms===want[i][1],
      `level ${i+1} has ${A.LEVELS[i].lifeforms} lifeforms, want ${want[i][1]}`);
  }
  console.log(`  level table: ${A.LEVELS.map((l,i)=>`${i+1}:${l.leaks}L/${l.lifeforms}F`).join(' ')}`);

  /* The built levels have to match the table, on every level. */
  for (let f=0; f<A.LEVELS_N; f++){
    buildFloor(f, 90210+f*131);
    t.assert(G.leaks.length===A.LEVELS[f].leaks, `built level ${f+1} has ${G.leaks.length} pipes`);
    t.assert(G.lifeforms.length===A.LEVELS[f].lifeforms, `built level ${f+1} has ${G.lifeforms.length} lifeforms`);
    t.assert(G.exitTiles.length===1, `built level ${f+1} has ${G.exitTiles.length} doors`);
    t.assert(G.clock===180, `level ${f+1} opens with ${G.clock}s, want 180`);
  }
  console.log('  every built level matches its row and opens on 3:00');

  /* The clock counts down at wall speed, and only down. */
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

  /* Running out of clock costs a life, exactly like being caught. A deadline
     that only scolds you is advice, not a rule. */
  {
    buildFloor(0, 4242);
    A.STATE='play';
    A.lives=3; A.floorIdx=0;
    G.clock = 0.5;
    A.updateReal(1);
    t.assert(A.STATE!=='play', 'the clock ran out and nothing happened');
    const title = els['dead-title'].textContent;
    t.assert(title === "TIME'S UP", `running out of time set title to "${title}"`);
    t.assert(A.lives===2, 'running out of time cost no life');
    /* It is announced before it is fatal, so the last thirty seconds are
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

  /* The clock does not run while the game is paused; a deadline that drains
     behind a menu is the one version players would work around.
     Driven through the real frame: the frame owns the pause, not update(). */
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
      /* the loop left its own bookkeeping advanced, so rebuild the world */
      buildFloor(0, 4242);
    }
    console.log('  the clock is frozen while paused');
  }

  /* The water has to be readable. At 1.4s a tile the floor was a lake inside
     half a minute, and following the front downhill stopped being something
     a player does. */
  t.assert(A.LEAK_SPREAD >= 3, `the water front is ${A.LEAK_SPREAD}s per tile — that is the old, unreadable speed`);
  /* The recession has to clear the building inside the clock it is played
     against. The flood reaches G.wetMaxDist, 82 to 148 tiles out depending on
     the floor, so the drain is measured against the largest of those. */
  t.assert(A.LEAK_RETREAT < A.LEAK_SPREAD,
    `the recession is ${A.LEAK_RETREAT}s/tile against an arrival of ${A.LEAK_SPREAD} — the drain is a mop-up`);
  /* A typical floor, not the worst one. A floor flooded to its far corner
     should still be draining when the clock goes, but a normal one must not be
     soaking on the walk home, so the bound is a mid-range floor plus the tail
     after the front reaches the pipes. */
  t.assert(110*A.LEAK_RETREAT + 25 < A.FLOOR_CLOCK,
    `a typical floor (110 tiles at ${A.LEAK_RETREAT}s plus the tail) does not drain inside the ${A.FLOOR_CLOCK}s clock`);
  /* The wet band between dry carpet and open flood, in tiles, on both sides.
     It is a band only while the two directions agree. */
  {
    const bandUp   = A.WET_RISE / A.LEAK_SPREAD;
    const bandDown = A.WET_FALL / A.LEAK_RETREAT;
    t.assert(bandDown >= bandUp*0.9,
      `the wet band going out is ${bandDown.toFixed(1)} tiles against ${bandUp.toFixed(1)} coming in — `+
      'the recession dries faster than the waterline leaves and the edge goes hard');
    console.log(`  soak band: ${bandUp.toFixed(1)} tiles in, ${bandDown.toFixed(1)} tiles out`);
  }
  {
    /* Measured rather than asserted from the constant: 20 seconds of play must
       not move the waterline more than a few tiles. */
    buildFloor(0, 6161);
    const wet0 = A.internals.wetArr.reduce((a,b)=>a+(b>0.5?1:0),0);
    A.updateReal(20);
    const wet1 = A.internals.wetArr.reduce((a,b)=>a+(b>0.5?1:0),0);
    const tiles = (wet1-wet0)/3700;
    t.assert(tiles < 0.10, `20 seconds grew the flood by ${(tiles*100).toFixed(1)}% of the floor — too fast to read`);
    console.log(`  20s of play spreads the water ${(tiles*100).toFixed(1)}% of the floor`);
  }

  /* The door is where you came in, and you never have to find it. */
  {
    buildFloor(0, 8080);
    const door = G.exitTiles[0];
    t.assert(G.exitTiles.length===1, `level 1 has ${G.exitTiles.length} doors`);
    const d = Math.hypot(door.x+0.5-G.plumber.x, door.y+0.5-G.plumber.y);
    t.assert(d < 14, `the door is ${d.toFixed(1)} tiles from the spawn — you did not come in through it`);
    /* Nothing in the game looks for it: there is no discovery flag to flip and
       no search to run. */
    t.assert(!('found' in door), 'the door still carries a found flag — something is looking for it');
    console.log(`  the door opens ${d.toFixed(1)} tiles from the spawn, with nothing to find`);
  }

  /* The win card reports the whole run. G.stat is thrown away and rebuilt by
     buildFloor, so the card has to read the run totals instead; it is the
     only place the run is ever summed. This drives a whole run the real way:
     the start button, nextFloor(), one death and a retry. */
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
      A.emitNoise(0.3, G.plumber.x, G.plumber.y);
      A.emitNoise(0.3, G.plumber.x, G.plumber.y);
      noises += 2;
      t.assert(A.runStat.sealed===sealed,
        `after ${f+1} level(s) the run has sealed ${A.runStat.sealed}, want ${sealed}`);
      if (f===1){
        /* die once, on level 2, the real way: the clock, not a direct call */
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

