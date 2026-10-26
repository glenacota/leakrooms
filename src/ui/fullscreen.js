/* ============================================================
   FULLSCREEN
   On a phone the browser bars eat a fifth of a landscape screen. This asks the
   browser to hide them, and nothing more: it never fails loudly, because on
   some devices (iPhone Safari above all) the page cannot go fullscreen at all.
   There the Add-to-Home-Screen hint takes its place.

   Two rules decide how this file is written:
     - requestFullscreen needs a user gesture. It is called from a click handler
       and from nowhere else (never pointerdown, a timer or page load).
     - nothing here may throw. Every browser piece is optional, so every call
       is guarded, and the logic is split into pure functions that take an
       `env` object ({ doc, win, nav }) so a test can hand it a fake one.
   ============================================================ */
import { STATE } from '../game/run.js';
import { SETTINGS } from '../settings/store.js';
import { togglePause } from './pause.js';

/* The real browser pieces, read when asked so a missing global is never a
   ReferenceError. */
export function realEnv(){
  return {
    doc: typeof document  !== 'undefined' ? document  : undefined,
    win: typeof window    !== 'undefined' ? window    : undefined,
    nav: typeof navigator !== 'undefined' ? navigator : undefined,
  };
}

const rootOf = env => (env && env.doc && env.doc.documentElement) || null;
const requestOf = root => root && (root.requestFullscreen || root.webkitRequestFullscreen);

/* ---------- pure answers ---------- */

/* True if the page can ask for fullscreen: the browser says it is allowed AND
   the element has the method. Prefixed (webkit) names count. An iPhone has
   neither, which is the case this exists to tell apart. */
export function fullscreenSupported(env){
  try {
    const doc = env && env.doc;
    if (!doc) return false;
    const enabled = !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
    return enabled && typeof requestOf(rootOf(env)) === 'function';
  } catch { return false; }
}

export function isFullscreen(env){
  try {
    const doc = env && env.doc;
    return !!(doc && (doc.fullscreenElement || doc.webkitFullscreenElement));
  } catch { return false; }
}

/* Running from the home screen: already without browser bars. */
export function isStandalone(env){
  try {
    if (env && env.nav && env.nav.standalone === true) return true;
    const win = env && env.win;
    if (win && typeof win.matchMedia === 'function'){
      for (const q of ['(display-mode: standalone)', '(display-mode: fullscreen)'])
        if (win.matchMedia(q).matches) return true;
    }
  } catch { /* unknown: not standalone */ }
  return false;
}

/* Whether the first tap on the title should ask for fullscreen. Every
   condition has to hold; any one of them stops it. */
export function shouldAutoEnter({ setting, touch, supported, active, standalone, exitedByUser, alreadyTried }){
  return setting === 'auto' && !!touch && !!supported
      && !active && !standalone && !exitedByUser && !alreadyTried;
}

/* The tip about adding the game to the home screen. It is for the phones that
   cannot go fullscreen (iPhone), and only until it is dismissed or the game is
   already running from the home screen. */
export function needsHomeScreenHint({ ua, standalone, supported, dismissed }){
  return /iPhone|iPad|iPod/i.test(String(ua || '')) && !standalone && !supported && !dismissed;
}

/* ---------- doing it ---------- */

/* Asks for fullscreen. The request is made before the first await, so it runs
   inside the click that called this and keeps the user gesture. Resolves true
   if the browser agreed, false for every other outcome; never rejects. */
export async function enterFullscreen(env){
  try {
    if (!fullscreenSupported(env)) return false;
    const root = rootOf(env);
    await requestOf(root).call(root);
    try {
      const o = env.win && env.win.screen && env.win.screen.orientation;
      if (o && typeof o.lock === 'function') await o.lock('landscape');
    } catch { /* the lock is a bonus: desktops and some phones refuse it */ }
    return true;
  } catch { return false; }
}

export async function exitFullscreen(env){
  try {
    const doc = env && env.doc;
    const fn = doc && (doc.exitFullscreen || doc.webkitExitFullscreen);
    if (typeof fn !== 'function') return false;
    await fn.call(doc);
    return true;
  } catch { return false; }
}

export function toggleFullscreen(env = realEnv()){
  return isFullscreen(env) ? exitFullscreen(env) : enterFullscreen(env);
}

/* ---------- the tip's memory ----------
   Its own key, and not a setting: RESET SETTINGS must not bring it back. Storage
   can be missing or throw (private browsing), so the answer is also kept in
   memory for the rest of the session. */
export const HINT_KEY = 'leakrooms.hint.v1';
let hintGone = false;

function storageOf(env){
  return (env && env.win && env.win.localStorage) || globalThis.localStorage;
}
export function hintDismissed(env = realEnv()){
  if (hintGone) return true;
  try {
    const raw = storageOf(env).getItem(HINT_KEY);
    return !!raw && JSON.parse(raw).homeScreen === true;
  } catch { return false; }
}
export function dismissHint(env = realEnv()){
  hintGone = true;
  try { storageOf(env).setItem(HINT_KEY, JSON.stringify({ homeScreen: true })); } catch { /* memory only */ }
  if (bound) bound.paintHint();
}

/* ---------- wiring ---------- */

let bound = null;

/* Called once from boot(). `deps` is for tests: the state, the pause call and
   the setting come from the game unless a test hands in others. Returns the
   handlers it attached so a test can drive them. */
export function initFullscreen(env = realEnv(), deps = {}){
  const doc = env && env.doc;
  const getState   = deps.getState   || (() => STATE);
  const pause      = deps.pause      || togglePause;
  const getSetting = deps.getSetting || (() => SETTINGS.fullscreen);
  const root = () => rootOf(env);
  const isTouch = () => !!(root() && root().dataset && root().dataset.input === 'touch');
  const flags = { exitedByUser: false, alreadyTried: false };
  const byId = id => (doc && doc.getElementById ? doc.getElementById(id) : null);

  const paintFs = () => {
    const state = !fullscreenSupported(env) ? 'unsupported' : (isFullscreen(env) ? 'on' : 'off');
    if (root() && root().dataset) root().dataset.fs = state;
    const b = byId('btn-fullscreen');
    if (b) b.textContent = state === 'on' ? 'EXIT FULLSCREEN' : 'ENTER FULLSCREEN';
    return state;
  };

  const paintHint = () => {
    const show = needsHomeScreenHint({
      ua: env && env.nav && env.nav.userAgent,
      standalone: isStandalone(env),
      supported: fullscreenSupported(env),
      dismissed: hintDismissed(env),
    });
    if (doc && doc.querySelectorAll)
      for (const h of doc.querySelectorAll('.fs-hint')) h.hidden = !show;
    return show;
  };

  /* A click on the title or the work order screen. This is a second listener,
     next to the one in buttons.js that advances the screens. */
  const onScreenClick = () => {
    const ok = shouldAutoEnter({
      setting: getSetting(), touch: isTouch(), supported: fullscreenSupported(env),
      active: isFullscreen(env), standalone: isStandalone(env), ...flags,
    });
    if (!ok) return false;
    flags.alreadyTried = true;
    enterFullscreen(env);            // called here, inside the click, on purpose
    return true;
  };

  const onChange = () => {
    const state = paintFs();
    if (state === 'on') return;
    flags.exitedByUser = true;
    /* Leaving fullscreen mid-run (a swipe, the back gesture, a notification)
       must not leave a live stealth game running behind the bars. */
    if (getState() === 'play') pause();
  };

  if (doc && doc.addEventListener){
    doc.addEventListener('fullscreenchange', onChange);
    doc.addEventListener('webkitfullscreenchange', onChange);
  }
  for (const id of ['screen-splash', 'screen-order']){
    const el = byId(id);
    if (el && el.addEventListener) el.addEventListener('click', onScreenClick);
  }

  paintFs();
  paintHint();
  bound = { paintHint };
  return { onScreenClick, onChange, paintHint, flags };
}
