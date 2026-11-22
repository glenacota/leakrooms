/* Delivery uses a listener snapshot so (un)sub calls during an emit cannot skip
   or repeat listeners. Cache snapshots and discard them when the listener set changes;
   emit runs often enough to make copying costly. */

export const EVENT = Object.freeze({
  sfx: 'sfx',
  heard: 'heard',
  stat: 'stat',
  caught: 'caught',
  flash: 'flash',
  doorCycled: 'door:cycled',
  waterChanged: 'waterChanged',
  tileChanged: 'tileChanged',
  clockOut: 'clock:out',
  sprint: 'sprint',
  maskChanged: 'maskChanged',
  splashRepaint: 'splash:repaint',
  clearShow: 'clear:show',
  screen: 'screen',
  hud: 'hud',
  state: 'state',
  win: 'win',
  lives: 'lives',
  dead: 'dead',
  reset: 'reset',
  runStart: 'run:start',
  floorPreparing: 'floorPreparing',
  floorBuilt: 'floorBuilt',
  resize: 'resize',
  settingsChanged: 'settings:changed',
  particle: 'particle',
  contextrestored: 'contextrestored',
  inputMode: 'input:mode',
  inputLost: 'input:lost',
  tutorialsReset: 'tutorials:reset',
  tutorialsResetResult: 'tutorials:reset-result',
  tutorialsReplayStarted: 'tutorials:replay-started',
  tutorialsReplayCardOpened: 'tutorials:replay-card-opened',
});

/* Event contracts stay beside their names so producers and consumers can
   inspect the shared protocol without changing the bus or its timing. */
export const EVENT_CONTRACTS = Object.freeze({
  [EVENT.sfx]: {
    purpose: 'Play a named audio voice.',
    args: '[name: string, ...voiceArgs: number[]]; voice arguments depend on name.',
    producers: [
      'src/sim/update.js', 'src/sim/plumber.js', 'src/sim/leaks.js',
      'src/sim/door.js', 'src/sim/noise.js', 'src/sim/clock.js',
      'src/game/run.js', 'src/ui/input.js', 'src/ui/cards.js',
    ],
    consumers: ['src/ui/bind.js', 'src/ui/haptics.js'],
  },
  [EVENT.heard]: {
    purpose: 'Report a lifeform hearing or noticing a sound-driven state change.',
    args: '[{from: state, to: state, dist: number}]; state: "DORMANT" | "RISING" | "WALK" | "SEARCH" | "HUNT".',
    producers: ['src/sim/noise.js'],
    consumers: ['src/ui/hints.js', 'src/ui/haptics.js'],
  },
  [EVENT.stat]: {
    purpose: 'Report a run statistic increment.',
    args: '[key: "noises" | "sealed"]',
  },
  [EVENT.caught]: {
    purpose: 'Report that a lifeform caught the plumber.',
    args: '[]',
  },
  [EVENT.flash]: {
    purpose: 'Show a categorized message to the player.',
    args: '[{cat: "danger" | "alert" | "guide" | "info" | "lore", text: string}]',
    producers: [
      'src/sim/lifeforms.js', 'src/sim/leaks.js', 'src/sim/plumber.js',
      'src/sim/clock.js', 'src/sim/lore.js', 'src/ui/input.js',
      'src/ui/hints.js', 'src/ui/tutorials.js',
    ],
    consumers: ['src/ui/bind.js', 'src/ui/hud.js'],
  },
  [EVENT.doorCycled]: {
    purpose: 'Report that the plumber held the exit long enough to cycle it.',
    args: '[]',
  },
  [EVENT.waterChanged]: {
    purpose: 'Mark the full water surface dirty.',
    args: '[]',
    producers: ['src/sim/flood.js', 'src/sim/leaks.js'],
    consumers: ['src/render/floor-surfaces.js'],
  },
  [EVENT.tileChanged]: {
    purpose: 'Mark one water tile dirty.',
    args: '[tileIndex: integer]',
    producers: ['src/sim/flood.js'],
    consumers: ['src/render/floor-surfaces.js'],
  },
  [EVENT.clockOut]: {
    purpose: 'Report that the floor clock reached zero.',
    args: '[]',
  },
  [EVENT.sprint]: {
    purpose: 'Report that the plumber sprinted during this floor.',
    args: '[floorIndex: integer]',
  },
  [EVENT.maskChanged]: {
    purpose: 'Mark the visibility-mask surface dirty.',
    args: '[]',
    producers: ['src/sim/vision.js'],
    consumers: ['src/render/floor-surfaces.js'],
  },
  [EVENT.splashRepaint]: {
    purpose: 'Request a repaint of the title-screen floor plan.',
    args: '[]',
  },
  [EVENT.clearShow]: {
    purpose: 'Request that the floor-clear screen be shown.',
    args: '[]',
  },
  [EVENT.screen]: {
    purpose: 'Show the screen for the current run state.',
    args: '[screen: string | null]; null hides all screens.',
    producers: ['src/game/run.js'],
    consumers: ['src/ui/bind.js'],
  },
  [EVENT.hud]: {
    purpose: 'Set HUD visibility for the current run state.',
    args: '[showing: boolean]',
    producers: ['src/game/run.js'],
    consumers: ['src/ui/bind.js'],
  },
  [EVENT.state]: {
    purpose: 'Announce the current run state after screen and HUD events.',
    args: '[state: string]',
    producers: ['src/game/run.js'],
    consumers: ['src/ui/bind.js', 'src/ui/hints.js', 'src/ui/touch.js'],
  },
  [EVENT.win]: {
    purpose: 'Provide run results to the win screen.',
    args: '[{sealed: number, deaths: number, noises: number, floors: number, time: number, terms: string, runHistory: object[]}]',
    producers: ['src/game/run.js'],
    consumers: ['src/ui/cards.js'],
  },
  [EVENT.lives]: {
    purpose: 'Request a refresh of the lives display.',
    args: '[]',
  },
  [EVENT.dead]: {
    purpose: 'Provide remaining lives and death cause to the death card.',
    args: '[{lives: number, cause: string, report: object}]',
    producers: ['src/game/run.js'],
    consumers: ['src/ui/cards.js', 'src/ui/haptics.js'],
  },
  [EVENT.reset]: {
    purpose: 'Announce whether the run reset action is armed.',
    args: '[armed: boolean]',
  },
  [EVENT.runStart]: {
    purpose: 'Report that a new run has started.',
    args: '[]',
  },
  [EVENT.floorPreparing]: {
    purpose: 'Provide the static level so render surfaces can prepare before floor state changes.',
    args: '[key: string, level: static level from getStaticLevel()]',
    producers: ['src/game/floor.js'],
    consumers: ['src/boot.js', 'src/render/floor-surfaces.js'],
  },
  [EVENT.floorBuilt]: {
    purpose: 'Report that floor state and render-only floor state are ready.',
    args: '[]',
    producers: ['src/game/floor.js'],
    consumers: ['src/render/passes/ripples.js', 'src/ui/tutorials.js'],
  },
  [EVENT.resize]: {
    purpose: 'Report that the game canvas dimensions changed.',
    args: '[]',
  },
  [EVENT.settingsChanged]: {
    purpose: 'Report a settings update; "*" means all settings changed.',
    args: '[key: string | "*"]',
  },
  [EVENT.particle]: {
    purpose: 'Request a visual particle at a world position.',
    args: '[x: number, y: number]',
  },
  [EVENT.contextrestored]: {
    purpose: 'Report that the game canvas graphics context was restored.',
    args: '[]',
  },
  [EVENT.inputMode]: {
    purpose: 'Set the active input mode.',
    args: '[mode: "kbm" | "touch"]',
  },
  [EVENT.inputLost]: {
    purpose: 'Report loss of window focus so active input can be released.',
    args: '[]',
  },
  [EVENT.tutorialsReset]: {
    purpose: 'Request that tutorial history be reset.',
    args: '[]',
  },
  [EVENT.tutorialsResetResult]: {
    purpose: 'Report whether tutorial history was reset.',
    args: '[success: boolean]',
  },
  [EVENT.tutorialsReplayStarted]: {
    purpose: 'Report that tutorial replay became pending.',
    args: '[]',
  },
  [EVENT.tutorialsReplayCardOpened]: {
    purpose: 'Report that the first replayed tutorial card opened.',
    args: '[]',
  },
});

const listeners = new Map();
const delivery = new Map();

export function on(type, fn){
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  delivery.delete(type);
  return () => off(type, fn);
}

export function off(type, fn){
  const set = listeners.get(type);
  if (!set) return;
  set.delete(fn);
  delivery.delete(type);
  if (set.size === 0) listeners.delete(type);
}

export function emit(type, ...args){
  const set = listeners.get(type);
  if (!set || set.size === 0) return;
  let list = delivery.get(type);
  if (!list){ list = [...set]; delivery.set(type, list); }
  for (const fn of list) fn(...args);
}

export function clearAll(){
  listeners.clear();
  delivery.clear();
}