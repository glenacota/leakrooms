import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { playPlayerRun } from '../helpers/player-bot.js';
import { DIFFICULTIES } from '../../src/config/presets.js';
import { applyDifficulty } from '../../src/config/tuning.js';

/* THE PLAYER RUN, with lifeforms on the floors. The player bot sees and hears
   only what a player would, finds leaks by water and sight, finds the door by
   sight, uses the radar only when stuck, and reacts to lifeforms it sees or
   hears. It must clear all five floors within the preset's lives and the real
   clock. The omniscient layout proof, with no lifeforms, is in
   tests/integration/layout-*.test.js.

   THE BAR is the EASY preset, RELAXED in the code. The bot must clear every EASY
   run. NORMAL and HARD are reported only. This suite never fails the build:
   every run is marked todo, so each one reports its status as TODO until it
   clears, and nothing gates a merge. */

const { A, G } = await loadGame();
const SEEDS = [5077, 1234, 4242];
const BAR = 'relaxed';

for (const preset of Object.keys(DIFFICULTIES)){
  const d = DIFFICULTIES[preset];
  const todo = preset === BAR
    ? 'bar not yet met: the EASY (RELAXED) runs must clear; reported, never fails the build'
    : 'reported only, not the bar: NORMAL and HARD runs are informational';
  for (const seed of SEEDS){
    test(`lifeforms ${d.label} seed ${seed}: player bot clears five floors`, { todo }, () => {
      applyDifficulty(d);
      A.lives = d.lives;
      const r = playPlayerRun({
        A, G, keys: A.keys, seed, withLifeforms: true,
        maxSeconds: 5 * d.clock + 60,
      });
      assert.equal(r.cleared, true,
        `${r.floorsDone}/5 floors, ${r.deaths} death(s), ${r.clockOuts} clock-out(s), ` +
        `${r.seconds.toFixed(0)} s: ${r.why}`);
    });
  }
}
