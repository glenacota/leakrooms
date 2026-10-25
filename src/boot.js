/* The composition root: the one place where the whole game is put together.

   boot() creates the canvas and textures, connects the modules to each other,
   loads saved settings, builds the first floor, and starts the game loop.
   The browser and the test harness both call it.

   Rule: nothing else in src/ may import this file. The order of the steps
   inside boot() matters, so changing it can change how the game behaves. */
import { resize } from './render/canvas.js';
import { buildPatterns } from './render/textures.js';
import { buildGlowSprite } from './render/render.js';
import { applySettings, tickLoudFlash } from './ui/bind.js';
import { buildSettingsUI, syncSettingsUI } from './ui/settings-panel.js';
import { Audio_ } from './audio/index.js';
import { syncAmbience } from './ui/splash.js';
import { buildFloor } from './game/floor.js';
import { paintSplashPlan } from './render/splash-plan.js';
import { bindRun } from './game/run.js';
import { bindDom } from './ui/bind.js';
import { bindInput } from './ui/input.js';
import { bindButtons } from './ui/buttons.js';
import { initTouch } from './ui/touch.js';
import { initHaptics } from './ui/haptics.js';
import { isMobileDevice, showMobileNotice } from './ui/mobile.js';
import { setFatalHook, setFrameHooks } from './game/loop.js';
import { adaptResolution } from './render/adaptive.js';
import { render, setSimAlpha } from './render/render.js';
import { updateHUD, setPrompt, hudFlag } from './ui/hud.js';
import { buildHudSnap, hudVisibility } from './ui/touch-hud-rules.js';
import { loadSettings, SETTINGS } from './settings/store.js';
import { G } from './sim/state.js';
import { RUN_SEED, lives } from './game/run.js';
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

/* The HUD panel fades in touch mode when nothing needs reading (the rule is
   ui/touch-hud-rules.js). One class on the panel, flipped only when the answer
   changes. In keyboard mode the class is always off. */
let hudPanel = null;
let hudPrev = null;
function applyTouchHud(){
  if (!hudPanel) hudPanel = document.querySelector('.crt-tl');
  const touch = document.documentElement && document.documentElement.dataset.input === 'touch';
  if (!touch || !G){ hudFlag(hudPanel, 'touchQuiet', 'hud-quiet', false); return; }
  const now = performance.now();
  const snap = buildHudSnap(G, lives, now);
  const r = hudVisibility(snap, hudPrev, now, SETTINGS.touchHud);
  hudPrev = { lives: snap.lives, lastTriggerMs: r.lastTriggerMs };
  hudFlag(hudPanel, 'touchQuiet', 'hud-quiet', !r.visible);
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
       4. bindButtons  button and screen clicks
       5. initTouch    the on-screen stick (shown only in touch mode)
       6. initHaptics  short buzzes for danger sounds, where the device can */
  bindRun();
  bindDom();
  bindInput();
  bindButtons();
  initTouch();
  initHaptics();

  /* A phone cannot play a keyboard game. Rather than show a title screen that
     nobody can start, swap in the desktop-only card. The key handler checks
     isMobileBlocked() so a stray key cannot walk past it. */
  if (isMobileDevice()) showMobileNotice();

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

  /* The loop does not know about rendering, the HUD or the resolution, so all
     three are passed in: `render` draws a frame, `simAlpha` tells the renderer
     how far into the next simulation step the picture is, `adaptive` decides
     whether the machine is keeping up, and `afterUpdate` refreshes the HUD and
     the prompt line after each simulation step. */
  setFrameHooks({ render, simAlpha: setSimAlpha, adaptive: adaptResolution,
                  afterUpdate: ()=>{ updateHUD(); setPrompt(); tickLoudFlash(); applyTouchHud(); } });

  requestAnimationFrame(frame);
}