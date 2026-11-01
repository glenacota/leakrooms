import { SETTINGS, setOption } from '../settings/store.js';
import { Audio_ } from '../audio/index.js';
import { keys, clearInput } from '../sim/keys.js';
import { emit } from '../util/events.js';
import { G } from '../sim/state.js';
import { STATE, dismissClear, retryFloor, runAgain } from '../game/run.js';
import { resize } from '../render/canvas.js';
import { flash } from './hud.js';
import { togglePause } from './pause.js';
import { backSplash, beginShift, activateMenu, moveMenu } from './splash.js';
import { binderTab, stepBinderTab } from './binder.js';
import { handleTermsKey } from './terms.js';
import { isMobileBlocked } from './mobile.js';

/* What ENTER does on each screen. It confirms whatever the screen is asking
   for: start, resume, rewind, run again. */
export const MODAL_ACTION = {
  splash: ()=>activateMenu(),
  binder: ()=>beginShift(),
  pause:  ()=>togglePause(),
  clear:  ()=>dismissClear(),
  dead:   ()=>retryFloor(),
  win:    ()=>runAgain(),
};

/* Game keys are read from e.code (the physical key), and all other keys from
   e.key (the character). WASD is where the movement keys sit on QWERTY,
   QWERTZ and AZERTY keyboards alike, but the character on that key differs
   (it is Z on a French keyboard). Reading e.key would give those players the
   wrong four keys. ESC and ENTER keep using e.key because their names are
   the same on every layout. */
const GAME_CODES = {
  KeyW:'w', KeyA:'a', KeyS:'s', KeyD:'d',
  ArrowUp:'arrowup', ArrowDown:'arrowdown',
  ArrowLeft:'arrowleft', ArrowRight:'arrowright',
  KeyR:'r', KeyM:'m',
};

// The name a key goes by in the held-keys table. Keydown and keyup must agree on it.
const keyOf = e => GAME_CODES[e.code] || e.key.toLowerCase();

/* The radar toggle, pulled out of the key handler so a touch button can call
   the same code. It does nothing outside a live run. */
export function toggleRadar(){
  if (!(G && STATE==='play')) return;
  if (G.radar) G.radar = false;
  else if (G.batt<=0) flash('NO POWER — THE RADAR IS DEAD');
  else { G.radar = true; G.radarRattleT = 0; }
}

/* Acts on one key press and says whether it was consumed. A consumed key was
   used by a screen, so it must not stay held: otherwise the key that dismissed
   a screen would walk the player out of the door they entered by.

   The order of the branches matters, because several of them use the same key
   (ESC and ENTER each mean different things on different screens). Splitting
   them into separate listeners would make the result depend on the order the
   listeners were registered. */
function handleKey(e, k){
  /* M mutes from any screen. A player who wants silence usually wants it
     before the title finishes fading in. It is consumed so the mute key does
     not also advance the title screen, and a held M is not still down when
     the run starts. */
  if (k==='m'){
    if (!e.repeat) toggleMute();
    e.preventDefault();
    return true;
  }

  if (k==='f'){
    if (!e.repeat) toggleFullscreen();
    e.preventDefault();
    return true;
  }

  /* ESC goes one step back: from the binder to the title, and from a pause
     back into the run. It works on every binder tab. On the title there is
     nothing behind it, so it does nothing. */
  if (e.key==='Escape' && backSplash()) return true;

  const inBinder = STATE==='binder' || STATE==='pause';
  const focused = document.activeElement;
  const onButton = !!focused && focused.tagName === 'BUTTON';
  const onSlider = !!focused && focused.tagName === 'INPUT';
  // A button on the binder (not a tab) handles ENTER and SPACE itself.
  const onAction = onButton && !(focused.dataset && focused.dataset.binderTab)
      && !!focused.closest && !!focused.closest('#screen-binder');

  if (k==='enter'){
    const act = MODAL_ACTION[STATE];
    let consumed = false;
    // Auto-repeat is ignored, so holding ENTER cannot rush through the title and start a second run.
    if (act && !e.repeat){
      /* A focused button on the binder handles ENTER itself, so the key is
         left to the browser instead of starting or resuming over it. */
      if (inBinder && onAction) return false;
      act();
      if (onButton) focused.blur();           // avoids a second activation by the same ENTER
      consumed = true;
    }
    e.preventDefault();
    return consumed;
  }

  /* The title is a three-entry menu: up and down select, ENTER or SPACE
     confirms. Other keys are consumed so they do not carry into the run. */
  if (STATE==='splash'){
    if (e.repeat) return true;
    if (e.key==='ArrowUp') moveMenu(-1);
    else if (e.key==='ArrowDown') moveMenu(1);
    else if (e.key===' ') activateMenu();
    e.preventDefault();
    return true;
  }

  /* On the binder, left and right turn the tabs (a focused slider keeps its
     arrows), and the number keys pick terms on the work order page. SPACE
     begins the shift from any shift tab. Other keys are consumed so they do
     not walk the player off the spawn once the run starts. */
  if (STATE==='binder'){
    if (e.repeat) return true;
    if ((e.key==='ArrowLeft' || e.key==='ArrowRight') && !onSlider){
      stepBinderTab(e.key==='ArrowRight' ? 1 : -1);
      e.preventDefault();
    } else if (binderTab==='order' && handleTermsKey(e)){
      // handled
    } else if (e.key===' ' && !onAction){
      beginShift();
      if (STATE==='play') e.preventDefault();
    }
    return true;
  }

  if (k==='r') toggleRadar();
  if (e.key==='Escape' && (STATE==='play'||STATE==='pause')){
    togglePause();
    return true;
  }
  if (STATE==='pause' && (e.key==='ArrowLeft' || e.key==='ArrowRight') && !onSlider){
    stepBinderTab(e.key==='ArrowRight' ? 1 : -1);
    e.preventDefault();
    return false;
  }
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)){
    /* One exception: on the pause screen, arrows move a focused slider and
       space presses a focused button, so those keys belong to the screen.
       Everywhere else they are movement, and preventDefault stops the page
       from scrolling. */
    if (STATE==='pause' && (onSlider || onButton) && focused.closest && focused.closest('#screen-binder')) return false;
    e.preventDefault();
  }
  return false;
}

// The one keydown handler: the guards, then handleKey, then the key is held unless a screen used it.
function onKeyDown(e){
  // Some input methods send a keydown with no character. Ignore those rather than crash.
  if (typeof e.key !== 'string') return;

  /* The desktop-only notice owns the screen. No key can walk past a card that
     says the game is desktop-only. */
  if (isMobileBlocked()) return;

  /* A game key with Ctrl, Cmd or Alt held is a browser or system shortcut
     (Ctrl+R reloads, Cmd+M minimises). The browser handles those itself, so
     the game must not also act on them or hold the key. */
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  /* A real key press means a keyboard is in use, so the touch layer steps
     aside. It only announces; touch.js decides what to do with it. */
  emit('input:mode', 'kbm');

  /* Browsers only start audio after a user gesture. Every key is a gesture,
     and this is the one place the game hears about all of them. */
  Audio_.unlock();

  const k = keyOf(e);
  if (!handleKey(e, k)) keys[k] = true;
}

function onKeyUp(e){
  if (typeof e.key !== 'string') return;
  /* Pressing Meta on a Mac opens the app switcher, and its keyup can arrive
     after the window is back and other keys have already been released.
     Trusting a single keyup could leave the player sprinting forever, so
     losing Meta releases every key. */
  if (e.key==='Meta'){ clearInput(); return; }
  keys[keyOf(e)] = false;
}

/* Toggles mute (the M key). It goes through setOption, so the value is saved
   and the UI updates the same way as any other setting. The confirmation
   blip plays only when unmuting, since a blip while muted could not be heard. */
export function toggleMute(){
  const next = !SETTINGS.muted;
  setOption('muted', next);
  flash(next ? 'AUDIO MUTED' : 'AUDIO ON');
  if (!next) Audio_.blip(true);
}

/* Toggles fullscreen (the F key). iOS has no requestFullscreen, and elsewhere
   the request can be refused with a rejected promise; neither is worth an error. */
export function toggleFullscreen(){
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.()?.catch(()=>{});
  } else {
    document.exitFullscreen?.()?.catch(()=>{});
  }
}

// Attaches the keyboard and focus listeners. Called once from boot().
export function bindInput(){
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  /* Losing the window (switching tabs or apps) means two things: no more key
     releases will arrive, and nobody is watching the run. So release every
     key, and pause so the clock does not run out in the background. */
  const lostFocus = () => {
    clearInput();
    /* The touch layer tracks its own fingers, and clearInput cannot reach them. */
    emit('input:lost');
    if (STATE==='play') togglePause();
  };
  window.addEventListener('blur', lostFocus);
  window.addEventListener('pagehide', lostFocus);

  /* Restored from the back/forward cache: the canvas size can be stale, so
     resize it. The run stays paused and audio is not resumed here — a gesture
     is required, and the next tap already calls unlock(). */
  window.addEventListener('pageshow', e => {
    if (e.persisted) resize();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) lostFocus();
  });
}
