/* The composition root: the one place where the whole game is put together.

   boot() creates the canvas and textures, connects the modules to each other,
   loads saved settings, builds the first floor, and starts the game loop.
   The browser and the test harness both call it.

   Rule: nothing else in src/ may import this file. The order of the steps
   inside boot() matters, so changing it can change how the game behaves. */
import { resize } from './render/canvas.js';
import { buildPatterns } from './render/textures.js';
import { buildGlowSprite } from './render/render.js';
import { loadSettings } from './settings/store.js';
import { applySettings } from './ui/bind.js';
import { buildSettingsUI, syncSettingsUI } from './ui/settings-panel.js';
import { Audio_ } from './audio/index.js';
import { syncAmbience } from './ui/splash.js';
import { buildFloor } from './game/floor.js';
import { RUN_SEED } from './game/run.js';
import { paintSplashPlan } from './render/splash-plan.js';
import { bindRun } from './game/run.js';
import { bindDom } from './ui/bind.js';
import { bindInput } from './ui/input.js';
import { bindButtons } from './ui/buttons.js';
import { setFatalHook, setFrameHooks } from './game/loop.js';
import { render } from './render/render.js';
import { updateHUD, setPrompt } from './ui/hud.js';
import { frame } from './game/loop.js';

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

  /* Size the canvas and build the drawing resources. No listeners are
     connected yet, so this first resize() does not trigger any redraw work. */
  resize();
  buildPatterns();
  buildGlowSprite();

  /* Connect the modules to each other through the event bus and the DOM.
     The order is:
       1. bindRun      the run reacts to what the simulation reports
       2. bindDom      events are turned into on-screen changes
       3. bindInput    keyboard handling
       4. bindButtons  button and screen clicks */
  bindRun();
  bindDom();
  bindInput();
  bindButtons();

  /* Load saved settings and apply them (difficulty and volume), then build
     the settings controls so they show the loaded values. */
  loadSettings();
  applySettings();
  buildSettingsUI();
  syncSettingsUI();

  /* Audio is built now, at boot, so the title screen has its ambient sound.
     Browsers keep the audio context suspended until the player presses a key
     or clicks; Audio_.unlock() is called from the key handler and from
     advanceSplash() to resume it.

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

  /* The loop does not know about rendering or the HUD, so both are passed in:
     `render` draws a frame, and `afterUpdate` refreshes the HUD and the
     prompt line after each simulation step. */
  setFrameHooks({ render, afterUpdate: ()=>{ updateHUD(); setPrompt(); } });

  requestAnimationFrame(frame);
}