/* The desktop-only notice.

   LEAKROOMS is played with a keyboard and a mouse: every control is a key, and
   there is no touch input anywhere in the game. On a phone the honest thing is
   to say so rather than show a title screen that cannot be started, so the
   riser is swapped for a card that explains it. The card itself is markup in
   index.html; this file only decides when to put it up and keeps the keys from
   walking past it.

   The check is deliberately two-sided. The user agent catches the browsers
   that announce themselves; the pointer media query catches the ones that do
   not, while leaving a touchscreen laptop alone (its primary pointer is the
   mouse). Both halves are read defensively, because this module also loads
   headless, where there is no navigator and no matchMedia. */

import { show } from './dom.js';

/* Handheld user agents. "Mobile" is what most phones send, "Android" without
   it is a tablet, and the rest are the older and the niche ones. */
const HANDHELD = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Opera Mobi|Silk|Mobile/i;

/* The two halves of the check, kept pure so they can be tested without a
   device. */
export function looksHandheld(userAgent){
  return HANDHELD.test(String(userAgent || ''));
}

/* A phone is coarse and not fine. A touchscreen laptop is both, so it is left
   alone: it has a mouse and a keyboard, which is all the game asks for. */
export function coarseWithoutFine(coarse, fine){
  return !!coarse && !fine;
}

function userAgent(){
  try {
    const nav = typeof navigator !== 'undefined' ? navigator
              : (typeof window !== 'undefined' ? window.navigator : null);
    return String((nav && nav.userAgent) || '');
  } catch { return ''; }
}

function pointer(){
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
      return { coarse:false, fine:false };
    return {
      coarse: window.matchMedia('(pointer: coarse)').matches,
      fine:   window.matchMedia('(pointer: fine)').matches,
    };
  } catch { return { coarse:false, fine:false }; }
}

/* True when the game cannot be played here. */
export function isMobileDevice(){
  if (looksHandheld(userAgent())) return true;
  const p = pointer();
  return coarseWithoutFine(p.coarse, p.fine);
}

/* Whether the notice owns the screen. The key handler reads this and does
   nothing, so no key can walk past a card that says the game is desktop-only. */
let blocked = false;
export function isMobileBlocked(){ return blocked; }

/* Swaps the riser for the desktop-only card. Called once, from boot. */
export function showMobileNotice(){
  blocked = true;
  show('mobile');
}
