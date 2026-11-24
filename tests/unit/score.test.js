import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTIES } from '../../src/config/presets.js';
import { LEVELS, LEVELS_N } from '../../src/config/levels.js';
import { SCORE } from '../../src/config/constants.js';
import { cleanFloors, earlyPremium, scoreRun } from '../../src/game/score.js';

const TOTAL_LEAKS = LEVELS.reduce((n, level) => n + level.leaks, 0);
const par = terms => LEVELS_N*terms.clock;
const attempt = (floor, died) => ({ floor, sealed: 0, total: 0, clockLeft: 0, died });

test('[SCORE] the rates are pinned, so changing one is a deliberate act', () => {
  assert.deepEqual({ ...SCORE }, {
    LEAK_PAY: 100, FLOOR_PAY: 50, PREMIUM_MAX: 300,
    CASUALTY_COST: 150, BREACH_FEE: 300,
  });
});

test('[SCORE] a task pays less than a loss costs, and a loss costs less than a breach', () => {
  assert.ok(SCORE.FLOOR_PAY < SCORE.LEAK_PAY, 'a floor handover pays more than the leak it follows');
  assert.ok(SCORE.LEAK_PAY < SCORE.CASUALTY_COST, 'losing a crew member is cheaper than a leak is worth');
  assert.ok(SCORE.CASUALTY_COST < SCORE.BREACH_FEE, 'a breach is cheaper than a single loss');
});

test('[SCORE] a floor is clean only if no crew member was lost on it', () => {
  assert.equal(cleanFloors([]), 0);
  assert.equal(cleanFloors([attempt(0, false)]), 1);
  assert.equal(cleanFloors([attempt(0, true), attempt(0, false)]), 0, 'a later clear does not wash out a loss');
  assert.equal(cleanFloors([attempt(0, true)]), 0, 'a floor never cleared is not clean');
  assert.equal(cleanFloors([attempt(0, false), attempt(1, true), attempt(1, false), attempt(2, false)]), 2);
});

test('[SCORE] the premium falls linearly from the maximum at no time to zero at par', () => {
  assert.equal(earlyPremium(0, 900), SCORE.PREMIUM_MAX);
  assert.equal(earlyPremium(450, 900), SCORE.PREMIUM_MAX/2);
  assert.equal(earlyPremium(900, 900), 0);
  assert.equal(earlyPremium(1200, 900), 0, 'past par pays nothing and never charges');
  let previous = Infinity;
  for (let time = 0; time <= 900; time += 30){
    const pay = earlyPremium(time, 900);
    assert.ok(pay <= previous, `the premium rose at ${time} s`);
    previous = pay;
  }
});

test('[SCORE] no par, or no usable time, pays no premium', () => {
  for (const [time, parTime] of [[100, undefined], [100, 0], [100, NaN], [undefined, 900], [-5, 900]])
    assert.equal(earlyPremium(time, parTime), 0, `${time}/${parTime}`);
});

test('[SCORE] a completed run adds every line and subtracts the charges', () => {
  const score = scoreRun({
    sealed: 12, deaths: 2, floors: 5, time: 300, parTime: 900,
    runHistory: [attempt(0, false), attempt(1, true), attempt(1, false), attempt(2, false), attempt(3, false), attempt(4, false)],
  }, true);
  assert.deepEqual(score, { leaks: 1200, floors: 250, premium: 200, casualties: 300, breach: 0, total: 1350 });
});

test('[SCORE] a failed run pays no floor handover and no premium, and owes the breach fee', () => {
  const score = scoreRun({
    sealed: 3, deaths: 3, floors: 2, time: 1, parTime: 900,
    runHistory: [attempt(0, false), attempt(1, true), attempt(1, true), attempt(1, true)],
  }, false);
  assert.deepEqual(score, { leaks: 300, floors: 0, premium: 0, casualties: 450, breach: 300, total: -450 });
});

test('[SCORE] the best possible completed run scores 1950', () => {
  const runHistory = [0, 1, 2, 3, 4].map(floor => attempt(floor, false));
  const score = scoreRun({ sealed: TOTAL_LEAKS, deaths: 0, floors: LEVELS_N, time: 0, parTime: 900, runHistory }, true);
  assert.equal(score.total, 1950);
});

/* The ordering the leaderboard depends on: on any one terms level a failed run
   never outranks a completed one. The worst completed run loses a crew member on
   as many different floors as the crew allows and takes the full par time. The
   best failed run spends the whole crew on the last floor. Both sealed every leak. */
const EXPECTED = { relaxed: [1050, 350], normal: [1350, 650], hard: [1650, 950] };

test('[SCORE] on every preset the worst completed run beats the best failed run', () => {
  for (const [name, terms] of Object.entries(DIFFICULTIES)){
    const deaths = terms.lives - 1;
    const worstWin = [];
    for (let floor = 0; floor < LEVELS_N; floor++){
      if (floor < deaths) worstWin.push(attempt(floor, true));
      worstWin.push(attempt(floor, false));
    }
    const win = scoreRun({ sealed: TOTAL_LEAKS, deaths, floors: LEVELS_N, time: par(terms), parTime: par(terms), runHistory: worstWin }, true);

    const bestFail = [];
    for (let floor = 0; floor < LEVELS_N - 1; floor++) bestFail.push(attempt(floor, false));
    for (let crew = 0; crew < terms.lives; crew++) bestFail.push(attempt(LEVELS_N - 1, true));
    const fail = scoreRun({ sealed: TOTAL_LEAKS, deaths: terms.lives, floors: LEVELS_N, time: 1, parTime: par(terms), runHistory: bestFail }, false);

    assert.ok(win.total > fail.total, `${name}: a failed run (${fail.total}) outscores a completed one (${win.total})`);
    assert.deepEqual([win.total, fail.total], EXPECTED[name], name);
  }
});