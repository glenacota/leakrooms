/* The composition root: the one place where the whole game is put together.

   boot() creates the canvas and textures, connects the modules to each other,
   loads saved settings, builds the first floor, and starts the game loop.
   The browser and the test harness both call it.

   Rule: nothing else in src/ may import this file. The order of the steps
   inside boot() matters, so changing it can change how the game behaves. */
import { resize, setRenderScaleIdx } from './render/canvas.js';
import { buildPatterns } from './render/textures.js';
import { applySettings, bindDom } from './ui/bind.js';
import { bindCards } from './ui/cards.js';
import { bindHints, tickLoudFlash } from './ui/hints.js';
import { buildSettingsUI, syncSettingsUI } from './ui/settings-panel.js';
import { Audio_ } from './audio/index.js';
import { syncAmbience } from './ui/splash.js';
import { buildFloor } from './game/floor.js';
import { paintSplashPlan } from './render/splash-plan.js';
import { bindRun } from './game/run.js';
import { bindInput } from './ui/input.js';
import { bindButtons } from './ui/buttons.js';
import { initTouch } from './ui/touch.js';
import { initHaptics } from './ui/haptics.js';
import { initFullscreen } from './ui/fullscreen.js';
import { initPerf } from './ui/perf.js';
import { emit } from './util/events.js';
import { mobileVerdict, showMobileNotice, looksHandheld } from './ui/mobile.js';
import { setFatalHook, setFrameHooks } from './game/loop.js';
import { adaptResolution } from './render/adaptive.js';
import { render, setSimAlpha } from './render/render.js';
import { drawBatteryMeter } from './render/battery-meter.js';
import { updateHUD, setPrompt, tickTouchHud } from './ui/hud.js';
import { loadSettings } from './settings/store.js';
import { RUN_SEED } from './game/run.js';
import { frame } from './game/loop.js';
import { RENDER_START_IDX_HANDHELD } from './config/constants.js';

/**
 * Shows the "SYSTEM FAULT" card when the game hits an error it cannot recover
 * from. Every kind of failure (a boot error, an uncaught error, an unhandled
 * promise rejection, or the loop giving up) ends up here, so the player always
 * sees the same message with a reload button.
 *
 * The card is not one of the normal screens, so it has no show() call
 * and simply removes its own "hidden" class.
 *
 * @param {Error} [err] - what went wrong; logged to the console if given.
 */
function showFatal(err){
  if (err) console.error(err);
  const el = document.getElementById('fatal');
  if (el) el.classList.remove('hidden');
}

/**
 * Starts the game: sets up the canvas, connects the modules, loads settings,
 * builds the first floor and starts the frame loop.
 */
export function boot(){
  /* Set up error handling first, so that anything that fails during the rest
     of boot (or later, while playing) shows the fatal card. Without it, a
     crash would leave a black or frozen screen that tells the player nothing. */
  setFatalHook(showFatal);
  window.addEventListener('error',              e => showFatal(e.error || e));
  window.addEventListener('unhandledrejection', e => showFatal(e.reason || e));
  document.getElementById('btn-reload').onclick = ()=>globalThis.location?.reload();
  const manualBattery = document.getElementById('manual-battery');
  const meterCtx = manualBattery.getContext('2d');
  if (!meterCtx) throw new Error('2D canvas context unavailable for manual battery meter');
  meterCtx.save();
  meterCtx.translate(28, 30);
  meterCtx.scale(1.3, 1.3);
  meterCtx.globalAlpha = 0.75;
  drawBatteryMeter(meterCtx, 0, 0, 83, true, -Math.PI/3);
  meterCtx.restore();

  /* A handheld may start at a lower render scale so it stays under its limit.
     RENDER_START_IDX_HANDHELD is 0 here (full resolution); real device data
     may raise it later. looksHandheld() is read before the first resize() so
     the initial scale is already the right one. */
  if (looksHandheld()) setRenderScaleIdx(RENDER_START_IDX_HANDHELD);

  /* Size the canvas and build the drawing resources. No listeners are
     connected yet, so this first resize() does not trigger any redraw work. */
  resize();
  buildPatterns();

  /* Connect the modules to each other through the event bus and the DOM.
     The order is:
       1. bindRun      the run reacts to what the simulation reports
       2. bindDom      events are turned into on-screen changes
       3. bindInput    keyboard handling
       4. bindButtons  button and screen clicks
       5. initTouch    the on-screen stick (shown only in touch mode)
       6. initHaptics  short buzzes for danger sounds, where the device can
       7. initFullscreen  fullscreen on the first tap, and the home-screen tip */
  bindRun();
  bindDom();
  bindCards();
  bindHints();
  bindInput();
  bindButtons();
  initTouch();
  initHaptics();
  initFullscreen();
  initPerf();

  /* A handheld plays with the touch layer. One that cannot run it gets the
     notice instead of a title nobody can start; the key handler checks
     isMobileBlocked() so a stray key cannot walk past it. The touch mode set
     here is not locked: a tablet that later gets a key press goes back to kbm. */
  const verdict = mobileVerdict();
  if (verdict === 'blocked') showMobileNotice();
  else if (verdict === 'touch') emit('input:mode', 'touch');

  /* Load saved settings and apply them (difficulty and volume), then build
     the settings controls so they show the loaded values. */
  loadSettings();
  applySettings();
  buildSettingsUI();
  syncSettingsUI();

  /* Audio is built now, at boot, so the title screen has its ambient sound.
     Browsers keep the audio context suspended until the player presses a key
     or clicks.

     Audio is optional. If the browser has no audio support or setup fails,
     the game still starts, just without sound. */
  try {
    Audio_.init();
    syncAmbience();
  } catch (err){
    console.warn('audio unavailable:', err);
  }

  /* Build floor 0 from RUN_SEED. The title screen paints a faded plan of this
     same floor, so the player's first run is the level shown behind the title.
     Reusing one floor means the maze is generated only once. */
  buildFloor(0, RUN_SEED);
  paintSplashPlan();

  /* The loop does not know about rendering, the HUD or the resolution, so all
     three are passed in: `render` draws a frame, `simAlpha` tells the renderer
     how far into the next simulation step the picture is, `adaptive` decides
     whether the machine is keeping up, and `afterUpdate` refreshes the HUD and
     the prompt line after each simulation step. */
  setFrameHooks({ render, simAlpha: setSimAlpha, adaptive: adaptResolution,
                  afterUpdate: ()=>{ updateHUD(); setPrompt(); tickLoudFlash(); tickTouchHud(); } });

  requestAnimationFrame(frame);
}