/**
 * LeakState — per-pipe mutable fields + leaksOpen/pipes.
 * The leaks array is cloned from the level so each floor owns its copy.
 */
export function createLeakState(level) {
  const leaks = level.leaks.map(L => ({ ...L }));
  return {
    leaks,
    leaksOpen: level.leaks.length,
    pipes: level.leaks.length,
  };
}