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
  resetRun, 
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
import { SETTINGS, loadSettings, saveSettings, resetSettings, setOption } from '../../src/settings/store.js';
import * as _C from '../../src/config/constants.js';
const { BRUSH_NOISE, DARK_ROOM, DOOR_NOISE, RADAR_HAND_OFF_TILES, ROOM_SCOPE_FALLOFF, LEAK_HEADSTART, LEAK_LURE, LEAK_NOISE_BASE, LEAK_NOISE_GAIN, LEAK_RETREAT_SECONDS_PER_TILE, LEAK_SPREAD_SECONDS_PER_TILE, LOUD, NOISE, NOISE_FULL_SCALE, SOUND_POWERS, LEAK_GAP, RADAR_DRAIN_CHARGE_PER_SECOND, REPAIR_NOISE, REPAIR_REACH, SPRINT_SPEED_TILES_PER_SECOND, SPRINT_NOISE, TILE_SIZE_PX, VIEW_FADE_FAR, VIEW_FADE_NEAR, VIEW_HALF, VIEW_RANGE, WALK_SPEED_TILES_PER_SECOND, WET_DRAW, WET_TILE_FALL_SECONDS, WET_TILE_RISE_SECONDS, FLOOR } = _C;

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
get DARK_ROOM(){ return DARK_ROOM; },
get ROOM_SCOPE_FALLOFF(){ return ROOM_SCOPE_FALLOFF; },
get VIEW_FADE_NEAR(){ return VIEW_FADE_NEAR; },
get VIEW_FADE_FAR(){ return VIEW_FADE_FAR; },
get VIEW_HALF(){ return VIEW_HALF; },
get VIEW_RANGE(){ return VIEW_RANGE; },
get RADAR_DRAIN_CHARGE_PER_SECOND(){ return RADAR_DRAIN_CHARGE_PER_SECOND; },
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
nextFloor, dismissClear, startRun, retryFloor, addRunTime, get clearCard(){ return clearCard; },
get STATE(){ return STATE; },
set STATE(v){ setState(v); },
get floorIdx(){ return floorIdx; }, set floorIdx(v){ setFloorIdx(v); },
get keys(){ return keys; },
get RADAR_HAND_OFF_TILES(){ return RADAR_HAND_OFF_TILES; }, drawLifeform,
get cvs(){ return cvs; }, get ctxRef(){ return ctx; }, get SCALE(){ return SCALE; }, viewScale,
get TILE_SIZE_PX(){ return TILE_SIZE_PX; },
get WET_DRAW(){ return WET_DRAW; },
get LOUD(){ return LOUD; },
  /* The whole noise table, so a test can assert on the contract as a whole
     instead of naming four constants and hoping the rest are covered. */
  NOISE,
  SOUND_POWERS,
get NOISE_FULL_SCALE(){ return NOISE_FULL_SCALE; },
get DOOR_NOISE(){ return DOOR_NOISE; },
get BRUSH_NOISE(){ return BRUSH_NOISE; },
updateHUD, HUD,
LEVELS, LEVELS_N, get FLOOR_CLOCK(){ return FLOOR_CLOCK; },
get WET_TILE_FALL_SECONDS(){ return WET_TILE_FALL_SECONDS; },
get LEAK_HEADSTART(){ return LEAK_HEADSTART; },
get LEAK_GAP(){ return LEAK_GAP; },
get FLOOR(){ return FLOOR; },
get REPAIR_TIME(){ return REPAIR_TIME; },
get REPAIR_REACH(){ return REPAIR_REACH; },
get REPAIR_NOISE(){ return REPAIR_NOISE; },
get SPRINT_NOISE(){ return SPRINT_NOISE; },
get LEAK_NOISE_BASE(){ return LEAK_NOISE_BASE; },
get LEAK_NOISE_GAIN(){ return LEAK_NOISE_GAIN; },
get LEAK_SPREAD_SECONDS_PER_TILE(){ return LEAK_SPREAD_SECONDS_PER_TILE; },
get LEAK_RETREAT_SECONDS_PER_TILE(){ return LEAK_RETREAT_SECONDS_PER_TILE; },
get WET_TILE_RISE_SECONDS(){ return WET_TILE_RISE_SECONDS; },
get LEAK_LURE(){ return LEAK_LURE; },
get WALK_SPEED_TILES_PER_SECOND(){ return WALK_SPEED_TILES_PER_SECOND; }, get SPRINT_SPEED_TILES_PER_SECOND(){ return SPRINT_SPEED_TILES_PER_SECOND; },
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
