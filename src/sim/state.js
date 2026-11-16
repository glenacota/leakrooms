import {
  createLevelState, createLeakState, createPlumberState, createLifeformState,
  createFloodState, createVisionState, createNoiseState, createClockState, createDoorState,
} from './state-domains.js';
/* All the state of the current floor lives behind G. No state exists until
   the first buildFloor() call, and buildFloor() replaces it completely, so
   nothing that belongs to a floor can outlive that floor. Every module reads
   the floor through G. */

let owners = null;

/* Internal domain fields stay addressable through G but out of its key list. */
const INTERNAL_KEYS = new Set(['clockAnnounced']);

function getTarget(k) {
  return owners?.get(k) ?? null;
}

function hasKey(k) {
  return owners?.has(k) ?? false;
}

function createOwners(nextDomains) {
  const nextOwners = new Map();
  for (const domain of Object.values(nextDomains)) {
    for (const key of Object.keys(domain)) {
      if (nextOwners.has(key)) {
        throw new Error(`State key "${key}" has multiple domain owners`);
      }
      nextOwners.set(key, domain);
    }
  }

  return nextOwners;
}

function listPublicKeys() {
  return [...owners.keys()].filter(key => !INTERNAL_KEYS.has(key));
}

/* G is a facade, not the state itself. Every G.<field> read or write is
   forwarded to the domain object behind it, so a retry can install a whole new
   floor while every reader keeps the same G reference. The facade also keeps
   the floor's keys enumerable, so Object.keys(G) still lists exactly what a
   built floor owns. */
export const G = new Proxy({}, {
  get(_, k) {
    const target = getTarget(k);
    return target ? target[k] : undefined;
  },
  set(_, k, v) {
    if (!owners) return true;
    const target = getTarget(k);
    if (!target) throw new Error(`Cannot assign unowned or computed G key "${String(k)}"`);
    target[k] = v;
    return true;
  },
  has(_, k) {
    return hasKey(k);
  },
  ownKeys() {
    return owners ? listPublicKeys() : [];
  },
  getOwnPropertyDescriptor(_, k) {
    if (!hasKey(k)) return undefined;
    return {
      configurable: true,
      enumerable: !INTERNAL_KEYS.has(k),
      writable: owners.has(k),
      value: G[k],
    };
  },
});

/* The floor's own state. Pure: it allocates arrays and clones the level's
   mutable parts, and touches no canvas. The canvases and the G-dependent
   ticks are finished by game/floor.js. Rendering is wired separately at boot. */
export function createGameState(level, floorNum, seed){
  return {
    level: createLevelState(level, floorNum, seed),
    leak: createLeakState(level),
    plumber: createPlumberState(level),
    lifeform: createLifeformState(level, seed, floorNum),
    flood: createFloodState(),
    vision: createVisionState(),
    noise: createNoiseState(),
    clock: createClockState(),
    door: createDoorState(),
  };
}

/* Set a floor's state behind the facade. */
export function setFloorState(d){
  const nextOwners = createOwners(d);
  owners = nextOwners;
}