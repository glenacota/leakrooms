import { SETTINGS, setOption } from '../settings/store.js';
import { Audio_ } from '../audio/index.js';
import { keys, clearInput } from '../sim/keys.js';
import { emit } from '../util/events.js';
import { G } from '../sim/state.js';
import { STATE, dismissClear, retryFloor, runAgain } from '../game/run.js';
import { flash } from './hud.js';
import { setPausePage, togglePause, pausePage } from './pause.js';
import { advanceSplash, backSplash } from './splash.js';
import { setTermsOpen, termsOpen, handleTermsKey } from './terms.js';
import { isMobileBlocked } from './mobile.js';

/* What ENTER does on each screen. It confirms whatever the screen is asking
   for: start, resume, rewind, run again. */
export const MODAL_ACTION = {
  splash: ()=>advanceSplash(),
  order:  ()=>advanceSplash(),
  /* The pause screen has no resume button (ESC resumes), so ENTER calls the
     same toggle directly. Pointing ENTER at a button that is not on screen
     would leave the key doing nothing. */
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

  /* ESC with the difficulty chooser open closes the chooser first. The chooser
     is the top layer of the work order screen, and one mistimed ESC should not
     throw the player back to the title. This must run before backSplash. */
  if (e.key==='Escape' && STATE==='order' && termsOpen){
    setTermsOpen(false);
    return true;
  }

  /* ESC walks back through the title screens: work order to title. On the
     title there is nothing behind it, so it does nothing. */
  if (e.key==='Escape' && backSplash()) return true;

  /* ESC on the pause screen's Briefing page goes back to the Settings page.
     Only the Settings page resumes the run. */
  if (e.key==='Escape' && STATE==='pause' && pausePage!=='settings'){
    setPausePage('settings');
    return true;
  }

  if (k==='enter'){
    const act = MODAL_ACTION[STATE];
    let consumed = false;
    // Auto-repeat is ignored, so holding ENTER cannot rush through the title and start a second run.
    if (act && !e.repeat){
      const focused = document.activeElement;
      const onButton = focused && focused.tagName === 'BUTTON';
      /* ENTER closes the difficulty chooser instead of starting the run. The
         choice is already saved when a term button is clicked, and starting
         from the key that closed the chooser would clock the player in while
         they were still reading. preventDefault stops the browser from also
         pressing the focused button. */
      if (STATE==='order' && termsOpen){
        setTermsOpen(false);
        e.preventDefault();
        return true;
      }
      /* On the pause screen, a focused tab or button handles ENTER itself, so
         the key is left to the browser instead of resuming the run over it. */
      if (STATE==='pause' && onButton
          && focused.closest && focused.closest('#screen-pause')) return false;
      act();
      if (onButton) focused.blur();           // avoids a second activation by the same ENTER
      consumed = true;
    }
    e.preventDefault();
    return consumed;
  }

  /* On the title screen any key advances (once per press, not per auto-repeat).
     Movement keys count too. ESC is excluded because it goes backwards. */
  if (STATE==='splash' && e.key!=='Escape' && !e.repeat){
    advanceSplash();
    if (STATE==='play') e.preventDefault();
    return true;
  }

  /* On the work order screen only ENTER, SPACE, or clicking BEGIN SHIFT starts
     the run. Other keys do nothing and are consumed so they do not carry into
     the run. ESC still goes back. The difficulty chooser acts like a form. */
  if (STATE==='order' && !e.repeat && !termsOpen){
    if (e.key===' '){
      advanceSplash();
      if (STATE==='play') e.preventDefault();
    }
    return e.key!=='Escape';
  }

  /* While the chooser is open it owns the number row and the left and right
     arrows. Every other key is consumed, so it does not walk the player off
     the spawn once the run starts. */
  const chooser = STATE==='order' && termsOpen;
  if (chooser && handleTermsKey(e)) return true;

  if (k==='r') toggleRadar();
  if (e.key==='Escape' && (STATE==='play'||STATE==='pause')){
    togglePause();
    return true;
  }
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)){
    /* One exception: on the pause screen, arrows move a focused slider and
       space presses a focused button, so those keys belong to the screen.
       Everywhere else they are movement, and preventDefault stops the page
       from scrolling. */
    if (STATE==='pause'){
      const el = document.activeElement;
      if (el && el.closest && el.closest('#screen-pause')
          && (el.tagName==='INPUT' || el.tagName==='BUTTON')) return chooser;
    }
    e.preventDefault();
  }
  return chooser;
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
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) lostFocus();
  });
}
