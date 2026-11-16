import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { playPlayerRun, classifyDeath } from '../helpers/player-bot.js';
import { DIFFICULTIES } from '../../src/config/presets.js';
import { applyDifficulty } from '../../src/config/tuning.js';

/* The five-floor run uses the real clock and retry lifecycle. Set
   PLAYER_BOT_NO_LIFEFORMS=1 for a same-seed navigation control.

   THE BAR is the EASY preset, RELAXED in the code. The bot must clear every EASY
   run. NORMAL and HARD are reported only. This suite never fails the build:
   every run is marked todo, so each one reports its status as TODO until it
   clears, and nothing gates a merge. */

const { A, G } = await loadGame();
const SEEDS = [5077, 1234, 4242];
const BAR = 'relaxed';
const withLifeforms = process.env.PLAYER_BOT_NO_LIFEFORMS !== '1';

/* "caught 5, clock 9" style summary of why the bot died, for the failure message. */
function tally(deathLog){
  const n = {};
  for (const d of deathLog){ const c = classifyDeath(d); n[c] = (n[c] || 0) + 1; }
  return Object.entries(n).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
}

for (const preset of Object.keys(DIFFICULTIES)){
  const d = DIFFICULTIES[preset];
  const todo = preset === BAR
    ? 'bar not yet met: the EASY (RELAXED) runs must clear; reported, never fails the build'
    : 'reported only, not the bar: NORMAL and HARD runs are informational';
  for (const seed of SEEDS){
    test(`${withLifeforms ? 'lifeforms' : 'no lifeforms'} ${d.label} seed ${seed}: player bot clears five floors`, { todo }, () => {
      A.setOption('difficulty', preset);
      applyDifficulty(d);
      const r = playPlayerRun({
        A, G, keys: A.keys, seed, withLifeforms,
        maxSeconds: (5 + d.lives - 1) * d.clock + 60,
        radarPolicy: process.env.PLAYER_BOT_RADAR || 'periodic',
        avoidancePolicy: process.env.PLAYER_BOT_AVOIDANCE || 'flee',
        waterPolicy: process.env.PLAYER_BOT_WATER || 'follow',
        explorationPolicy: process.env.PLAYER_BOT_EXPLORATION || 'walk',
        returnPolicy: process.env.PLAYER_BOT_RETURN || 'full',
        trace: process.env.PLAYER_BOT_TRACE === '1' ? sample => console.log(JSON.stringify(sample)) : undefined,
      });
      if (process.env.PLAYER_BOT_TRACE === '1')
        console.log(JSON.stringify({ event: 'result', seed, preset, withLifeforms, returnStats: r.returnStats }));
      assert.equal(r.cleared, true,
        `${r.floorsDone}/5 floors, ${r.deaths} death(s) [${tally(r.deathLog)}], ` +
        `${r.seconds.toFixed(0)} s: ${r.why}`);
    });
  }
}
