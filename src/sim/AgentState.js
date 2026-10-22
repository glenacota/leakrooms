/**
 * AgentState — agents, seenBy, nearest, arng, floor (for speed).
 */
import { mulberry32 } from '../util/rng.js';
import { spawnAgents } from './spawn.js';

export function createAgentState(level, seed, floorNum) {
  return {
    agents: spawnAgents(level),
    seenBy: 0,
    nearest: 99,
    arng: mulberry32((seed ^ 0xA6E27) + floorNum * 131),
    floor: floorNum,
  };
}