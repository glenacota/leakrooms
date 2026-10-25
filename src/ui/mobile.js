/* The handheld gate.

   LEAKROOMS plays with a keyboard or, on a handheld, with the touch layer
   (ui/touch.js). A handheld that cannot run that layer is stopped here with a
   card that explains it, rather than shown a title it cannot start. The card
   itself is markup in index.html; this file decides when to put it up and keeps
   the keys from walking past it.

   Telling a handheld apart is deliberately two-sided. The user agent catches the browsers
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

/* True when the device is a handheld. Whether it can PLAY is mobileVerdict(). */
export function isMobileDevice(){
  if (looksHandheld(userAgent())) return true;
  const p = pointer();
  return coarseWithoutFine(p.coarse, p.fine);
}

/* The decision, kept pure so every case can be tested. A handheld can play when
   the touch layer can work: Pointer Events exist and the primary pointer is
   coarse. A handheld without them has no way to move, so it gets the notice.
   A machine with a mouse and a keyboard is never stopped, including a tablet with
   a keyboard attached (coarse AND fine, so it is not a handheld here).
     'desktop'  play with the keyboard
     'touch'    play with the touch layer
     'blocked'  show the notice */
export function gateVerdict(ua, hasPointerEvent, coarse, fine){
  const handheld = looksHandheld(ua) || coarseWithoutFine(coarse, fine);
  if (!handheld) return 'desktop';
  return hasPointerEvent && coarse ? 'touch' : 'blocked';
}

export function mobileVerdict(){
  const p = pointer();
  const hasPE = typeof window !== 'undefined' && typeof window.PointerEvent === 'function';
  return gateVerdict(userAgent(), hasPE, p.coarse, p.fine);
}

/* Whether the notice owns the screen. The key handler reads this and does
   nothing, so no key can walk past the card. */
let blocked = false;
export function isMobileBlocked(){ return blocked; }

/* Swaps the riser for the notice. Called once, from boot, for a handheld that
   cannot run the touch layer. */
export function showMobileNotice(){
  blocked = true;
  show('mobile');
}
