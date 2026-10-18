/* The composition root. Everything the game is, is imported here; nothing in the
   tree imports this back. `boot()` is the single entry point the browser and the
   test harness both call, and the order inside it is the order the game was
   always initialised in — changing it is a behaviour change, not a tidy. */
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
import { setFrameHooks } from './game/loop.js';
import { render } from './render/render.js';
import { updateHUD, setPrompt } from './ui/hud.js';
import { frame } from './game/loop.js';

export function boot(){
  resize();
  buildPatterns();
  buildGlowSprite();

  /* WIRING. Nothing above this point has registered a listener or a subscriber,
     so the resize above is the resize there has always been: one with nobody
     listening. After it, in this order — the run answers the simulation's four
     facts, the DOM side of the bus turns facts into pixels, the input and the
     buttons attach to the document — and only then does the store load. */
  bindRun();
  bindDom();
  bindInput();
  bindButtons();

  loadSettings();
  applySettings();
  /* The loop owns the frame; the shell owns the drawing and the HUD refresh, so
     both are handed in rather than imported. */
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
  setFrameHooks({ render, afterUpdate: ()=>{ updateHUD(); setPrompt(); } });

  requestAnimationFrame(frame);
}
