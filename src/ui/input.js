import { DIFFICULTIES } from '../config/presets.js';
import { SETTINGS, setOption } from '../settings/store.js';
import { Audio_ } from '../audio/index.js';
import { keys } from '../sim/keys.js';
import { G } from '../sim/state.js';
import { STATE, dismissClear } from '../game/run.js';
import { flash } from './hud.js';
import { setPausePage, togglePause, pausePage } from './pause.js';
import { advanceSplash, backSplash } from './splash.js';
import { setTermsOpen, termsOpen } from './terms.js';

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
  dead:   ()=>document.getElementById('btn-retry').click(),
  win:    ()=>document.getElementById('btn-again').click(),
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

/* Releases every held key. Used when the window loses focus: the browser stops
   sending keyup events to a window that is not focused, so a held key would
   otherwise stay held forever. */
function clearKeys(){
  for (const k in keys) delete keys[k];
}

/* The one keydown handler. The order of the branches matters, because several
   of them use the same key (ESC and ENTER each mean different things on
   different screens). Splitting them into separate listeners would make the
   result depend on the order the listeners were registered. */
function onKeyDown(e){
  // Some input methods send a keydown with no character. Ignore those rather than crash.
  if (typeof e.key !== 'string') return;

  /* A game key with Ctrl, Cmd or Alt held is a browser or system shortcut
     (Ctrl+R reloads, Cmd+M minimises). The browser handles those itself, so
     the game must not also act on them or hold the key. */
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const k = GAME_CODES[e.code] || e.key.toLowerCase();
  keys[k] = true;

  /* Browsers only start audio after a user gesture. Every key is a gesture,
     and this is the one place the game hears about all of them. */
  Audio_.unlock();

  /* M mutes from any screen. A player who wants silence usually wants it
     before the title finishes fading in. It returns right away so the mute
     key does not also advance the title screen, and it drops the key state so
     a held M is not still down when the run starts. */
  if (k==='m'){
    if (!e.repeat) toggleMute();
    delete keys[k];
    e.preventDefault();
    return;
  }

  /* ESC with the difficulty chooser open closes the chooser first. The chooser
     is the top layer of the work order screen, and one mistimed ESC should not
     throw the player back to the title. This must run before backSplash. */
  if (e.key==='Escape' && STATE==='order' && termsOpen){
    setTermsOpen(false);
    delete keys[k];
    return;
  }

  /* ESC walks back through the title screens: work order to title. On the
     title there is nothing behind it, so it does nothing. */
  if (e.key==='Escape'){
    if (backSplash()){ delete keys[k]; return; }
  }

  /* ESC on the pause screen's Briefing page goes back to the Settings page.
     Only the Settings page resumes the run. */
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
        delete keys[k];
        e.preventDefault();
        return;
      }
      /* On the pause screen, a focused tab or button handles ENTER itself, so
         the key is left to the browser instead of resuming the run over it. */
      if (STATE==='pause' && onButton
          && focused.closest && focused.closest('#screen-pause')) return;
      act();
      if (onButton) focused.blur();           // avoids a second activation by the same ENTER
      // The key that dismissed a screen must not stay held, or the player walks out of the door they entered by.
      delete keys[k];
    }
    e.preventDefault();
    return;
  }

  /* On the title and work order screens any key advances (once per press, not
     per auto-repeat). Movement keys count too, and are dropped so they do not
     carry into the run. ESC is excluded because it goes backwards. While the
     difficulty chooser is open the screen acts like a form, and a stray key
     must not start a run. */
  if ((STATE==='splash'||STATE==='order') && e.key!=='Escape'
      && !e.repeat
      && !(STATE==='order' && termsOpen)){
    advanceSplash();
    delete keys[k];
    if (STATE==='play') e.preventDefault();
    return;
  }

  // A key the open chooser ignores is dropped, so it does not walk the player off the spawn once the run starts.
  if (STATE==='order' && termsOpen) delete keys[k];

  /* While the chooser is open it owns the number row and left/right arrows:
     1-3 pick the three difficulties (in DIFFICULTIES order), and the arrows
     cycle through them like clicking the buttons. */
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
    /* One exception: on the pause screen, arrows move a focused slider and
       space presses a focused button, so those keys belong to the screen.
       Everywhere else they are movement, and preventDefault stops the page
       from scrolling. */
    if (STATE==='pause'){
      const el = document.activeElement;
      if (el && el.closest && el.closest('#screen-pause')
          && (el.tagName==='INPUT' || el.tagName==='BUTTON')) return;
    }
    e.preventDefault();
  }
}

function onKeyUp(e){
  if (typeof e.key !== 'string') return;
  /* Pressing Meta on a Mac opens the app switcher, and its keyup can arrive
     after the window is back and other keys have already been released.
     Trusting a single keyup could leave the player sprinting forever, so
     losing Meta releases every key. */
  if (e.key==='Meta'){ clearKeys(); return; }
  const k = GAME_CODES[e.code] || e.key.toLowerCase();
  keys[k] = false;
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

// Attaches the keyboard and focus listeners. Called once from boot().
export function bindInput(){
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  /* Losing the window (switching tabs or apps) means two things: no more key
     releases will arrive, and nobody is watching the run. So release every
     key, and pause so the clock does not run out in the background. */
  const lostFocus = () => {
    clearKeys();
    if (STATE==='play') togglePause();
  };
  window.addEventListener('blur', lostFocus);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) lostFocus();
  });
}