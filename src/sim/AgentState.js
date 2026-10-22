/**
 * AgentState — agents, seenBy, nearest, arng, floor (for speed).
 */
import { mulberry32 } from '../util/rng.js';
import { spawnAgents } from './spawn.js';

export function createAgentState(level, seed, floorNum) {
  // Use a dedicated RNG stream for agent placement, separate from the layout RNG.
  // This makes the cast reproducible on retry regardless of how much the layout
  // RNG was consumed during level generation. The constants are arbitrary but fixed.
  const agentRng = mulberry32((seed ^ 0xC01) + floorNum * 131);
  return {
    agents: spawnAgents(level, agentRng),
    seenBy: 0,
    nearest: 99,
    arng: mulberry32((seed ^ 0xA6E27) + floorNum * 131),
    floor: floorNum,
  };
}