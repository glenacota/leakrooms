import { mulberry32 } from '../../src/util/rng.js';
import { hash2 } from '../../src/util/hash.js';
import { LEVELS, LEVELS_N } from '../../src/config/levels.js';
import { PAL } from '../../src/config/palette.js';
import { DIFFICULTIES, WATER_TINTS } from '../../src/config/presets.js';
import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA, SETTINGS_KEY, settingsValid } from '../../src/settings/schema.js';
import { FLOORS, FLOOR_CLOCK, REPAIR_TIME, HUNT_BASE, HUNT_STEP, applyDifficulty } from '../../src/config/tuning.js';
import { Audio_ } from '../../src/audio/index.js';
import { drawRigger } from '../../src/cast/rigger.js';
import { drawStalker } from '../../src/cast/stalker.js';
import { TAU } from '../../src/cast/primitives.js';
import { cvs, ctx, VW, VH, DPR, SCALE, resize, renderScaleIdx, setRenderScaleIdx } from '../../src/render/canvas.js';
import { carpetPat, wallPat, ceilPat, scanPat, grainFull, buildPatterns, buildGrainFull } from '../../src/render/textures.js';
import { G, installFloorState } from '../../src/sim/state.js';
import { keys } from '../../src/sim/keys.js';
import { view } from '../../src/util/view.js';
import { makeLos } from '../../src/util/grid.js';
import { createCollision } from '../../src/sim/collision.js';
import { hearRadius, alertAgents, emitNoise, sustainedNoise, brush, alert, wallSteps, MAX_WALL_STEPS } from '../../src/sim/noise.js';
import { initFlood, seedSplash, wetAt, tickFlood, floodCover } from '../../src/sim/flood.js';
import { tickBattery, tickMovement } from '../../src/sim/player.js';
import { takeWetBox } from '../../src/render/repaint.js';
import { tickLeakNoise, tickRepair, sealLeak, leakAt, leakReach } from '../../src/sim/leaks.js';
import { tickClock } from '../../src/sim/clock.js';
import { tickDoor } from '../../src/sim/door.js';
import { tickRadarReveal } from '../../src/sim/radar.js';
import { tickAgents, updateAgent, randomFloorNear } from '../../src/sim/agents.js';
import { computeLightArr } from '../../src/sim/lightmap.js';
import {
  wantVision, setVision, castFan, traceViewCone, combineMask, scopeRoomLight,
  fadeRoomLight, smoothMask, snapMask, fixtureVis, onScreen,
} from '../../src/sim/vision.js';
import { genLevel } from '../../src/sim/level.js';
import { spawnAgents } from '../../src/sim/spawn.js';
import { update, tickAudio } from '../../src/sim/update.js';
import { buildFloor } from '../../src/game/floor.js';
import {
  STATE, lives, floorIdx, runTime, runLives, runStat, RUN_SEED,
  clearCard, resetArmed, clockText, nextFloor, dismissClear, rollRunSeed,
  resetRun, disarmReset, armReset,
  startRun, retryFloor, runAgain, bindRun,
  setState, setLives, setFloorIdx, setRunTime, setRunStat, setRunSeed,
} from '../../src/game/run.js';
import { frame, setFrameHooks } from '../../src/game/loop.js';
import { hideAll, SCREENS, show } from '../../src/ui/dom.js';
import { flash, HUD, livesHTML, renderLives, updateHUD, setPrompt } from '../../src/ui/hud.js';
import { advanceSplash, backSplash, syncAmbience } from '../../src/ui/splash.js';
import { setTermsOpen, termsOpen } from '../../src/ui/terms.js';
import { pausePage, setPausePage, togglePause } from '../../src/ui/pause.js';
import { buildSettingsUI, SEGMENTS, syncSettingsUI } from '../../src/ui/settings-panel.js';
import { bindInput, MODAL_ACTION, toggleMute } from '../../src/ui/input.js';
import { bindButtons } from '../../src/ui/buttons.js';
import { applySettings, bindDom } from '../../src/ui/bind.js';
import { attachFloorImages } from '../../src/render/bake.js';
import { packMask, packWet, setPixels } from '../../src/render/pack.js';
import { paintSplashPlan } from '../../src/render/splash-plan.js';
import { buildGlowSprite, render, setSimAlpha } from '../../src/render/render.js';
import { ENT, drawAgent, drawDoor, drawPlayer } from '../../src/render/entities.js';
import { SETTINGS, loadSettings, saveSettings, resetSettings, setOption } from '../../src/settings/store.js';
import { on, emit } from '../../src/util/events.js';
import * as _C from '../../src/config/constants.js';
const { AGENT, BAKE_FLOOR, BATT_MAX, BRUSH_NOISE, CATCH_R, DARK_ROOM, DOOR_AJAR, DOOR_EASE, DOOR_HOLD, DOOR_NOISE, FLICKER_DEPTH, HAND_OFF, HOP_FALL, LEAK_HEADSTART, LEAK_LURE, LEAK_NOISE_BASE, LEAK_NOISE_GAIN, LEAK_RETREAT, LEAK_SPREAD, LIGHT_FADE, LIGHT_FADE_STEPS, LOUD, LS, MAP_H, MAP_W, MASK_TAU, NOISE, NOISE_FS, PIPE_FAR, PIPE_GAP, R, RA, RADAR_DRAIN, RENDER_SCALES, REPAIR_DECAY, REPAIR_NOISE, REPAIR_REACH, SCALE_BAD_FRAMES, SCALE_DROP_MS, SCALE_GOOD_FRAMES, SCALE_RECOVER_MS, SHEEN_STEPS, SPRINT, SPRINT_NOISE, TILE, VHS_PASS, VIEW_DEG, VIEW_FADE_FAR, VIEW_FADE_NEAR, VIEW_HALF, VIEW_MID, VIEW_RANGE, VIEW_RAYS, VIEW_T, WALK, WALL, WALL_FACE, WET_DRAW, WET_EDGE, WET_FALL, WET_RISE, FLOOR } = _C;

function setHeadless(px, vis){ setPixels(px); setVision(vis); }

export const __api = {

get G(){ return G; },
/* A floor's scratch state, gathered in one object so tests read each buffer
   through the floor it belongs to instead of through a getter per array. */
get internals(){ return {
  lightArr: G.lightArr, lightCv: G.gfx.lightCv, lightImg: G.gfx.lightImg, lightCtx: G.gfx.lightCtx,
  visArr: G.visArr, visTgt: G.visTgt, visFrom: G.visFrom, visScratch: G.visScratch,
  maskArr: G.maskArr, maskTgt: G.maskTgt, coneArr: G.coneArr, maskCv: G.gfx.maskCv,
  regionOf: G.regionOf, regionAdj: G.regionAdj, visRegion: G.visRegion,
  wetArr: G.wetArr, waterDist: G.waterDist, wetFront: G.wetFront,
  wetByDist: G.wetByDist, wetMaxDist: G.wetMaxDist, wetEdgeD: G.wetEdgeD,
  wetIndexAtDist: G.wetIndexAtDist, wetCv: G.gfx.wetCv,
  cvs, ctxRef: ctx, SCALE
}; },
get DARK_ROOM(){ return DARK_ROOM; },
get HOP_FALL(){ return HOP_FALL; },
get VIEW_FADE_NEAR(){ return VIEW_FADE_NEAR; },
get VIEW_FADE_FAR(){ return VIEW_FADE_FAR; },
get VIEW_HALF(){ return VIEW_HALF; },
get VIEW_RANGE(){ return VIEW_RANGE; },
get RADAR_DRAIN(){ return RADAR_DRAIN; },
buildFloor, genLevel, render, emitNoise, setPrompt, drawPlayer,
frame,
updateReal: (dt) => { return update(G, dt); },
/* Every test that is not about the clock holds it open.
   update() returns immediately once the clock has run out, so a test that
   drives twenty thousand frames would spend its whole run dead on arrival and
   report it as "the AI stopped working". The two tests that do care about the
   clock (the playthrough's headroom check, and run-rules) call updateReal. */
update(dt){ if (G) G.clock = 1e6; return update(G, dt); },
scopeRoomLight, traceViewCone, packMask, snapMask, combineMask,
smoothMask, onScreen, setHeadless,
tickBattery, tickMovement,
tickAgents, updateAgent, randomFloorNear,
tickClock,
tickDoor,
tickRadarReveal,
emitNoise, sustainedNoise, alertAgents, brush, alert,
get STATE(){ return STATE; },
set STATE(v){ setState(v); },
get floorIdx(){ return floorIdx; }, set floorIdx(v){ setFloorIdx(v); },
get keys(){ return keys; },
get HAND_OFF(){ return HAND_OFF; }, get R(){ return R; }, drawAgent,
get cvs(){ return cvs; }, get ctxRef(){ return ctx; }, get SCALE(){ return SCALE; },
get TILE(){ return TILE; },
get WET_DRAW(){ return WET_DRAW; },
get LOUD(){ return LOUD; },
  /* The whole noise table, so a test can assert on the contract as a whole
     instead of naming four constants and hoping the rest are covered. */
  NOISE, AGENT,
get NOISE_FS(){ return NOISE_FS; },
get DOOR_NOISE(){ return DOOR_NOISE; },
get BRUSH_NOISE(){ return BRUSH_NOISE; },
updateHUD, HUD,
LEVELS, LEVELS_N, get FLOOR_CLOCK(){ return FLOOR_CLOCK; },
get WET_FALL(){ return WET_FALL; },
get LEAK_HEADSTART(){ return LEAK_HEADSTART; },
get PIPE_GAP(){ return PIPE_GAP; },
get FLOOR(){ return FLOOR; },
get REPAIR_TIME(){ return REPAIR_TIME; },
get REPAIR_REACH(){ return REPAIR_REACH; },
get REPAIR_NOISE(){ return REPAIR_NOISE; },
get SPRINT_NOISE(){ return SPRINT_NOISE; },
get LEAK_NOISE_BASE(){ return LEAK_NOISE_BASE; },
get LEAK_NOISE_GAIN(){ return LEAK_NOISE_GAIN; },
get LEAK_SPREAD(){ return LEAK_SPREAD; },
get LEAK_RETREAT(){ return LEAK_RETREAT; },
get WET_RISE(){ return WET_RISE; },
get LEAK_LURE(){ return LEAK_LURE; },
get WALK(){ return WALK; }, get SPRINT(){ return SPRINT; },
tickFlood, wetAt, floodCover, sealLeak, leakReach, leakAt, initFlood, packWet,
hearRadius, sustainedNoise,
Audio_,
get SETTINGS(){ return SETTINGS; },
get SETTINGS_DEFAULTS(){ return SETTINGS_DEFAULTS; },
get SETTINGS_SCHEMA(){ return SETTINGS_SCHEMA; },
get DIFFICULTIES(){ return DIFFICULTIES; },
get WATER_TINTS(){ return WATER_TINTS; },
loadSettings, saveSettings, resetSettings, applySettings, setOption,
settingsValid, get SETTINGS_KEY(){ return SETTINGS_KEY; },
advanceSplash, backSplash, show, hideAll, get SCREENS(){ return SCREENS; },
nextFloor, dismissClear, get clearCard(){ return clearCard; },
/* the real frame loop, not update(): the floor clock is frozen by the gate in
   frame() rather than by update() refusing to run, so a test that drives
   update() directly is measuring the wrong thing. requestAnimationFrame is
   stubbed to a no-op, so calling frame() runs one frame, not a loop. */
frame,
paintSplashPlan, rollRunSeed, get RUN_SEED(){ return RUN_SEED; },
set RUN_SEED(v){ setRunSeed(v); },
mulberry32, seedSplash,
togglePause, clockText,
get pausePage(){ return pausePage; },
setPausePage,
get termsOpen(){ return termsOpen; },
setTermsOpen,
resetRun,
get resetArmed(){ return resetArmed; },
set resetArmed(v){ resetArmed = v; },
get FLOORS(){ return FLOORS; },
get HUNT_BASE(){ return HUNT_BASE; }, get HUNT_STEP(){ return HUNT_STEP; },
get lives(){ return lives; }, set lives(v){ setLives(v); },
set runTime(v){ setRunTime(v); },
get runLives(){ return runLives; },
get runStat(){ return runStat; },
/* the cast: the avatar's rig and the thing hunting it */
drawRigger, drawStalker, drawDoor, ENT,
/* Collision helpers for tests - create from current G.grid */
blocked(x, y, r){ return createCollision(G.grid).blocked(x, y, r); },
moveEnt(e, dx, dy, r){ return createCollision(G.grid).moveEnt(e, dx, dy, r); },
regionAt(x, y){ const tx=Math.floor(x), ty=Math.floor(y); if (tx<0||ty<0||tx>=76||ty>=76) return -1; return G.regionOf[ty*76+tx]; },

/* Flood wrappers - G serves as FloodState */
initFlood: () => initFlood(G, G.player),
seedSplash: (wx, wy, amount) => seedSplash(G, wx, wy, amount),
wetAt: (wx, wy) => wetAt(G, wx, wy),
tickFlood: (dt) => tickFlood(G, dt),
floodCover: () => floodCover(G),

/* Vision wrappers - G serves as VisionState */
traceViewCone: (force) => { /* HAND_OFF */ return traceViewCone(G, G.player, G.radar, force); },
combineMask: () => combineMask(G, G.player, G.radar),
scopeRoomLight: (dt, instant) => scopeRoomLight(G, G.player, G.radar, dt, instant),
fadeRoomLight: (dt) => fadeRoomLight(G, dt),
smoothMask: (dt) => smoothMask(G, dt),
snapMask: () => snapMask(G, G.player, G.radar),
fixtureVis: (f) => fixtureVis(f, G),
onScreen: (wx, wy) => onScreen(wx, wy, G.player),
castFan: (out, ox, oy, facing, halfAngle, range, rays, gain, fall) => castFan(out, ox, oy, facing, halfAngle, range, rays, gain, fall, G.grid),

/* Player wrappers - G serves as PlayerMetaState, G.player as PlayerState */
tickBattery: (dt) => tickBattery(G, G.player, G.batteries, dt),
tickMovement: (dt) => tickMovement(G.player, G, G.grid, G.batteries, G, dt),

/* Agent wrappers - G serves as AgentState */
tickAgents: (dt) => tickAgents(G, dt),
updateAgent: (a, dt, p) => updateAgent(G, a, dt, p),
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
alertAgents: (baseR, power, x, y, mine) => alertAgents(G, baseR, power, x, y, mine),
brush: (a, p) => brush(a, p, G),
alert: (a, x, y, power, mine) => alert(a, x, y, power, mine),
wallSteps: (ax, ay, x, y) => wallSteps(G.grid, ax, ay, x, y),
MAX_WALL_STEPS,

/* Leak wrappers - G serves as LeakState */
leakAt: (x, y) => leakAt(G.leaks, x, y),
leakReach: (x, y) => leakReach(G.leaks, x, y),
sealLeak: (L) => sealLeak(L, G),
tickLeakNoise: (dt) => tickLeakNoise(G, dt),
tickRepair: (dt, moving, bumped) => tickRepair(G, dt, moving, bumped),
};
