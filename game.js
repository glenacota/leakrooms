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

/* ENTER is the confirm key for whichever modal is up: start, resume, rewind,
   run again. It also fires when a button already has focus, so guard against
   the click landing twice. */
const MODAL_ACTION = {
  splash: ()=>advanceSplash(),
  order:  ()=>advanceSplash(),
  /* The pause ticket has no resume button — ESC is the resume, and the things
     under it are the ticket's own pages and controls. Pointing ENTER at a
     button that is not on the screen is how a modal ends up with a dead
     confirm key. */
  pause:  ()=>togglePause(),
  clear:  ()=>dismissClear(),
  dead:   ()=>document.getElementById('btn-retry').click(),
  win:    ()=>document.getElementById('btn-again').click(),
};

window.addEventListener('keydown', e=>{
  const k = e.key.toLowerCase();
  keys[k] = true;

  /* Every key is a user gesture, and the AudioContext cannot start without
     one. This is the single place the game hears about input, so it is the one
     place the unlock has to live. */
  Audio_.unlock();

  /* M, anywhere, at any time. Not just during play: a player who wants the
     sound off usually wants it off BEFORE the title screen finishes its four
     second fade-in, and a hotkey that only works once you are in a level is a
     hotkey that arrives too late to be useful.

     It RETURNS rather than falling through, which is load-bearing. On the
     splash chain any unmodified key advances, so without this the mute key
     doubles as "skip intro" — the title vanishes under the finger of someone
     who is trying to turn the music off. It also drops the key state for the
     same reason ENTER does: a held M would otherwise still be down when the run
     starts, and M is not a movement key but the discipline is the same. */
  if (k==='m'){
    if (!e.repeat) toggleMute();
    delete keys[k];
    e.preventDefault();
    return;
  }

  /* ESC on the work order dismisses the terms chooser before it walks the
     splash chain. The chooser is the top layer of the order screen, and a
     player who folded it open to change the terms should not fall out of the
     ticket and onto the riser for one mistimed press. This has to run BEFORE
     backSplash, or the chain claims the key first. */
  if (e.key==='Escape' && STATE==='order' && termsOpen){
    setTermsOpen(false);
    delete keys[k];
    return;
  }

  /* ESC walks the splash chain backwards: from the work order to the pipe.
     It does nothing on splash 03, which is the first frame — there is nothing
     behind it, and a key that silently does nothing is worse than no key. */
  if (e.key==='Escape'){
    if (backSplash()){ delete keys[k]; return; }
  }

  /* ESC steps the pause ticket's pages backwards before it leaves the ticket:
     the briefing page returns to the settings page, and only the settings
     page resumes. Same shape as backSplash, applied to the pages instead of
     the screens, so a player who opened the briefing to re-read a control
     cannot lose the run to one mistimed press. */
  if (e.key==='Escape' && STATE==='pause' && pausePage!=='settings'){
    setPausePage('settings');
    delete keys[k];
    return;
  }

  if (k==='enter'){
    const act = STATE==='splash' ? MODAL_ACTION.splash
              : STATE==='order'  ? MODAL_ACTION.order
              : STATE==='clear'  ? MODAL_ACTION.clear
              : STATE==='pause'  ? MODAL_ACTION.pause
              : STATE==='dead'   ? MODAL_ACTION.dead
              : STATE==='win'    ? MODAL_ACTION.win
              : null;
    /* Auto-repeat is blocked, same as below: holding ENTER down would blow
       through the splash and start a second run behind the first. */
    if (act && !e.repeat){
      const focused = document.activeElement;
      const onButton = focused && focused.tagName === 'BUTTON';
      /* ENTER folds the terms chooser shut rather than clocking in. The pick
         is already made — every term button commits on click — so starting
         the run from the key that dismissed the chooser is how a player clocks
         in on terms they were still reading. preventDefault keeps the browser
         from also activating the focused term button. */
      if (STATE==='order' && termsOpen){
        setTermsOpen(false);
        delete keys[k];
        e.preventDefault();
        return;
      }
      /* The ticket carries real controls now. A focused tab or button answers
         ENTER itself: the key falls through to the browser and activates the
         control, instead of resuming the run over the top of the click. */
      if (STATE==='pause' && onButton
          && focused.closest && focused.closest('#screen-pause')) return;
      act();                                  // close the modal
      if (onButton) focused.blur();           // no second activation via Enter
      /* The key that dismissed the splash must not carry into the run: the
         same keydown set keys[k] above, and a held W would otherwise walk the
         player out of the door they just came through. */
      delete keys[k];
    }
    e.preventDefault();
    return;
  }

  /* On the splash chain, any unmodified key advances. Sprint and the arrow
     keys are movement, so holding one through the splash should move the
     player the instant the run starts — advance once per press, not per
     repeat, and drop the key state with it. Escape is excluded: it walks
     backwards, and on splash 03 it means "stay here".

     One exception, and it is the work order while the terms chooser is open:
     the frame is a form at that moment, and a form that starts a run on a
     stray keystroke is a form nobody fills in. */
  if ((STATE==='splash'||STATE==='order') && e.key!=='Escape'
      && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat
      && !(STATE==='order' && termsOpen)){
    advanceSplash();
    delete keys[k];
    if (STATE==='play') e.preventDefault();
    return;
  }

  /* A key the open chooser swallowed is dropped, not held: it did nothing on
     this screen, and a key that did nothing must not walk the player out of
     the door the moment the run starts. The splash chain already drops the
     key that advances it; this is the same discipline for the one branch that
     does not advance. */
  if (STATE==='order' && termsOpen) delete keys[k];

  /* The chooser owns the number row and the left/right arrows while it is
     open: 1-3 are the three terms in DIFFICULTIES order, and the arrows cycle
     the same way the segmented row does with a mouse. */
  if (STATE==='order' && termsOpen){
    const list = Object.keys(DIFFICULTIES);
    const at = Math.max(0, list.indexOf(String(SETTINGS.difficulty)));
    if (['1','2','3'].includes(k) && +k <= list.length){
      setOption('difficulty', list[+k-1]);
      e.preventDefault();
      return;
    }
    if (e.key==='ArrowLeft' || e.key==='ArrowRight'){
      const step = e.key==='ArrowRight' ? 1 : -1;
      setOption('difficulty', list[(at + step + list.length) % list.length]);
      e.preventDefault();
      return;
    }
  }

  if (k==='r' && G && STATE==='play'){
    if (G.radar) G.radar = false;
    else if (G.batt<=0) flash('NO POWER — THE RADAR IS DEAD');
    else { G.radar = true; Audio_.rattle(0.4); }
  }
  if (e.key==='Escape' && (STATE==='play'||STATE==='pause')) togglePause();
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)){
    /* One exception: the ticket's own controls. Arrows drag the focused slider
       and SPACE activates a focused button, so those keys belong to the pause
       screen while the pause screen has focus. Everywhere else they are
       movement, and a held arrow through the splash must not scroll anything. */
    if (STATE==='pause'){
      const el = document.activeElement;
      if (el && el.closest && el.closest('#screen-pause')
          && (el.tagName==='INPUT' || el.tagName==='BUTTON')) return;
    }
    e.preventDefault();
  }
});
window.addEventListener('keyup', e=>{
  const k=e.key.toLowerCase();
  keys[k] = false;
});

/* ============================================================
   THE SPLASH SCREENS
   Two frames before the run: 03 PIPE (title, rising water) then
   04 WORK ORDER 88-D (the ticket, which is also the controls list).
   One advance function drives both, so ENTER, any key, and a click
   all land in the same place and cannot disagree with each other.
   ============================================================ */



/* ============================================================
   FLOW
   ============================================================ */


/* ============================================================
   HUD + SCREENS
   ============================================================ */


/* M. Goes through setOption rather than poking Audio_ directly, so the store is
   written and the UI re-synced on the same path as every other setting — a mute
   that only lives in a variable is a mute that forgets itself on reload. The
   blip is fired AFTER, and only on unmute, because a confirmation you cannot
   hear is not a confirmation. */
function toggleMute(){
  const next = !SETTINGS.muted;
  setOption('muted', next);
  flash(next ? 'AUDIO MUTED' : 'AUDIO ON');
  if (!next) Audio_.blip(true);
}



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




/* Click anywhere on either splash advances it, so a player who never reads
   the keyboard prompt is not stuck. The advance function keys off STATE, so
   the click that lands on CLOCK IN and then bubbles up to the screen a second
   time finds STATE already 'play' and does nothing.

   Two guards, both for the work order now that it carries controls. A click
   that lands on a control — a term button, a slider, CHANGE, CLOCK IN itself —
   is a choice, not an advance: bubbling it up to the screen is how a player
   who meant to read the terms starts a run on HARD. And while the chooser
   is open, a click on the frame dismisses it the way ESC does, because an
   open chooser is the top layer of the screen. */
for (const id of ['screen-splash','screen-order']){
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', (e)=>{
    if (e.target.closest && e.target.closest('button, input, .terms-fold')) return;
    if (STATE==='order' && termsOpen){ setTermsOpen(false); return; }
    advanceSplash();
  });
}


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

/* ---------- buttons ---------- */
/* The wiring, not the work: each control calls the run function that owns it. */
document.getElementById('btn-start').onclick   = ()=>startRun();
document.getElementById('btn-descend').onclick = ()=>dismissClear();
document.getElementById('btn-retry').onclick   = ()=>retryFloor();
document.getElementById('btn-again').onclick   = ()=>runAgain();


/* ---- boot ----
   The store is read BEFORE anything that depends on it, and applySettings
   runs before the first buildFloor so the opening floor is generated with the
   player's depth and repair time already in place. Building the floor first
   and applying after would mean the first floor of a run quietly used NORMAL
   while the menu said HARD. */
resize();
buildPatterns();
buildGlowSprite();

function applySettings(){
  const d = DIFFICULTIES[SETTINGS.difficulty] || DIFFICULTIES.normal;
  applyDifficulty(d);
  Audio_.setMaster(SETTINGS.master);
  /* Both of them, or the settings modal becomes a lie. M flips the stored flag
     through setOption, which lands here — and this used to push only the volume,
     so the mute persisted perfectly and changed nothing at all. A setting that
     saves, survives a reload, and has no effect is the worst kind of setting,
     because the reload appears to prove it worked. */
  Audio_.setMuted(SETTINGS.muted);
}

on('settings:changed', key => {
  if ((key === '*' || key === 'waterHue' || key === 'waterContrast') && G) G.dirty.water = true;
  applySettings();
  syncSettingsUI();
});
on('screen', name => { if (name === null) hideAll(); else show(name); });
on('hud', on_ => { const h = document.getElementById('hud'); if (on_) h.classList.add('on'); else h.classList.remove('on'); });
on('dead', ({ lives, cause }) => {
  const sub = document.getElementById('dead-sub');
  if (lives > 0) sub.textContent = `${lives} LIVES REMAINING \u2014 ${cause}`;
  else sub.textContent = 'SIGNAL LOST';
});
on('win', ({ sealed, deaths, noises, floors, time }) => {
  document.getElementById('win-stats').innerHTML =
    `You sealed <b>${sealed}</b> pipes and got back through the door on all <b>${floors}</b> levels.<br>Deaths: <b>${deaths}</b> &nbsp; Noise made: <b>${noises}</b><br>Time: <b>${Math.floor(time/60)}:${String(Math.floor(time%60)).padStart(2,'0')}</b>`;
});
on('lives', renderLives);
on('state', syncAmbience);
// textures subscription registered at import of render/textures.js; plan rebuild after.
on('resize', ()=>{ if (G) paintSplashPlan(); });
on('flash', flash);
on('sfx', (n, ...a) => Audio_[n](...a));
loadSettings();
applySettings();
/* The loop owns the frame; the shell owns the drawing and the HUD refresh, so
   both are handed in rather than imported. */
bindRun();
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