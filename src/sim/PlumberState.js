/**
 * PlumberState — plumber, batt, radar, radarRattleT.
 */
import { BATT_MAX } from '../config/constants.js';

export function createPlumberState(level) {
  return {
    plumber: { x: level.spawn.x, y: level.spawn.y, face: -Math.PI / 2, stepT: 0, stepDur: 0.46, moving: false },
    batt: BATT_MAX,
    radar: false,
    radarRattleT: 0,
  };
}