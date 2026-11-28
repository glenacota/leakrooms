import { mulberry32 } from '../../src/util/rng.js';
import { LEVELS, LEVELS_N } from '../../src/config/levels.js';
import { DIFFICULTIES, WATER_TINTS } from '../../src/config/presets.js';
import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA, SETTINGS_KEY, settingsValid } from '../../src/settings/schema.js';
import { FLOORS, FLOOR_CLOCK, REPAIR_TIME, HUNT_BASE, HUNT_STEP } from '../../src/config/tuning.js';
import { Audio_ } from '../../src/audio/index.js';
import { drawPlumber, drawLifeform, drawDoor, ENT } from '../../src/render/entities.js';
import { drawPlumber as drawPlumberSprite } from '../../src/cast/plumber.js';
import { drawLifeform as drawLifeformSprite } from '../../src/cast/lifeform.js';
import { cvs, ctx, SCALE, viewScale } from '../../src/render/canvas.js';
import { G } from '../../src/sim/state.js';
import { keys } from '../../src/sim/keys.js';
import { createCollision } from '../../src/sim/collision.js';
import { hearRadius, alertLifeforms, emitNoise, sustainedNoise, tickNoiseDecay, brush, alert, wallSteps, MAX_WALL_STEPS } from '../../src/sim/noise.js';
import { distanceField } from '../../src/sim/path.js';
import { initFlood, seedSplash, wetAt, tickFlood } from '../../src/sim/flood.js';
import { tickBattery, tickMovement } from '../../src/sim/plumber.js';
import { tickLeakNoise, tickRepair, sealLeak, leakAt, leakReach } from '../../src/sim/leaks.js';
import { tickClock } from '../../src/sim/clock.js';
import { tickDoor } from '../../src/sim/door.js';
import { tickRadarReveal } from '../../src/sim/radar.js';
import { tickLifeforms, updateLifeform, randomFloorNear } from '../../src/sim/lifeforms.js';
import {
  castFan, traceViewCone, combineMask, scopeRoomLight,
  fadeRoomLight, smoothMask, snapMask, fixtureVis,
} from '../../src/sim/vision.js';
import { genLevel } from '../../src/sim/level.js';
import { update } from '../../src/sim/update.js';
import { buildFloor } from '../../src/game/floor.js';
import {
  STATE, lives, floorIdx, runLives, runStat, runTime, RUN_SEED,
  clearCard, resetArmed, clockText, nextFloor, dismissClear, rollRunSeed, startRun, retryFloor,
  resetRun, caught, outOfTime, revealDeath,
  setState, setLives, setFloorIdx, setRunTime, addRunTime, setRunSeed,
} from '../../src/game/run.js';
import { frame } from '../../src/game/loop.js';
import { hideScreens, SCREENS, showScreen } from '../../src/ui/dom.js';
import { HUD, updateHUD } from '../../src/ui/hud.js';
import { activateMenu, beginShift, backSplash, moveMenu, selectMenu, TITLE_MENU } from '../../src/ui/splash.js';
import {
  BINDER_MODES, SHIFT_TABS, PAUSE_TABS,
  binderMode, binderTab, openBinder, setBinderTab, stepBinderTab,
} from '../../src/ui/binder.js';
import { togglePause } from '../../src/ui/pause.js';
import { applySettings } from '../../src/ui/bind.js';
import { setPixels, surfaces, syncSurfaces } from '../../src/render/floor-surfaces.js';
import { markWetAll, repaintDirty } from '../../src/util/repaint.js';
import { paintSplashPlan } from '../../src/render/splash-plan.js';
import { render } from '../../src/render/render.js';
import { MAX_PARTICLES, getParticleCount } from '../../src/render/passes/particles.js';
import { SETTINGS, loadSettings, saveSettings, resetSettings, setOption } from '../../src/settings/store.js';
import { MAP, TILE_TYPES, WALL, DOOR, MOVEMENT, STICK, PLUMBER, LIFEFORM, RADAR, BATTERY, LEAK, WATER, ROOM_LIGHT, VISION, RENDER, NOISE } from '../../src/config/constants.js';

/* The packers are internal to the surfaces. A test marks a layer dirty and runs the one sync. */
/* Packs one layer and leaves the other layer's pending flag as it was. */
function packOnly(layer, mark){
  const others = Object.keys(repaintDirty).filter(k => k !== layer);
  const saved = Object.fromEntries(others.map(k => [k, repaintDirty[k]]));
  for (const k of others) repaintDirty[k] = false;
  mark();
  syncSurfaces(G);
  Object.assign(repaintDirty, saved);
}
function packWet(){ packOnly('water', markWetAll); }
function packMask(){ packOnly('mask', () => { repaintDirty.mask = true; }); }

function setHeadless(px, vis){ setPixels(px); if (G) G.wantVision = vis; }

export const __api = {
get MAP(){ return MAP; },
get TILE_TYPES(){ return TILE_TYPES; },
get WALL(){ return WALL; },
get DOOR(){ return DOOR; },
get MOVEMENT(){ return MOVEMENT; },
get STICK(){ return STICK; },
get PLUMBER(){ return PLUMBER; },
get LIFEFORM(){ return LIFEFORM; },
get RADAR(){ return RADAR; },
get BATTERY(){ return BATTERY; },
get LEAK(){ return LEAK; },
get WATER(){ return WATER; },
get ROOM_LIGHT(){ return ROOM_LIGHT; },
get VISION(){ return VISION; },
get RENDER(){ return RENDER; },
get NOISE(){ return NOISE; },

get G(){ return G; },
/* A floor's scratch state, gathered in one object so tests read each buffer
   through the floor it belongs to instead of through a getter per array. */
get internals(){ return {
  lightArr: G.lightArr, lightCv: surfaces.light,
  visArr: G.visArr, visTgt: G.visTgt, visFrom: G.visFrom, visScratch: G.visScratch,
  maskArr: G.maskArr, maskTgt: G.maskTgt, coneArr: G.coneArr, maskCv: surfaces.mask,
  regionOf: G.regionOf, regionAdj: G.regionAdj, visRegion: G.visRegion,
  wetArr: G.wetArr, waterDist: G.waterDist, wetFront: G.wetFront,
  wetByDist: G.wetByDist, wetMaxDist: G.wetMaxDist, wetEdgeD: G.wetEdgeD,
  wetIndexAtDist: G.wetIndexAtDist, wetCv: surfaces.wet,
  cvs, ctxRef: ctx, SCALE
}; },
buildFloor, genLevel, render, emitNoise, drawPlumber,
frame,
updateReal: (dt) => { return update(G, dt); },
/* Every test that is not about the clock holds it open.
   update() returns immediately once the clock has run out, so a test that
   drives twenty thousand frames would spend its whole run dead on arrival and
   report it as "the AI stopped working". The two tests that do care about the
   clock (the playthrough's headroom check, and run-rules) call updateReal. */
update(dt){ if (G) G.clock = 1e6; return update(G, dt); },
scopeRoomLight, traceViewCone, packMask, snapMask, combineMask,
smoothMask, setHeadless,
tickBattery, tickMovement,
tickLifeforms, updateLifeform, randomFloorNear,
tickClock,
tickDoor,
tickRadarReveal,
tickFlood, wetAt, sealLeak, leakReach, leakAt, initFlood, packWet,
hearRadius, sustainedNoise,
Audio_,
get SETTINGS(){ return SETTINGS; },
get SETTINGS_DEFAULTS(){ return SETTINGS_DEFAULTS; },
get SETTINGS_SCHEMA(){ return SETTINGS_SCHEMA; },
get DIFFICULTIES(){ return DIFFICULTIES; },
get WATER_TINTS(){ return WATER_TINTS; },
loadSettings, saveSettings, resetSettings, applySettings, setOption,
settingsValid, get SETTINGS_KEY(){ return SETTINGS_KEY; },
activateMenu, beginShift, backSplash, moveMenu, selectMenu, TITLE_MENU, showScreen, hideScreens, get SCREENS(){ return SCREENS; },
nextFloor, dismissClear, startRun, retryFloor, addRunTime, caught, outOfTime, revealDeath, get clearCard(){ return clearCard; },
get STATE(){ return STATE; },
set STATE(v){ setState(v); },
get floorIdx(){ return floorIdx; }, set floorIdx(v){ setFloorIdx(v); },
get keys(){ return keys; },
 drawLifeform,
get cvs(){ return cvs; }, get ctxRef(){ return ctx; }, get SCALE(){ return SCALE; }, viewScale,
get MAX_PARTICLES(){ return MAX_PARTICLES; }, getParticleCount,
  /* The whole noise table, so a test can assert on the contract as a whole
     instead of naming four constants and hoping the rest are covered. */
  NOISE,
updateHUD, HUD,
LEVELS, LEVELS_N, get FLOOR_CLOCK(){ return FLOOR_CLOCK; },
get REPAIR_TIME(){ return REPAIR_TIME; },
paintSplashPlan, rollRunSeed, get RUN_SEED(){ return RUN_SEED; },
set RUN_SEED(v){ setRunSeed(v); },
mulberry32, seedSplash,
togglePause, clockText,
get binderMode(){ return binderMode; },
get binderTab(){ return binderTab; },
openBinder, setBinderTab, stepBinderTab,
get BINDER_MODES(){ return BINDER_MODES; },
get SHIFT_TABS(){ return SHIFT_TABS; },
get PAUSE_TABS(){ return PAUSE_TABS; },
resetRun,
get resetArmed(){ return resetArmed; },
get FLOORS(){ return FLOORS; },
get HUNT_BASE(){ return HUNT_BASE; }, get HUNT_STEP(){ return HUNT_STEP; },
get lives(){ return lives; }, set lives(v){ setLives(v); },
get runTime(){ return runTime; }, set runTime(v){ setRunTime(v); },
get runLives(){ return runLives; },
get runStat(){ return runStat; },
/* the cast: the avatar's rig and the thing hunting it */
drawLifeform, drawDoor, ENT,
drawPlumberSprite, drawLifeformSprite,
/* Collision helpers for tests - create from current G.grid */
blocked(x, y, r){ return createCollision(G.grid).blocked(x, y, r); },
moveEnt(e, dx, dy, r){ return createCollision(G.grid).moveEnt(e, dx, dy, r); },
regionAt(x, y){ const tx=Math.floor(x), ty=Math.floor(y); if (tx<0||ty<0||tx>=76||ty>=76) return -1; return G.regionOf[ty*76+tx]; },

/* Flood wrappers - G serves as FloodState */
initFlood: () => initFlood(G),
seedSplash: (wx, wy, amount) => seedSplash(G, wx, wy, amount),
wetAt: (wx, wy) => wetAt(G, wx, wy),
tickFlood: (dt) => tickFlood(G, dt),

/* Vision wrappers - G serves as VisionState */
traceViewCone: (force) => traceViewCone(G, G.plumber, G.radar, force),
combineMask: () => combineMask(G, G.plumber, G.radar),
scopeRoomLight: (instant) => scopeRoomLight(G, G.plumber, G.radar, instant),
fadeRoomLight: (dt) => fadeRoomLight(G, dt),
smoothMask: (dt) => smoothMask(G, dt),
snapMask: () => snapMask(G, G.plumber, G.radar),
fixtureVis: (f) => fixtureVis(f, G),
onScreen: (wx, wy) => onScreen(wx, wy, G.plumber),
castFan: (out, ox, oy, facing, halfAngle, range, rays, gain, fall) => castFan(out, ox, oy, facing, halfAngle, range, rays, gain, fall, G.grid),

/* Plumber wrappers - G serves as PlumberMetaState, G.plumber as PlumberState */
tickBattery: (dt) => tickBattery(G, G.plumber, G.batteries, dt),
tickMovement: (dt) => tickMovement(G.plumber, G.grid, G, dt),

/* Lifeform wrappers - G serves as LifeformState */
tickLifeforms: (dt) => tickLifeforms(G, dt),
updateLifeform: (lf, dt, p) => updateLifeform(G, lf, dt, p),
randomFloorNear: (x, y, rad, blocked) => randomFloorNear(G, x, y, rad, blocked),

/* Clock wrappers - G serves as ClockState */
tickClock: (dt) => tickClock(G, dt),

/* Door wrappers - G serves as DoorState */
tickDoor: (dt) => tickDoor(G, dt),

/* Radar wrappers - G serves as RadarState */
tickRadarReveal: () => tickRadarReveal(G),

/* Noise wrappers - G serves as NoiseState */
emitNoise: (power, x, y, mine) => emitNoise(G, power, x, y, mine),
sustainedNoise: (power, x, y, mine) => sustainedNoise(G, power, x, y, mine),
alertLifeforms: (baseR, power, x, y, mine) => alertLifeforms(G, baseR, power, x, y, mine),
tickNoiseDecay: (dt) => tickNoiseDecay(G, dt),
brush: (lf, p) => brush(lf, p, G),
alert: (lf, src, ctx) => alert(lf, src, ctx),
wallSteps: (ax, ay, x, y) => wallSteps(G.grid, ax, ay, x, y),
MAX_WALL_STEPS,
distanceField: (tx, ty) => distanceField(G.grid, tx, ty),

/* Leak wrappers - G serves as LeakState */
leakAt: (x, y) => leakAt(G.leaks, x, y),
leakReach: (x, y) => leakReach(G.leaks, x, y),
sealLeak: (L) => sealLeak(L, G),
tickLeakNoise: (dt) => tickLeakNoise(G, dt),
tickRepair: (dt, moving, bumped) => tickRepair(G, dt, moving, bumped),
};
