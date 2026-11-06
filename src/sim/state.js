import {
  createLevelState, createLeakState, createPlumberState, createLifeformState,
  createFloodState, createVisionState, createNoiseState, createClockState, createDoorState,
} from './state-domains.js';
import { repaintDirty } from '../util/repaint.js';

/* All the state of the current floor lives behind G. No state exists until
   the first buildFloor() call, and buildFloor() replaces it completely, so
   nothing that belongs to a floor can outlive that floor. Every module reads
   the floor through G. */

let domains = null;
let owners = null;
/* The public keys of the installed floor, in domain order. Derived once per
   install from the domain objects, so a new field needs no second list. */
let publicKeys = null;
let publicKeySet = null;

/* Internal domain fields stay addressable through G but out of its key list. */
const INTERNAL_KEYS = new Set(['clockAnnounced']);

/* Keys that exist on the facade but are computed/assembled (not owned by a single domain). */
const COMPUTED_KEYS = new Set(['gfx', 'dirty']);

function getTarget(k) {
  if (!domains) return null;
  const owner = owners.get(k);
  return owner ? domains[owner] : null;
}

function hasKey(k) {
  if (!domains) return false;
  return owners.has(k) || COMPUTED_KEYS.has(k);
}

function createOwners(nextDomains) {
  const nextOwners = new Map();
  for (const [domainName, domain] of Object.entries(nextDomains)) {
    for (const key of Object.keys(domain)) {
      if (COMPUTED_KEYS.has(key)) {
        throw new Error(`State domain "${domainName}" claims computed G key "${key}"`);
      }
      if (nextOwners.has(key)) {
        throw new Error(`State key "${key}" has multiple domain owners`);
      }
      nextOwners.set(key, domainName);
    }
  }

  return nextOwners;
}

/* The public key list: every owned field except the internal ones, then the
   computed keys. Reading it from the owners keeps the list and the ownership
   map from drifting apart. */
function listPublicKeys(nextOwners) {
  const keys = [...nextOwners.keys()].filter(key => !INTERNAL_KEYS.has(key));
  return [...keys, ...COMPUTED_KEYS];
}

function assembleGfx(d) {
  return {
    lightCv: d.level.lightCv, lightCtx: d.level.lightCtx, lightImg: d.level.lightImg,
    maskCv: d.vision.maskCv, maskCtx: d.vision.maskCtx, maskImg: d.vision.maskImg,
    tilesCv: d.level.tilesCv, tilesCtx: d.level.tilesCtx,
    wallsCv: d.level.wallsCv, wallsCtx: d.level.wallsCtx,
    wetCv: d.flood.wetCv, wetCtx: d.flood.wetCtx, wetImg: d.flood.wetImg,
  };
}

/* G is a facade, not the state itself. Every G.<field> read or write is
   forwarded to the domain object behind it, so a retry can install a whole new
   floor while every reader keeps the same G reference. The facade also keeps
   the floor's keys enumerable, so Object.keys(G) still lists exactly what a
   built floor owns. */
export const G = new Proxy({}, {
  get(_, k) {
    if (!domains) return undefined;
    if (k === 'gfx') return assembleGfx(domains);
    if (k === 'dirty') return repaintDirty;
    const target = getTarget(k);
    return target ? target[k] : undefined;
  },
  set(_, k, v) {
    if (!domains) return true;
    const target = getTarget(k);
    if (!target) throw new Error(`Cannot assign unowned or computed G key "${String(k)}"`);
    target[k] = v;
    return true;
  },
  has(_, k) {
    return hasKey(k);
  },
  ownKeys() {
    return domains ? publicKeys : [];
  },
  getOwnPropertyDescriptor(_, k) {
    if (!hasKey(k)) return undefined;
    return {
      configurable: true,
      enumerable: publicKeySet.has(k),
      writable: owners.has(k),
      value: G[k],
    };
  },
});

/* The floor's own state. Pure: it allocates arrays and clones the level's
   mutable parts, and touches no canvas. The canvases and the G-dependent
   ticks are finished by game/floor.js, which owns the render side. */
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

/* Installs a floor's state (from createGameState) behind the facade. */
export function installFloorState(d){
  const nextOwners = createOwners(d);
  const nextKeys = listPublicKeys(nextOwners);
  domains = d;
  owners = nextOwners;
  publicKeys = nextKeys;
  publicKeySet = new Set(nextKeys);
}