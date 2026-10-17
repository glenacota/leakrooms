import { mulberry32 } from '../../util/rng.js';
import { hash2 } from '../../util/hash.js';
import { LEVELS, LEVELS_N } from '../../config/levels.js';
import { PAL } from '../../config/palette.js';
import { DIFFICULTIES, WATER_TINTS } from '../../config/presets.js';
import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA, SETTINGS_KEY, settingsValid } from '../../settings/schema.js';
import { FLOORS, FLOOR_CLOCK, REPAIR_TIME, HUNT_BASE, HUNT_STEP, applyDifficulty } from '../../config/tuning.js';
import { Audio_ } from '../../src/audio/index.js';
import { drawRigger } from '../../cast/rigger.js';
import { drawStalker } from '../../cast/stalker.js';
import { TAU } from '../../cast/primitives.js';
import { cvs, ctx, VW, VH, DPR, SCALE, resize, renderScaleIdx, setRenderScaleIdx } from '../../render/canvas.js';
import { carpetPat, wallPat, ceilPat, scanPat, grainFull, buildPatterns, buildGrainFull } from '../../render/textures.js';
import { G, setG } from '../../sim/state.js';
import { keys } from '../../sim/keys.js';
import { view } from '../../util/view.js';
import { makeLos } from '../../util/grid.js';
import { solid, blocked, unstick, depenetrate, moveEnt } from '../../sim/collision.js';
import { hearRadius, alertAgents, emitNoise, sustainedNoise, brush, alert } from '../../sim/noise.js';
import { initFlood, seedSplash, wetAt, tickFlood, floodCover, takeWetBox } from '../../sim/flood.js';
import { leakAt, leakReach, sealLeak, tickLeakNoise, tickRepair } from '../../sim/leaks.js';
import { labelRegions, regionAt } from '../../sim/regions.js';
import { computeLightArr } from '../../sim/lightmap.js';
import {
  wantVision, setVision, castFan, traceViewCone, combineMask, scopeRoomLight,
  fadeRoomLight, smoothMask, snapMask, fixtureVis, onScreen,
} from '../../sim/vision.js';
import { genLevel } from '../../sim/level.js';
import { spawnAgents } from '../../sim/spawn.js';
import { updateAgent, randomFloorNear, tickAgents } from '../../sim/agents.js';
import { update, tickAudio } from '../../sim/update.js';
import { buildFloor } from '../../game/floor.js';
import {
  STATE, lives, floorIdx, runTime, runLives, runStat, RUN_SEED,
  clearCard, resetArmed, clockText, nextFloor, dismissClear, rollRunSeed,
  resetRun, disarmReset, armReset,
  startRun, retryFloor, runAgain, bindRun,
  setState, setLives, setFloorIdx, setRunTime, setRunStat, setRunSeed,
} from '../../game/run.js';
import { frame, setFrameHooks } from '../../game/loop.js';
import { hideAll, SCREENS, show } from '../../ui/dom.js';
import { flash, HUD, livesHTML, renderLives, updateHUD, setPrompt } from '../../ui/hud.js';
import { advanceSplash, backSplash, syncAmbience } from '../../ui/splash.js';
import { setTermsOpen, termsOpen } from '../../ui/terms.js';
import { pausePage, setPausePage, togglePause } from '../../ui/pause.js';
import { buildSettingsUI, SEGMENTS, syncSettingsUI } from '../../ui/settings-panel.js';
import { bindInput, MODAL_ACTION, toggleMute } from '../../ui/input.js';
import { bindButtons } from '../../ui/buttons.js';
import { applySettings, bindDom } from '../../ui/bind.js';
import { attachFloorImages } from '../../render/bake.js';
import { packMask, packWet, setPixels } from '../../render/pack.js';
import { paintSplashPlan } from '../../render/splash-plan.js';
import { buildGlowSprite, render, setSimAlpha } from '../../render/render.js';
import { ENT, drawAgent, drawPlayer } from '../../render/entities.js';
import { SETTINGS, loadSettings, saveSettings, resetSettings, setOption } from '../../settings/store.js';
import { on, emit } from '../../util/events.js';
import * as _C from '../../config/constants.js';
const { BAKE_FLOOR, BATT_MAX, BRUSH_NOISE, CATCH_R, DARK_ROOM, DOOR_AJAR, DOOR_EASE, DOOR_HOLD, DOOR_NOISE, FLICKER_DEPTH, HAND_OFF, HOP_FALL, LEAK_HEADSTART, LEAK_LURE, LEAK_NOISE_BASE, LEAK_NOISE_GAIN, LEAK_RETREAT, LEAK_SPREAD, LIGHT_FADE, LIGHT_FADE_STEPS, LOUD, LS, MAP_H, MAP_W, MASK_TAU, NOISE_FS, PIPE_FAR, PIPE_GAP, R, RA, RADAR_DRAIN, RENDER_SCALES, REPAIR_DECAY, REPAIR_NOISE, REPAIR_REACH, SCALE_BAD_FRAMES, SCALE_DROP_MS, SCALE_GOOD_FRAMES, SCALE_RECOVER_MS, SHEEN_STEPS, SPRINT, SPRINT_NOISE, TILE, VHS_PASS, VIEW_DEG, VIEW_FADE_FAR, VIEW_FADE_NEAR, VIEW_HALF, VIEW_MID, VIEW_RANGE, VIEW_RAYS, VIEW_T, WALK, WALL, WALL_FACE, WET_DRAW, WET_EDGE, WET_FALL, WET_RISE, FLOOR } = _C;

function setHeadless(px, vis){ setPixels(px); setVision(vis); }

export const __api = {

get G(){ return G; },
/* The floor's scratch state moved onto G wholesale — one internals object
   instead of a getter per array, so the suite reads each buffer through the
   floor it belongs to. */
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
buildFloor, genLevel, blocked, moveEnt, render, emitNoise, setPrompt, drawPlayer,
frame,
updateReal: update,
/* Every test that is not ABOUT the clock holds it open.
   The game now ends a level when the clock runs out, and update() returns
   immediately once it has — so a test that drives twenty thousand frames
   spends its whole run dead on arrival and reports it as "the AI stopped
   working" or "the battery stopped draining". The failure is indistinguishable
   from a real bug unless it is impossible by construction, so it is: the
   default harness entry point pushes the deadline out of the way, and the two
   tests that genuinely care about it (the playthrough's clock headroom, and
   the clock test itself) call updateReal. */
update(dt){ if (G) G.clock = 1e6; return update(dt); },
scopeRoomLight, regionAt, traceViewCone, packMask, snapMask, combineMask,
smoothMask, onScreen, setHeadless,
get STATE(){ return STATE; },
set STATE(v){ setState(v); },
get floorIdx(){ return floorIdx; }, set floorIdx(v){ setFloorIdx(v); },
get keys(){ return keys; },
get HAND_OFF(){ return HAND_OFF; }, get R(){ return R; }, drawAgent,
get cvs(){ return cvs; }, get ctxRef(){ return ctx; }, get SCALE(){ return SCALE; },
get TILE(){ return TILE; },
get WET_DRAW(){ return WET_DRAW; },
get LOUD(){ return LOUD; },
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
/* the real frame loop, not update(): the floor clock is frozen by the GATE in
   frame() and not by update() refusing to run, so a test that drives update()
   directly is measuring the wrong thing and will happily "prove" a clock that
   ticks while the player is reading the clear card. requestAnimationFrame is
   stubbed to a no-op, so calling frame() is one frame, not a loop. */
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
/* the cast, inlined: the avatar's rig and the thing hunting it */
drawRigger, drawStalker, ENT,
};
