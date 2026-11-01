/* The overlay screens, and the functions that show and hide them.

   Every name in SCREENS has a matching #screen-<name> element in index.html.
   'play' is a state but not a screen: while playing, the canvas and HUD are
   visible and there is nothing to show(). The settings are not a screen
   either; they are a page of the binder. */

/* 'mobile' is not part of the run: it is the desktop-only notice shown instead
   of the title when the device cannot play. It is in the list so show() and
   hideAll() can reach it like any other screen. */
export const SCREENS = ['splash','binder','clear','dead','win','mobile'];

/* The binder is both the clock-in screen (state 'binder') and the pause screen
   (state 'pause'), so both names show the same element. */
const screenOf = name => (name==='pause' ? 'binder' : name);

// Shows one screen and hides all the others.
export function show(which){
  const target = screenOf(which);
  for (const s of SCREENS)
    document.getElementById('screen-'+s).classList.toggle('hidden', s!==target);
}
export function hideAll(){ for (const s of SCREENS)
    document.getElementById('screen-'+s).classList.add('hidden'); }