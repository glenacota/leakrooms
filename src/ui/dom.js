/* The overlay screens, and the functions that show and hide them.

   Every name in SCREENS has a matching #screen-<name> element in index.html.
   'play' is a state but not a screen: while playing, the canvas and HUD are
   visible and there is nothing to show(). The settings are not a screen
   either; they are a page of the pause screen. */

export const SCREENS = ['splash','order','clear','pause','dead','win'];

// Shows one screen and hides all the others.
export function show(which){
  for (const s of SCREENS)
    document.getElementById('screen-'+s).classList.toggle('hidden', s!==which);
}
export function hideAll(){ for (const s of SCREENS)
    document.getElementById('screen-'+s).classList.add('hidden'); }