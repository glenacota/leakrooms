/* ============================================================
   LEAKROOMS
   2D top-down puzzle / stealth. JS + canvas only, no assets.

   Design contract:
   - There is ONE door: the one you came in through. You seal the pipes,
     then you get back to it before the clock runs out.
   - The radar is INFORMATION ONLY. It reveals the scrawled warnings.
     It never repels, never lies to the monster.
   - You see a 200 degree cone, stopped by walls, and only
     the room you are standing in is lit. The radar overrides
     both — for as long as the battery lasts, which is not long.
   - Noise is the entire stealth layer. Sprinting is fast and fatal.
   - The Lifeform: coiled black wire. Dormant = a pile of loops.
     It RISES when it hears you. That 1.4s animation is your window.
   ============================================================ */ 

import { mulberry32 } from './util/rng.js';
import { LEVELS, LEVELS_N } from './config/levels.js';
import { PAL } from './config/palette.js';
import { DIFFICULTIES, WATER_TINTS } from './config/presets.js';
import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA, SETTINGS_KEY, settingsValid } from './settings/schema.js';
import { FLOORS, FLOOR_CLOCK, REPAIR_TIME, HUNT_BASE, HUNT_STEP, applyDifficulty } from './config/tuning.js';
import { Audio_ } from './src/audio/index.js';
import { drawRigger } from './cast/rigger.js';
import { drawStalker } from './cast/stalker.js';
import { cvs, ctx, VW, VH, DPR, SCALE, resize, renderScaleIdx, setRenderScaleIdx } from './render/canvas.js';
import { buildPatterns } from './render/textures.js';
import { G, setG } from './sim/state.js';
import { keys } from './sim/keys.js';
import { view } from './util/view.js';
import { makeLos } from './util/grid.js';
import { solid, blocked, unstick, depenetrate, moveEnt } from './sim/collision.js';
import { hearRadius, alertAgents, emitNoise, sustainedNoise, brush, alert } from './sim/noise.js';
import { initFlood, seedSplash, wetAt, tickFlood, floodCover, takeWetBox } from './sim/flood.js';
import { leakAt, leakReach, sealLeak, tickLeakNoise, tickRepair } from './sim/leaks.js';
import { labelRegions, regionAt } from './sim/regions.js';
import { computeLightArr } from './sim/lightmap.js';
import {
  wantVision, setVision, castFan, traceViewCone, combineMask, scopeRoomLight,
  fadeRoomLight, smoothMask, snapMask, fixtureVis, onScreen,
} from './sim/vision.js';
import { genLevel } from './sim/level.js';
import { spawnAgents } from './sim/spawn.js';
import { updateAgent, randomFloorNear, tickAgents } from './sim/agents.js';
import { update, tickAudio } from './sim/update.js';
import { buildFloor } from './game/floor.js';
import {
  STATE, lives, floorIdx, runTime, runLives, runStat, RUN_SEED,
  clearCard, resetArmed, clockText, nextFloor, dismissClear, rollRunSeed,
  resetRun, disarmReset, armReset,
  startRun, retryFloor, runAgain, bindRun,
  setState, setLives, setFloorIdx, setRunTime, setRunStat, setRunSeed,
} from './game/run.js';
import { frame, setFrameHooks } from './game/loop.js';
import { hideAll, SCREENS, show } from './ui/dom.js';
import { flash, HUD, livesHTML, renderLives, updateHUD, setPrompt } from './ui/hud.js';
import { advanceSplash, backSplash, syncAmbience } from './ui/splash.js';
import { setTermsOpen, termsOpen } from './ui/terms.js';
import { pausePage, setPausePage, togglePause } from './ui/pause.js';
import { buildSettingsUI, SEGMENTS, syncSettingsUI } from './ui/settings-panel.js';
import { bindInput, MODAL_ACTION, toggleMute } from './ui/input.js';
import { bindButtons } from './ui/buttons.js';
import { applySettings, bindDom } from './ui/bind.js';
import { attachFloorImages } from './render/bake.js';
import { packMask, packWet, setPixels } from './render/pack.js';
import { paintSplashPlan } from './render/splash-plan.js';
import { buildGlowSprite, render, setSimAlpha } from './render/render.js';
import { ENT, drawAgent, drawPlayer } from './render/entities.js';
import { SETTINGS, loadSettings, saveSettings, resetSettings, setOption } from './settings/store.js';
import { on, emit } from './util/events.js';
import * as _C from './config/constants.js';
const { BAKE_FLOOR, BATT_MAX, BRUSH_NOISE, CATCH_R, DARK_ROOM, DOOR_AJAR, DOOR_EASE, DOOR_HOLD, DOOR_NOISE, FLICKER_DEPTH, HAND_OFF, HOP_FALL, LEAK_HEADSTART, LEAK_LURE, LEAK_NOISE_BASE, LEAK_NOISE_GAIN, LEAK_RETREAT, LEAK_SPREAD, LIGHT_FADE, LIGHT_FADE_STEPS, LOUD, LS, MAP_H, MAP_W, MASK_TAU, NOISE_FS, PIPE_FAR, PIPE_GAP, R, RA, RADAR_DRAIN, RENDER_SCALES, REPAIR_DECAY, REPAIR_NOISE, REPAIR_REACH, SCALE_BAD_FRAMES, SCALE_DROP_MS, SCALE_GOOD_FRAMES, SCALE_RECOVER_MS, SHEEN_STEPS, SPRINT, SPRINT_NOISE, TILE, VHS_PASS, VIEW_DEG, VIEW_FADE_FAR, VIEW_FADE_NEAR, VIEW_HALF, VIEW_MID, VIEW_RANGE, VIEW_RAYS, VIEW_T, WALK, WALL, WALL_FACE, WET_DRAW, WET_EDGE, WET_FALL, WET_RISE, FLOOR } = _C;
let frameMsAvg = 16.7;
let badRun = 0, goodRun = 0;
/* ============================================================
   MAZE — BSP room segmentation. "randomly segmented empty rooms"
   ============================================================ */

/* ============================================================
   FLOOR STATE
   ============================================================ */

/* ---- HEADLESS SWITCHES ------------------------------------------------
   Two subsystems exist only to feed pixels to a canvas: packing the mask
   and the flood into images, and retracing the view cone frame by frame.
   Together they were 48% of this suite's CPU, because the headless
   harness drives update() as fast as it can and the tests that never
   look at a picture were paying full price for every frame.

   Both default ON. The game never turns them off; only the test harness
   does, and only for the stretches that assert on neither. A test that
   reads G.maskArr or G.wetCv pixels re-enables them, which is why the flags
   are settable at runtime rather than baked in at load. */
function setHeadless(px, vis){ setPixels(px); setVision(vis); }

/* ============================================================
   LEVEL STAGES
   The floor's pure stages (the maze, the light bake, the region
   labels, the cast) plus the image bake that packs their output
   into canvases. Each pure stage takes the level (or just an rng)
   and either returns data or fills the G fields documented on it.
   None of them reads or writes module-level mutable state, so a
   level can be generated, lit, labelled and cast without a floor
   existing yet — buildFloor is now only the assembly.
   ============================================================ */


/* NOTE: x/y here may be FRACTIONAL world coords (collision), so they MUST be
   floored before indexing the tile array. Without this, G.grid[y*MAP_W+x]
   is a fractional index -> undefined -> undefined===WALL is false -> walls
   become permeable at their edges. */
/* ============================================================
   NOISE — the whole stealth layer.

   Power is a LEVEL, not a per-frame increment:
     walk 0.22 -> ~6.6 tiles   sprint 1.0 -> ~16
     bump 0.55 -> ~10.6       door cycling 1.8 -> ~26
   Previously movement passed power*dt*4, which made every frame's contribution
   ~0.06 and therefore made sprinting only marginally louder than walking —
   the entire risk decision was flattened. Walls muffle by 2.6 tiles each. */



/* ============================================================
   FLOW
   ============================================================ */


/* ============================================================
   HUD + SCREENS
   ============================================================ */



/* ============================================================
   RESET GAME
   The run is the only progress the game keeps — there are no unlocks and no
   meta, the floor dies with the run — so resetting is one honest act: a new
   seed, a fresh floor zero, the attempts restored, and the player back on
   the riser with the same ticket and the same terms they clocked in on. The
   store is NOT wiped: volume, tint and the stamped terms are preferences,
   not progress, and a player who resets to escape a bad floor did not ask
   for the building to forget how they like their water.

   Two-stage, because it is the only control on the ticket that ends a run.
   The first press arms it and says so on the button; the second press fires.
   It disarms itself after five seconds, on a page switch, and on resume — an
   armed reset must never survive the player's attention moving elsewhere,
   or the next pause fires it by accident.
   ============================================================ */





/* ---- the HUD write cache ----
   updateHUD() and setPrompt() run once per frame, and between them they wrote
   fifteen text nodes, five widths and four classes UNCONDITIONALLY — so the
   browser was handed the same string sixty times a second and asked to
   re-parse it, restyle it and lay it out, for a battery gauge that moves at
   5.6/s and a clock that moves once a second. The writes are cheap; the style
   recalc and layout they trigger are not, and they are charged to the frame
   whether or not anything changed. Hiding the HUD outright was worth 2.4ms a
   frame on the reference machine, and stubbing these two functions was worth
   the same 2.4ms — which is the measurement that says it is the DOM and not
   the JavaScript.

   So every write goes through a helper that compares against what was last
   written and returns. No invalidation is needed: the cached value is always
   the value the element is showing, so a floor rebuild that happens to produce
   an identical reading writes nothing, which is correct, and one that does not
   writes immediately. The cache cannot drift from the DOM because nothing else
   writes these nodes. */


/* ---- boot ----
   The store is read BEFORE anything that depends on it, and applySettings
   runs before the first buildFloor so the opening floor is generated with the
   player's depth and repair time already in place. Building the floor first
   and applying after would mean the first floor of a run quietly used NORMAL
   while the menu said HARD. */
resize();
buildPatterns();
buildGlowSprite();
/* WIRING. Nothing above this point has registered a listener or a subscriber, so
   the resize above is the resize there has always been: one with nobody
   listening. After it, in this order — the run answers the simulation's four
   facts, the DOM side of the bus turns facts into pixels, the input and the
   buttons attach to the document — and only then does the store load. */
bindRun();
bindDom();
bindInput();
bindButtons();

applySettings();
/* The loop owns the frame; the shell owns the drawing and the HUD refresh, so
   both are handed in rather than imported. */
setFrameHooks({ render, afterUpdate: ()=>{ updateHUD(); setPrompt(); } });
buildSettingsUI();
syncSettingsUI();
/* The audio graph is built HERE, at boot, and not on the first click of the
   run. Two reasons, and the second is the one that matters: the title screen is
   the only place the splash bed can play at all, and a context created inside
   the CLOCK IN click is already too late to have been the thing that made the
   title sound like a place. The browser will hold it suspended until a gesture
   arrives — Audio_.unlock(), called from the keydown handler and from
   advanceSplash — and everything is built and wired in the meantime. */
Audio_.init();
syncAmbience();
/* The splash plan is the level the first run is built from, so the boot floor
   is built from RUN_SEED instead of a throwaway constant: painting it is then
   a copy of what already exists rather than a second generation of the maze. */
buildFloor(0, RUN_SEED);
paintSplashPlan();
requestAnimationFrame(frame);

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