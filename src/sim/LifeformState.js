/**
 * LifeformState — lifeforms, seenBy, nearest, arng, floor (for speed).
 */
import { mulberry32 } from '../util/rng.js';
import { spawnLifeforms } from './spawn.js';

export function createLifeformState(level, seed, floorNum) {
  // Use a dedicated RNG stream for lifeform placement, separate from the layout RNG.
  // This makes the cast reproducible on retry regardless of how much the layout
  // RNG was consumed during level generation. The constants are arbitrary but fixed.
  const lifeformRng = mulberry32((seed ^ 0xC01) + floorNum * 131);
  return {
    lifeforms: spawnLifeforms(level, lifeformRng),
    seenBy: 0,
    nearest: 99,
    arng: mulberry32((seed ^ 0xA6E27) + floorNum * 131),
    floor: floorNum,
  };
}