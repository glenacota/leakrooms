import { SCORE } from '../config/constants.js';

/**
 * Counts the floors cleared without losing a crew member on them. A floor with
 * any lost attempt is not clean, even if a later attempt cleared it.
 *
 * @param {Array<{floor:number, died:boolean}>} runHistory
 * @returns {number}
 */
export function cleanFloors(runHistory){
  const cleared = new Set();
  const lost = new Set();
  for (const entry of runHistory) (entry.died ? lost : cleared).add(entry.floor);
  let n = 0;
  for (const floor of cleared) if (!lost.has(floor)) n++;
  return n;
}

/**
 * The early-completion premium: the share of the par time the shift saved,
 * paid out of SCORE.PREMIUM_MAX. Zero at or past par, and when there is no par.
 *
 * @param {number} time - seconds of play in the shift.
 * @param {number} parTime - the time allowance, in seconds.
 * @returns {number}
 */
export function earlyPremium(time, parTime){
  if (!(parTime > 0) || !(time >= 0)) return 0;
  const saved = Math.min(1, Math.max(0, 1 - time/parTime));
  return Math.round(SCORE.PREMIUM_MAX*saved);
}

/**
 * Scores a shift from its end-of-shift report.
 *
 * @param {{sealed:number, deaths:number, floors:number, time:number, parTime?:number, runHistory:object[]}} report
 * @param {boolean} won - the crew cleared the last floor.
 * @returns {{leaks:number, floors:number, premium:number, cleanFloors:number, clean:number, equipment:number, breach:number, total:number}}
 */
export function scoreRun(report, won){
  const leaks = report.sealed*SCORE.LEAK_PAY;
  const floors = won ? report.floors*SCORE.FLOOR_PAY : 0;
  // The premium is paid for delivering the shift. A shift that ends early by dying has not delivered.
  const premium = won ? earlyPremium(report.time, report.parTime) : 0;
  const casualties = report.deaths*SCORE.CASUALTY_COST;
  const breach = won ? 0 : SCORE.BREACH_FEE;
  return {
    leaks, floors, premium, casualties, breach,
    total: leaks + floors + premium - casualties - breach,
  };
}