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

function buildFloor(floorNum, seed){
  const rng = mulberry32(seed + floorNum*7919);
  const level = genLevel(rng, floorNum);

  const grid = level.grid;
  const at = (x,y)=> grid[y*MAP_W+x];
  const inB = (x,y)=> x>=0 && y>=0 && x<MAP_W && y<MAP_H;

  /* --- line of sight (Bresenham, walls block) --- */
  const los = makeLos(grid);

  /* The floor object is created HERE, before the bakes below write into it.
     Every per-floor buffer — light, vision, mask, cone, regions, flood — is a
     field of G, so building the next floor replaces them all at once and
     nothing floor-scoped can outlive the floor it describes. The buffers are
     preallocated because the bakes write through G from their first line;
     the fields the placement code decides are assigned after it runs. */
  setG({
    floor: floorNum,
    seed,
    grid, at, inB, los,
    rooms: level.rooms,
    exitTiles: level.exit,
    leaks: level.leaks,
    fixtures: level.fixtures,
    batteries: level.batteries,
    graffiti: level.graffiti,
    /* The three numbers the HUD and the door gate read, derived once here so
       nothing has to walk the array to answer "is this level finished". */
    leaksOpen: level.leaks.length,
    pipes: level.leaks.length,
    lightArr: new Float32Array(MAP_W*MAP_H),
    lightCv: null, lightCtx: null, lightImg: null,
    visArr: new Float32Array(MAP_W*MAP_H).fill(DARK_ROOM),
    visFrom: new Float32Array(MAP_W*MAP_H).fill(DARK_ROOM),
    visTgt: new Float32Array(MAP_W*MAP_H).fill(DARK_ROOM),
    visScratch: new Float32Array(MAP_W*MAP_H),
    maskArr: new Float32Array(MAP_W*MAP_H),
    maskTgt: new Float32Array(MAP_W*MAP_H),
    coneArr: new Float32Array(MAP_W*MAP_H),
    maskCv: null, maskCtx: null, maskImg: null,
    /* Every wall tile, once. The cone's wall pass used to scan all 5776 tiles
       every retrace — which is every frame while moving — to find the walls,
       which on a maze this dense is a few hundred of them. Built here so that
       pass is bounded by the masonry rather than by the map. */
    wallIdx: null,
    /* the static tile layer: carpet + tonal variation, and wall faces + tops.
       Two layers because the flood lands between them. */
    tilesCv: null, tilesCtx: null, wallsCv: null, wallsCtx: null,
    regionOf: new Int32Array(MAP_W*MAP_H).fill(-1),
    regionAdj: null, regionCount: 0,
    visRegion: -1, visStep: 0, visFadeT: 0,
    coneX: NaN, coneY: NaN, coneFace: NaN, coneRadar: null,
    scopeDirty: false,
    wetArr: new Float32Array(MAP_W*MAP_H),
    waterDist: null, wetByDist: [], wetFront: 0, wetMaxDist: 0, wetSum: 0,
    wetEdgeD: -1, wetIndexAtDist: null,
    wetCv: null, wetCtx: null, wetImg: null,
    postCv: null,
    dirty: { water: true, mask: true }
  });

  /* The wall index list, before anything reads it. Same row-major order as the
     scan it replaces, so the cone's wall pass writes the same tiles in the same
     order and the resulting field is bit-identical. */
  {
    const idx = [];
    for (let i=0; i<MAP_W*MAP_H; i++) if (grid[i]===WALL) idx.push(i);
    G.wallIdx = Int32Array.from(idx);
  }

  G.lightArr = computeLightArr(level, los);
  attachFloorImages();
  labelRegions(level);
  /* The mask is a SEPARATE canvas at 1 sample per tile rather than another
     term folded into the light bake. It changes every frame the character
     turns, and folding it into the lightmap would mean repacking 116k pixels
     on every small movement instead of 5.8k. */
  G.maskCv = document.createElement('canvas');
  G.maskCv.width = MAP_W; G.maskCv.height = MAP_H;
  G.maskCtx = G.maskCv.getContext('2d');
  G.maskImg = G.maskCtx.createImageData(MAP_W, MAP_H);
  G.wetCv = document.createElement('canvas');
  G.wetCv.width = MAP_W; G.wetCv.height = MAP_H;
  G.wetCtx = G.wetCv.getContext('2d');
  G.wetImg = G.wetCtx.createImageData(MAP_W, MAP_H);
  for (let i=0;i<MAP_W*MAP_H;i++) G.wetImg.data[i*4+3] = 0;
  G.agents = spawnAgents(level);
  G.player = { x: level.spawn.x, y: level.spawn.y, face:-Math.PI/2, stepT:0, stepDur:0.46, moving:false };
  G.batt = BATT_MAX;
  G.radar = false;
  G.noise = 0; G.noisePeak = 0; G.selfNoise = 0;
  G.descend = 0;
  /* THE CLOCK. Full at the moment you step through the door, counting down
     the whole level, and the only reason the level has a shape. */
  G.clock = FLOOR_CLOCK;
  G.time = 0;
  G.seenBy = 0;
  G.nearest = 99;
  G.stat = { noises:0, deaths:0, sealed:0 };
  /* how many floor tiles the water can ever reach — the denominator for
     "how flooded is this level". Counted from the distance field rather than
     guessed, so it is exactly the set of tiles that can ever go wet. */
  G.wetFloor = 0;
  G.wet = 0; G.floodCover = 0; G.atLeak = false; G.leakPower = 0;
  G.leakTotal = 0; G.leakDist = 99;
  /* Light the room the player spawned in. After this point it follows them:
     G exists, so regionAt(G.player) is meaningful. */
  scopeRoomLight(0, true);
  snapMask();

  initFlood();
  G.gfx = {
    lightCv: G.lightCv, lightCtx: G.lightCtx, lightImg: G.lightImg,
    maskCv: G.maskCv, maskCtx: G.maskCtx, maskImg: G.maskImg,
    tilesCv: G.tilesCv, tilesCtx: G.tilesCtx,
    wallsCv: G.wallsCv, wallsCtx: G.wallsCtx,
    wetCv: G.wetCv, wetCtx: G.wetCtx, wetImg: G.wetImg,
    postCv: G.postCv
  };
}

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

/* The bed follows STATE, not the individual screens. It is keyed off the names
   rather than off `show()` because `show()` is also how the pause screen comes
   up, and a title drone leaking into a pause menu is the sort of thing nobody
   reports and everybody notices.

   The floor-clear card is a menu like the other two: the room hum keeps
   running under it. What stops there is the FLOOR — acclaim() kills the leak
   and noise beds, which belong to the level that just ended. */
function syncAmbience(){
  Audio_.ambience(STATE==='splash' || STATE==='order' || STATE==='clear');
}

function advanceSplash(){
  Audio_.unlock();
  if (STATE==='splash'){
    STATE='order';
    /* The seed goes on the stub so each run's ticket reads as authored
       rather than generated. It is RUN_SEED — the same number that builds
       the floor when the player clocks in — so it is not decoration. */
    const seedEl = document.getElementById('order-seed');
    if (seedEl) seedEl.textContent = '#88D-' + (RUN_SEED>>>0).toString(16).toUpperCase().slice(-4);
    show('order');
  } else if (STATE==='order'){
    /* The chooser folds itself shut on the way in: the next time this ticket
       is seen — after a death, or a finished run — it should show the stamped
       terms, not last boot's open fold. */
    setTermsOpen(false);
    document.getElementById('btn-start').click();
  }
  syncAmbience();
}
function backSplash(){
  Audio_.unlock();
  if (STATE==='order'){ STATE='splash'; show('splash'); syncAmbience(); return true; }
  return false;                       // nothing behind splash 03: it is the first frame
}

/* A new run gets a new plan, and the splash is repainted to match even though
   nobody is looking at it yet: the win screen's RUN IT AGAIN button leads back
   through here, and a title screen showing the level you just finished would be
   the sort of small mistake that makes a procedural game feel hand-authored in
   the wrong direction. */
function rollRunSeed(){
  RUN_SEED = (Math.random()*1e9)|0;
  buildFloor(0, RUN_SEED);
  paintSplashPlan();
}

/* ============================================================
   FLOW
   ============================================================ */
let STATE='splash';      // splash | order | clear | play | pause | dead | win
/* Every screen the shell can show, in one list, because show()/hideAll() all
   enumerate them and they used to drift apart the moment a screen was added.
   The settings had a screen in this list once; they are pages of the pause
   ticket now, so the ticket is the only menu and there is no second list.
   Every entry has a #screen-<name> div — 'play' is a STATE but not a screen,
   because the run is the canvas with the HUD on it and nothing to show(). */
const SCREENS = ['splash','order','clear','pause','dead','win'];
let RUN_SEED = (Math.random()*1e9)|0;
let lives = 3, floorIdx = 0, runTime = 0;
/* The life pips are drawn from this, not from a hardcoded three. The naive
   version maps over [0,1,2], so RELAXED would render five pips with the fifth
   always spent and HARD would render three for a one-life run. */
let runLives = 3;
/* The run's own totals. G.stat is thrown away and rebuilt by buildFloor, so
   everything it counted died with the floor it was counted on: the win card
   read the LAST level's numbers and called them the run's. runStat lives as
   long as the run does, is bumped beside every G.stat bump, and is cleared
   only where a run starts — the CLOCK IN button. */
let runStat = { noises:0, deaths:0, sealed:0 };
function livesHTML(){
  return Array.from({length:Math.max(1,runLives)},
    (_,i)=> `<span class="${i<lives?'':'gone'}">&#9679;</span>`).join('');
}
function renderLives(){
  /* Goes through the HUD cache like updateHUD does, so the two can never
     disagree about what the element is showing: whichever runs second sees a
     cache that already matches the DOM and correctly writes nothing. */
  hudSet(document.getElementById('val-lives'), 'vLives', 'html', livesHTML());
}

/* THE FLOOR CLEAR.
   Between one level and the next there is a card: the clock you finished with,
   and the shape of the floor you are about to walk into. It exists for two
   reasons and neither of them is vibes — a level transition that silently
   restarts a running clock is the single most unfair thing this game could do,
   and a player who does not know the next floor carries four pipes and four
   things is walking into it with the wrong amount of caution.

   THE FLOOR IS ALREADY BUILT when this comes up. nextFloor() does its usual
   floorIdx++ / buildFloor in the same frame the door cycles, and 'clear' only
   holds the PLAYER out of it. Nothing about the state depends on the card being
   dismissed, and the tests that watch floorIdx move on the descent frame keep
   working without knowing this screen exists. */
let clearCard = { floor:0, clock:0, leaks:0, forms:0 };
function showClear(){
  const el = id => document.getElementById(id);
  el('clear-clock').textContent = clockText(clearCard.clock);
  el('clear-floor').textContent  = clearCard.floor+1;
  el('clear-leaks').textContent  = clearCard.leaks;
  el('clear-forms').textContent  = clearCard.forms;
  /* The praise scales with the clock, and only with the clock. Nailing a floor
     on the last few seconds gets the warm line; scraping back in does not, and
     the game does not congratulate you for the version where you nearly died. */
  el('clear-sub').textContent =
    clearCard.clock >= FLOOR_CLOCK*0.34 ? 'GOOD WORK. MANAGEMENT NOTICES.'
                                      : 'SEALED. MANAGEMENT HAS NO COMMENT.';
  STATE='clear';
  emit('hud', false);
  emit('screen', 'clear');
  emit('state', STATE);
  Audio_.acclaim();
}
/* ENTER, and the button, and nothing else. There is no clock on this card and
   no way back into it — the floor behind it is sealed and the floor in front of
   it is already running. ESC deliberately does nothing here: backSplash() only
   walks the title chain, so the key falls through to the play/pause toggle,
   which is also inert while STATE is 'clear'. */
function dismissClear(){
  if (STATE!=='clear') return;
  STATE='play';
  emit('screen', null);
  emit('hud', true);
  /* Every key down to nothing. The player is almost certainly holding W — they
     walked to the door — and that keydown is still set, so the first frame of
     the new floor would walk them back through it. Same reason the splash chain
     drops the key that dismissed it. */
  for (const k in keys) delete keys[k];
  emit('state', STATE);
}

function nextFloor(){
  floorIdx++;
  if (floorIdx >= FLOORS){ STATE='win'; emit('win', { sealed: runStat.sealed, deaths: runStat.deaths, noises: runStat.noises, floors: FLOORS, time: runTime });
    emit('hud', false);
    emit('screen', 'win');
    return;
  }
  /* The clock is read off the OLD floor, before the rebuild — G is replaced
     wholesale by buildFloor and the leftover seconds of the floor you just
     finished are the whole point of the card. */
  const clockLeft = G ? G.clock : FLOOR_CLOCK;
  buildFloor(floorIdx, RUN_SEED);
  /* The briefing reads the same table buildFloor reads, through the same
     clamp, so the numbers on the card are the numbers on the floor. */
  const spec = LEVELS[Math.min(floorIdx, LEVELS_N-1)];
  clearCard = { floor:floorIdx, clock:clockLeft, leaks:spec.leaks, forms:spec.forms };
  showClear();
}

/* Every way a run can end badly costs a life, rewinds the level and says why.
   Two causes, one exit: something found you, or the clock ran out. They are
   the same shape because they are the same decision — you did not get back to
   the door in time — and one screen for both means the player is never left
   guessing which rule they broke. */
function lose(cause){
  if (STATE!=='play') return;
  G.stat.deaths++;
  runStat.deaths++;
  lives--;
  Audio_.sting(); Audio_.silence(); Audio_.silenceBeds();
  STATE='dead';
  emit('lives');
  emit('hud', false);
  emit('dead', { lives, cause });
  emit('screen', 'dead');
}

function caught(){ lose('TAPE DAMAGED'); }

/* Out of time. The same cost as being caught — a life and a rewound level —
   because a clock is only a real deadline if it can actually kill you. If it
   only scolded you, three minutes would be advice. */
function outOfTime(){ lose('THE CLOCK RAN OUT'); }

/* ============================================================
   HUD + SCREENS
   ============================================================ */
const HUD = {
  batt: document.getElementById('bar-batt'),
  noise: document.getElementById('bar-noise'),
  noiseWrap: document.querySelector('.bar.noise'),
  noisePeak: document.getElementById('bar-noise-peak'),
  noiseLeak: document.getElementById('bar-noise-leak'),
  noiseLoud: document.querySelector('.bar.noise u.loud'),
  vBatt: document.getElementById('val-batt'),
  vNoise: document.getElementById('val-noise'),
  vClock: document.getElementById('val-clock'),
  clockWrap: document.getElementById('clock'),
  vPipes: document.getElementById('val-pipes'),
  vLeak: document.getElementById('val-leak'),
  vFlood: document.getElementById('val-flood'),
  barFlood: document.getElementById('bar-flood'),
  vDepth: document.getElementById('val-depth'),
  vLives: document.getElementById('val-lives'),
  prompt: document.getElementById('prompt'),
  hud: document.getElementById('hud')
};

/* m:ss, floored. The clock is read at a glance while running, so it never
   shows a value it would not show again a frame later — it counts down on whole
   seconds and that is all. */
function clockText(s){
  const t = Math.max(0, Math.ceil(s));
  return Math.floor(t/60) + ':' + String(t%60).padStart(2,'0');
}

let flashT = 0;
function flash(text){
  const el=document.getElementById('flashnote');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(flashT);
  flashT = setTimeout(()=>el.classList.remove('on'), 3400);
}

function show(which){
  for (const s of SCREENS)
    document.getElementById('screen-'+s).classList.toggle('hidden', s!==which);
}
function hideAll(){ for (const s of SCREENS)
    document.getElementById('screen-'+s).classList.add('hidden'); }

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
   THE PAUSE TICKET — SETTINGS AND BRIEFING ARE PAGES OF IT
   Every control writes straight into SETTINGS, then calls applySettings() and
   saveSettings(). There is no "apply" button and no pending copy: a slider
   that only commits on OK makes people wonder whether it saved, and these
   values are all cheap and reversible.

   They are not a screen of their own any more. They are the lower half of the
   ticket the player is already looking at, because a pause is the one moment
   the player has stopped to read a document — and a modal over that document
   hides the very thing the player paused to check. pausePage is the only state
   this adds: which page of the ticket is showing. STATE never leaves 'pause',
   so the clock stays frozen and the game behind the ticket stays stopped the
   way it always did, with no second state machine to keep in step.
   ============================================================ */
let pausePage = 'settings';      // 'settings' | 'briefing'

/* SETTINGS is where a pause lands: it is the page with something to change on
   it. BRIEFING is SPLASH 02 reprinted — the work order, the backstory and the
   controls list — for the player who clicked through it once and remembers
   none of it. It is a reprint rather than the order screen itself, because a
   reprint cannot start a run: the "any key advances" branch on the splash
   chain would fire behind the player's back otherwise, and a second copy of
   one hundred words is a cheaper thing to own than a second way to lose a
   floor. */
function setPausePage(page){
  pausePage = page;
  /* An armed RESET GAME does not survive the player's attention moving to
     another page of the ticket. */
  disarmReset();
  for (const b of document.querySelectorAll('[data-pause-page]'))
    b.classList.toggle('hidden', b.dataset.pausePage !== page);
  for (const t of document.querySelectorAll('[data-pause-tab]'))
    t.setAttribute('aria-selected', String(t.dataset.pauseTab === page));
}

/* ============================================================
   THE TERMS OF THE SHIFT
   The difficulty used to be a settings row the player could flip from the
   pause ticket, mid-run — which rewrote FLOOR_CLOCK, REPAIR_TIME and the
   hunt constants under a floor already being played, while runLives had
   been read at clock-in and stayed where it was. Now it is chosen at the
   door: the work order carries a stamp, CHANGE folds the chooser open on
   the ticket, and whatever the stamp says when CLOCK IN lands is what the
   run is built with. There is no difficulty control on the pause screen at
   all — a run is on its terms from its first frame.

   The value still lives in SETTINGS and still persists, so a returning
   player's stamp is the run they always play; a fresh machine reads NORMAL,
   the schema default, and is never unset. paintTerms is the one place the
   stamp is written, and syncSettingsUI calls it, so every path that can
   change the value — the chooser, the digits, RESET SETTINGS, a reloaded
   store — leaves the three stamps and the note saying the same thing.
   ============================================================ */
let termsOpen = false;

/* The work order is prose, and prose needs prose numbers: 240 is "4 minutes",
   150 is "2 minutes 30 seconds", 90 is "90 seconds". The briefing used to say
   "3 minutes" and "5 seconds" whatever the terms — a lie on two of the three. */
function proseClock(s){
  const m = Math.floor(s/60), r = Math.round(s%60);
  const mins = m ? `${m} minute${m===1?'':'s'}` : '';
  const secs = r ? `${r} second${r===1?'':'s'}` : '';
  return [mins, secs].filter(Boolean).join(' ') || 'no time at all';
}

function paintTerms(){
  const d = DIFFICULTIES[SETTINGS.difficulty] || DIFFICULTIES.normal;
  const set = (id, txt)=>{ const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('order-terms', d.label);
  set('pause-terms', d.label);
  /* The work order and the pause reprint of it are one document written
     twice, so the numbers on both come from here: how long the shift is and
     how long a pipe takes, in the terms' own numbers. */
  const ret = proseClock(d.clock);
  const fix = `${d.repairTime} second${d.repairTime===1?'':'s'}`;
  set('order-return', ret);
  set('brief-return', ret);
  set('order-repair', fix);
  set('brief-repair', fix);
  const note = document.getElementById('note-difficulty');
  if (note){
    note.textContent = `${d.lives} lives \u00b7 ${Math.round(d.clock)}s on the clock \u00b7 ${d.repairTime}s at the pipe`;
  }
}

function setTermsOpen(v){
  termsOpen = v;
  const fold = document.getElementById('terms-fold');
  if (fold) fold.classList.toggle('open', v);
  if (!v){
    /* The order screen has no movement, so a key held while the chooser was
       open must not carry into the run: closing the fold is the moment the
       frame goes back to being a splash, and splashes drop held keys. */
    for (const kk in keys) keys[kk] = false;
  }
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
let resetArmed = false;
let resetArmTimer = 0;
const RESET_LABEL  = 'RESET GAME';
const RESET_ARMED  = 'TAP AGAIN — LOSES THE RUN';

function paintResetButton(){
  const b = document.getElementById('btn-reset-run');
  if (b) b.textContent = resetArmed ? RESET_ARMED : RESET_LABEL;
}
function disarmReset(){
  resetArmed = false;
  clearTimeout(resetArmTimer);
  paintResetButton();
}
function armReset(){
  resetArmed = true;
  clearTimeout(resetArmTimer);
  resetArmTimer = setTimeout(disarmReset, 5000);
  paintResetButton();
}
function resetRun(){
  /* The same path boot walks: a new seed, the floor built from it, the plan
     painted from the same seed — so the riser shows the building the next
     run is actually about to be, not a picture of the one just abandoned. */
  rollRunSeed();
  floorIdx = 0;
  runTime = 0;
  runLives = (DIFFICULTIES[SETTINGS.difficulty] || DIFFICULTIES.normal).lives;
  lives = runLives;
  runStat = { noises:0, deaths:0, sealed:0 };
  emit('lives');
  /* The HUD belongs to a run; the riser is not one. */
  emit('hud', false);
  STATE = 'splash';
  emit('screen', 'splash');
  emit('state', STATE);
  disarmReset();
}


function syncSettingsUI(){
  // sliders
  for (const el of document.querySelectorAll('input[type=range][data-opt]')){
    const v = SETTINGS[el.dataset.opt];
    if (v !== undefined && Number(el.value) !== v) el.value = v;
  }
  // segmented buttons
  for (const row of document.querySelectorAll('.seg[data-opt]')){
    const key = row.dataset.opt, cur = String(SETTINGS[key]);
    for (const b of row.querySelectorAll('button')){
      b.setAttribute('aria-pressed', String(b.dataset.value === cur));
    }
  }
  /* The stamp on the work order, on its stub, and on the pause stub are the
     same fact as the segmented row, so they are painted from the same place
     the row is synced — one writer, three stamps, the note line. */
  paintTerms();
}

/* Button label sets per segmented row. Declared here rather than in markup so
   the enum and the labels cannot drift apart. */
const SEGMENTS = {
  difficulty: () => Object.keys(DIFFICULTIES).map(k => [k, DIFFICULTIES[k].label]),
  waterHue:   () => [['slate','SLATE'],['teal','TEAL'],['violet','VIOLET'],['grey','GREY']],
};

function buildSettingsUI(){
  /* The controls used to live in a modal they shared with a BACK button, and
     the return path was state juggling: remember where you were, swap STATE,
     map it back on the way out. Now the ticket's pages ARE the menu, so the
     return path is one line: the tab that is not pressed. Escape out of the
     briefing page cannot strand the player anywhere, because there is only
     ever the ticket. */
  for (const row of document.querySelectorAll('.seg[data-opt]')){
    const key = row.dataset.opt;
    const opts = (SEGMENTS[key] || (()=>[]))();
    row.innerHTML = '';
    for (const [val,label] of opts){
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.value = String(val);
      b.onclick = ()=> setOption(key, SETTINGS_SCHEMA[key].type === 'enum' ? val : (val==='true'));
      row.appendChild(b);
    }
  }
  for (const el of document.querySelectorAll('input[type=range][data-opt]')){
    const key = el.dataset.opt;
    el.addEventListener('input', ()=> setOption(key, parseFloat(el.value)));
  }
  const reset = document.getElementById('btn-settings-reset');
  if (reset) reset.onclick = ()=>{ resetSettings(); syncSettingsUI(); };
  /* No BACK on the settings page: it is the page a pause lands on, so BACK
     would mean ESC, and a second control that does what the key under the
     player's hand already does is a control nobody needs. The briefing's BACK
     is different — it goes somewhere, back to the settings page. */
  for (const t of document.querySelectorAll('[data-pause-tab]'))
    t.onclick = ()=> setPausePage(t.dataset.pauseTab);
  /* The terms chooser: the front door. CHANGE folds it out of the stamp on
     the work order; the segmented row inside it is built by the loop above,
     exactly as it was when it was a settings row. */
  const change = document.getElementById('btn-terms-change');
  if (change) change.onclick = ()=> setTermsOpen(!termsOpen);
  /* RESET GAME: arm on the first press, fire on the second. */
  const resetRunBtn = document.getElementById('btn-reset-run');
  if (resetRunBtn) resetRunBtn.onclick = ()=>{
    if (!resetArmed){ armReset(); return; }
    resetRun();
  };
}

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

function togglePause(){
  if (STATE==='play'){
    STATE='pause';
    show('pause');
    /* Every pause lands on the settings page. It is the one page of the ticket
       with something to change on it, and the page a player who came back to
       adjust the tint needs; the briefing is one click deeper for the player
       who wants to re-read the work order. */
    setPausePage('settings');
    /* The pause screen is splash 04 with the run's own numbers written on it,
       so pausing costs no bearings: depth, pipes left, clock, battery, lives,
       and the next move — all in the places a clerk would have written them.
       SCOPE OF WORK answers "what am I here for" and STATUS answers "where
       does that stand"; the ticket has a line for each because they are
       different questions. */
    const set = (id, html)=>{ const el = document.getElementById(id); if (el) el.innerHTML = html; };
    const sealed = G.pipes - G.leaksOpen;

    set('pause-level',   `${G.floor+1}/${FLOORS}`);
    set('pause-clock',   clockText(G.clock));
    set('pause-pipes',  `${sealed}/${G.pipes}`);
    set('pause-batt',    String(Math.ceil(G.batt)));
    set('pause-lives', livesHTML());
    /* The terms the run is on. Not a control — a fact, like the clock. */
    set('pause-terms',  (DIFFICULTIES[SETTINGS.difficulty] || DIFFICULTIES.normal).label);
    set('pause-seed',    '#88D-' + (RUN_SEED>>>0).toString(16).toUpperCase().slice(-4));
  }
  else if (STATE==='pause'){ disarmReset(); STATE='play'; hideAll(); }
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
const hudCache = Object.create(null);
function hudSet(el, key, prop, val){
  if (!el || hudCache[key] === val) return;
  hudCache[key] = val;
  if (prop === 'text') el.textContent = val;
  else if (prop === 'html') el.innerHTML = val;
  else el.style[prop] = val;
}
function hudFlag(el, key, cls, on){
  if (!el || hudCache[key] === on) return;
  hudCache[key] = on;
  el.classList.toggle(cls, on);
}

function updateHUD(){
  if (!G) return;
  hudSet(HUD.batt, 'batt', 'width', (G.batt/BATT_MAX*100)+'%');
  hudSet(HUD.vBatt, 'vBatt', 'text', Math.ceil(G.batt));
  /* The NOISE bar, on the noise scale and not the battery one. Divided by
     BATT_MAX it drew 1% of itself for a sprint and 1.8% for the door, while the
     red test below still fired on the raw level and turned the bar hot at a
     level it could not show. Three marks now: the fill (what you are making),
     the water-blue floor (what the open pipes are making, everywhere — the
     number a searching Lifeform steers by), and the peak tick, because a sprint
     lasts 0.26s and the fill alone cannot say that it happened. */
  const nz = Math.max(0, Math.min(1, G.noise/NOISE_FS))*100;
  hudSet(HUD.vNoise, 'vNoise', 'text', String(Math.round(nz)).padStart(2,'0'));
  /* TWO FILLS, ONE BAR. The yellow is what YOU are making; the blue is what
     the open pipes are making, everywhere on the floor, at the level the
     Lifeform is steering by. Standing still beside a burst pipe used to fill
     this bar to its top, which reads as "you are screaming" when you are
     standing perfectly still and something is coming to the PIPE, not to you.
     The number above is the loudest of the two, because that is what the room
     actually sounds like. */
  hudSet(HUD.noise, 'noise', 'width', Math.max(0, Math.min(1, G.selfNoise/NOISE_FS))*100+'%');
  /* LOUD, on YOUR noise, and read from the constant. A pipe never reaches it
     by construction, so red still means "this is about you" — and the old 0.45
     was a stale copy of a threshold that lives at 0.5. */
  hudFlag(HUD.noiseWrap, 'noiseHot', 'hot', G.selfNoise>=LOUD);
  G.noisePeak = Math.max(G.noise, G.noisePeak - 0.004);
  hudSet(HUD.noisePeak, 'noisePeakL', 'left', Math.max(0, Math.min(100, G.noisePeak/NOISE_FS*100))+'%');
  hudSet(HUD.noisePeak, 'noisePeakO', 'opacity', '1');
  hudSet(HUD.noiseLeak, 'noiseLeak', 'width', (Math.max(0, Math.min(1, G.leakTotal/NOISE_FS))*100)+'%');
  /* the LOUD mark, positioned from the constant rather than typed into the
     stylesheet: it is the threshold the AI reads, and a hardcoded 50% went
     stale the moment full scale stopped being 1.0 */
  hudSet(HUD.noiseLoud, 'noiseLoud', 'left', (LOUD/NOISE_FS*100)+'%');
  /* Three pipe readouts, because they answer three different questions and a
     single "OPEN/SEALED" cannot answer any of them. PIPES is the tally you are
     working down. DOOR is whether the level can end at all — it stays shut until
     the last one is closed. FLOOD is a gauge of how much of the floor is under
     water: it keeps climbing while you are still working, and it drains after
     the last seal, so it is both the pressure and the proof the repair worked. */
  hudSet(HUD.vPipes, 'vPipes', 'text', `${G.pipes-G.leaksOpen}/${G.pipes}`);
  /* The door. OPEN means every pipe is sealed and the level can be ended, so
     OPEN is the good state and gets no colour; SEALED is the only one that
     shouts. The old version injected <span class="ok">OPEN</span> with ok being
     water-blue, next to a flood gauge also in water-blue — so the word that
     answers "can I leave yet" looked like it belonged to the thing keeping you
     here. Text plus a class, not markup, so the stylesheet can say what the
     states mean. */
  hudSet(HUD.vLeak, 'vLeak', 'text', G.leaksOpen===0 ? 'OPEN' : 'SEALED');
  hudFlag(HUD.vLeak, 'vLeakShut', 'shut', G.leaksOpen>0);
  hudSet(HUD.vFlood, 'vFlood', 'text', String(Math.round(G.floodCover*100)).padStart(2,'0'));
  hudSet(HUD.barFlood, 'barFlood', 'width', (G.floodCover*100)+'%');
  /* The clock. Whole seconds, and it changes COLOUR in the last thirty — the
     same thirty the flash announces — because a number that does not change
     colour is a number players stop seeing after the first level, and a number
     that changes SIZE is one that reflows its own box once a second for three
     minutes. Both flags live on the wrapper, so the stylesheet owns what
     "low" and "critical" look like and this never has to restate it. */
  hudSet(HUD.vClock, 'vClock', 'text', clockText(G.clock));
  hudFlag(HUD.clockWrap, 'clockLow', 'low',     G.clock <= 30);
  hudFlag(HUD.clockWrap, 'clockCrit', 'critical', G.clock <= 10);
  hudSet(HUD.vDepth, 'vDepth', 'text', `${G.floor+1}/${FLOORS}`);
  /* innerHTML, and the reason this one mattered most: a run of spans was being
     PARSED as HTML sixty times a second to redraw three bullet characters that
     change when you die. */
  hudSet(HUD.vLives, 'vLives', 'html', livesHTML());
}

/* The prompt line. One of five strings, and it holds whichever one applies for
   seconds at a time — so it was being rebuilt as a template literal and handed
   to the DOM every frame, which re-inserts the text node and re-lays-out the
   line every frame to say the same four words. The element reference is cached
   here too rather than looked up per frame. */
function setPrompt(){
  const el=HUD.prompt;
  if (!G){ hudFlag(el, 'promptOn', 'on', false); return; }
  let working = 0;
  for (const L of G.leaks) if (!L.fixed && L.repair > 0.02) working++;
  /* The repair prompt is first because it is the only state in the game where
     the player must NOT press a key, and the prompt line is where they look to
     find out what the game wants. Everything else is a movement instruction. */
  let msg;
  if (working)              msg = 'wrenching \u2014 DO NOT MOVE';
  else if (G.atLeak)        msg = `hold still \u2014 ${REPAIR_TIME} seconds at the pipe`;
  else if (G.descend>0.02)  msg = 'cycling door \u2014 do not stop';
  else if (G.leaksOpen>0)   msg = `${G.leaksOpen} PIPE${G.leaksOpen===1?'':'S'} LEAKING \u2014 THE WATER RUNS DOWNHILL FROM THE BREAK`;
  else                      msg = 'the door will cycle \u2014 GET BACK TO THE ONE YOU CAME IN THROUGH';
  hudSet(el, 'prompt', 'text', msg);
  hudFlag(el, 'promptOn', 'on', true);
}

/* ---------- buttons ---------- */
document.getElementById('btn-start').onclick = ()=>{
  Audio_.init();
  Audio_.unlock();
  /* The seed is NOT rolled here. It was rolled before the splash was painted,
     because the plan behind the title has to be the level the player is about
     to walk — re-rolling at the moment of entry would make the splash a lie
     and nothing else. A finished run rolls its own; see rollRunSeed(). */
  runLives = (DIFFICULTIES[SETTINGS.difficulty] || DIFFICULTIES.normal).lives;
  lives = runLives; floorIdx=0; runTime=0;
  /* A new run, so a new tally: the win card is the only reader and it must not
     inherit the previous run's seals and deaths. */
  runStat = { noises:0, deaths:0, sealed:0 };
  emit('lives');
  /* Floor 0 was already built at boot — the same seed, the same geometry the
     splash plan was painted from — so building it again here generates the
     identical level a second time for nothing. Reuse it instead.

     The extra two conditions are what stop the reuse from handing back a
     PLAYED floor: a run that died on floor 1 and came back through CLOCK IN
     (lives spent, btn-retry forwards to here) has the same seed and the same
     floor number, but its pipes are sealed and its clock has run. A floor
     that has never ticked and still has every pipe open is the only floor
     worth keeping. The clock check also catches a difficulty change made
     after boot, whose FLOOR_CLOCK the boot floor was never built with. */
  const reuse = G && G.floor===0 && G.seed===RUN_SEED
                && G.clock >= FLOOR_CLOCK && G.leaksOpen === G.pipes;
  if (!reuse) buildFloor(0, RUN_SEED);
  else {
    G.clock = FLOOR_CLOCK; G.time = 0; G.batt = BATT_MAX;
    G.stat = {noises:0, deaths:0, sealed:0};
    G.radar = false; G.noise = 0; G.noisePeak = 0; G.selfNoise = 0; G.descend = 0; G.seenBy = 0;
    initFlood();          // the flood the builder warmed, warmed again here
    snapMask();
  }
  /* The opening grace period, on the start path either way — reuse and a
     fresh build have to be indistinguishable from where the player stands. */
  for (const a of G.agents){ a.born = 3.0; }
  emit('screen', null);
  STATE='play';
  emit('hud', true);
  emit('state', STATE);        // the title bed has no business following you downstairs
};

document.getElementById('btn-descend').onclick = ()=>dismissClear();
document.getElementById('btn-retry').onclick = ()=>{
  if (lives<=0){
    document.getElementById('btn-start').click(); return;
  }
  buildFloor(floorIdx, RUN_SEED);
  G.batt = Math.max(G.batt, 55);
  /* The retry keeps the same seed, so the pipes are where you left them and
     the flood restarts. Dying costs you a life and the work you did on them,
     but not the knowledge — which is the split that matters, because where the
     pipes are is the thing you spent the level learning and a re-roll would
     erase it. */
  for (const a of G.agents){ a.born=3.0; }
  emit('screen', null); STATE='play';
  emit('hud', true);
  emit('state', STATE);
};
document.getElementById('btn-again').onclick = ()=>{
  rollRunSeed();                 // a new run deserves a new building
  document.getElementById('btn-start').click();
};

/* ============================================================
   LOOP

   A FIXED SIMULATION STEP, and an accumulator.

   It used to hand `update()` whatever the frame time happened to be, capped at
   50ms. That cap is the whole problem in one line: below 20fps the cap binds,
   and from then on the game runs in SLOW MOTION — the clock, the flood, the
   repair bar and the noise decay all fall behind real time together, and a
   player fighting for their life on a slow machine is not playing the same game
   as one at 60fps. Worse, the camera in render() smoothed against the REAL
   elapsed time while the world it was framing had only advanced by the capped
   amount, so the two disagreed and the view rubber-banded against the thing it
   was following.

   Now the simulation only ever moves in whole 1/60s steps, and a long frame
   runs as many of them as it owes (up to MAX_STEPS, so a machine that cannot
   keep up falls behind in bounded jumps rather than entering a spiral where
   each frame owes more than the last). What is left over is handed to render()
   as an interpolation fraction, which is what makes the movement continuous
   between steps instead of quantised to them.

   Measured: at 60fps the clock now burns real time exactly (2.000s of clock per
   2.001s of wall clock). At a forced 12.5fps it burns 0.96 — the remaining 4%
   is the substep budget, which is a deliberate, bounded loss rather than the
   unbounded drift the old cap produced.

   update(dt) keeps its signature and its single-call semantics: the headless
   suite drives it directly with the dt it wants and nothing here changes that.
   */
const SIM_STEP    = 1/60;
/* The spiral guard: at most this many steps per frame. Sized so the simulation
   stays on real time all the way down to 10fps (a 100ms frame is six steps) —
   below the old 50ms cap the game ran in slow motion, and below this it runs
   slightly slow rather than not at all. A step costs ~0.04ms, so the whole
   budget is under a quarter of a millisecond: raising it further would buy
   8fps of tolerance for a cost the frame cannot feel, and lowering it would
   start dropping simulated time on machines that are merely struggling. */
const MAX_STEPS   = 6;
let   simAcc      = 0;
let   last        = performance.now();
function frame(now){
  let dt = (now-last)/1000;
  last = now;
  /* A tab that was in the background comes back with an enormous dt. Capping
     the accumulator rather than each step is what stops the game from trying to
     catch up on ten seconds of simulation in one frame. */
  simAcc = Math.min(simAcc + dt, SIM_STEP*MAX_STEPS);

  if (STATE==='play'){
    let steps = 0;
    while (simAcc >= SIM_STEP && steps < MAX_STEPS){
      runTime += SIM_STEP;
      update(SIM_STEP);
      simAcc -= SIM_STEP;
      steps++;
      /* update() can end the frame — a death, or the door cycling into the next
         floor. Stop stepping and do not let a stale accumulator carry into the
         new floor. */
      if (STATE!=='play'){ simAcc = 0; break; }
    }
    setSimAlpha(simAcc / SIM_STEP);   // 0..1, where in the current step we are
    /* Anything owed beyond MAX_STEPS is dropped rather than banked: on a machine
       that cannot hold 60Hz the honest thing is to run slightly slow, not to
       accumulate an unpayable debt. */
    if (simAcc >= SIM_STEP) simAcc = 0;
    updateHUD(); setPrompt();
  } else {
    simAcc = 0;
  }
  /* Frame time is measured across the WHOLE frame — simulation, render and the
     browser's own compositing — because that is what the player experiences as
     smoothness and it is the only number the adaptive resolution can honestly
     respond to. Sampled before render() so the figure covers the interval we
     are about to work in. */
  const frameMs = now - lastRenderStart;
  lastRenderStart = now;
  if (frameMs > 0 && frameMs < 1000) adaptResolution(frameMs);

  if (G) render(now);

  requestAnimationFrame(frame);
}
let lastRenderStart = performance.now();

/* ---- boot ----
   The store is read BEFORE anything that depends on it, and applySettings
   runs before the first buildFloor so the opening floor is generated with the
   player's depth and repair time already in place. Building the floor first
   and applying after would mean the first floor of a run quietly used NORMAL
   while the menu said HARD. */
resize();
buildPatterns();
buildGlowSprite();
/* Called once per frame with the measured frame time. Kept out of resize() so
   that a window resize cannot be mistaken for a slow machine and start a
   resolution change on its own. */
function adaptResolution(ms){
  /* Exponential average rather than an instantaneous read: one 40ms hitch from
     a garbage collection pause or a tab switch must not cost a resolution step,
     and the hysteresis bands below do not protect against a decision taken on
     a single sample. */
  frameMsAvg += (ms - frameMsAvg) * 0.05;

  if (frameMsAvg > SCALE_DROP_MS){
    goodRun = 0; badRun++;
    if (badRun > SCALE_BAD_FRAMES && renderScaleIdx < RENDER_SCALES.length-1){
      setRenderScaleIdx(renderScaleIdx+1);
      badRun = 0; frameMsAvg = 16.7;      // re-measure at the new size, not the old
      resize();
      return 'drop';
    }
  } else if (frameMsAvg < SCALE_RECOVER_MS){
    badRun = 0; goodRun++;
    /* Only while PLAYING. On the splash the canvas is not what the player is
       looking at, and a resolution change there re-bakes the grain, the
       vignette and the splash plan for no reason. */
    if (goodRun > SCALE_GOOD_FRAMES && renderScaleIdx > 0 && STATE==='play'){
      setRenderScaleIdx(renderScaleIdx-1);
      goodRun = 0; frameMsAvg = 16.7;
      resize();
      return 'raise';
    }
  } else {
    badRun = 0; goodRun = 0;
  }
  return null;
}

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
on('stat', k => { runStat[k]++; });
on('caught', caught);
on('clock:out', outOfTime);
on('door:cycled', nextFloor);
loadSettings();
applySettings();
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
  set STATE(v){ STATE = v; },
  get floorIdx(){ return floorIdx; }, set floorIdx(v){ floorIdx = v; },
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
  set RUN_SEED(v){ RUN_SEED = v; },
  mulberry32, seedSplash,
  togglePause, clockText,
  get pausePage(){ return pausePage; },
  setPausePage,
  get termsOpen(){ return termsOpen; },
  setTermsOpen,
  resetRun,
  get resetArmed(){ return resetArmed; },
  get FLOORS(){ return FLOORS; },
  get HUNT_BASE(){ return HUNT_BASE; }, get HUNT_STEP(){ return HUNT_STEP; },
  get lives(){ return lives; }, set lives(v){ lives = v; },
  set runTime(v){ runTime = v; },
  get runLives(){ return runLives; },
  get runStat(){ return runStat; },
  /* the cast, inlined: the avatar's rig and the thing hunting it */
  drawRigger, drawStalker, ENT,
};