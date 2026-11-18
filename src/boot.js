/* The composition root: the one place that wires the game together. 
   Nothing else in src/ may import this file, and the step order below matters —
   changing it can change how the game behaves. */
import { resize, setRenderScaleIdx } from './render/canvas.js';
import { buildPatterns } from './render/textures.js';
import { applySettings, bindDom } from './ui/bind.js';
import { bindCards } from './ui/cards.js';
import { bindHints, tickLoudFlash, tickCues } from './ui/hints.js';
import { bindTutorials, tickTutorials } from './ui/tutorials.js';
import { initManualArt } from './ui/manual-art.js';
import { buildSettingsUI, syncSettingsUI } from './ui/settings-panel.js';
import { Audio_ } from './audio/index.js';
import { syncAmbience } from './ui/splash.js';
import { applyEasyFloor, buildFloor } from './game/floor.js';
import { bindFloorSurfaces, buildFloorSurfaces } from './render/floor-surfaces.js';
import { paintSplashPlan } from './render/splash-plan.js';
import { bindRun } from './game/run.js';
import { bindInput } from './ui/input.js';
import { bindButtons } from './ui/buttons.js';
import { initTouch } from './ui/touch.js';
import { initHaptics } from './ui/haptics.js';
import { initFullscreen } from './ui/fullscreen.js';
import { initPerf } from './ui/perf.js';
import { emit, on, EVENT } from './util/events.js';
import { mobileVerdict, showMobileNotice, looksHandheld } from './ui/mobile.js';
import { setFatalHook, setFrameHooks } from './game/loop.js';
import { adaptResolution } from './render/adaptive.js';
import { render, setSimAlpha } from './render/render.js';
import { updateHUD, tickTouchHud } from './ui/hud.js';
import { loadSettings } from './settings/store.js';
import { RUN_SEED } from './game/run.js';
import { frame } from './game/loop.js';
import { RENDER_START_IDX_HANDHELD } from './config/constants.js';

// Starts the game through ordered phases.
export function boot(){
  prepare();
  connect();
  initialize();
  start();
}

// Shows the "SYSTEM FAULT" card with a reload button when the game hits an error it cannot recover from
function showFatal(err){
  if (err) console.error(err);
  const el = document.getElementById('fatal');
  if (el) el.classList.remove('hidden');
}

function prepare(){
  // Fatal errors surface to the player
  setFatalHook(showFatal);
  window.addEventListener('error',              e => showFatal(e.error || e));
  window.addEventListener('unhandledrejection', e => showFatal(e.reason || e));
  document.getElementById('btn-reload').onclick = ()=>globalThis.location?.reload();
  initManualArt();

  // A handheld may start at a lower render scale so it stays under its limit
  if (looksHandheld()) setRenderScaleIdx(RENDER_START_IDX_HANDHELD);

  resize();
  buildPatterns();
}

function connect(){
  bindRun();
  bindDom();
  bindFloorSurfaces();
  on(EVENT.floorPreparing, buildFloorSurfaces);
  bindCards();
  bindHints();
  bindTutorials();
  bindInput();
  bindButtons();
  initTouch();
  initHaptics();
  initFullscreen();
  initPerf();
}

function initialize(){
  applyEasyFloor(new URLSearchParams(globalThis.location?.search || '').has('easy'));
  /* A handheld plays with the touch layer; one that cannot run it gets the notice.
     Touch mode is not locked: a tablet that later gets a key press goes back to keyboard. */
  const verdict = mobileVerdict();
  if (verdict === 'blocked') showMobileNotice();
  else if (verdict === 'touch') emit(EVENT.inputMode, 'touch');

  // Settings are applied before the controls are built, so the UI shows the loaded values
  loadSettings();
  applySettings();
  buildSettingsUI();
  syncSettingsUI();

  // Audio is built at boot so the title screen has its ambient sound
  try {
    Audio_.init();
    syncAmbience();
  } catch (err){
    console.warn('audio unavailable:', err);
  }

  // Build floor 0 from RUN_SEED. The title screen paints a faded plan of this same floor
  buildFloor(0, RUN_SEED);
  paintSplashPlan();
}

function start(){
  setFrameHooks({ render, simAlpha: setSimAlpha, adaptive: adaptResolution, afterStep: tickTutorials,
                  afterUpdate: ()=>{ updateHUD(); tickCues(); tickLoudFlash(); tickTouchHud(); } });
  requestAnimationFrame(frame);
}
