/* The screens, and the one function that shows them. Every entry in SCREENS has
   a #screen-<name> div; 'play' is a STATE but not a screen, because the run is
   the canvas with the HUD on it and there is nothing to show(). */
/* Every screen the shell can show, in one list, because show()/hideAll() all
   enumerate them and they used to drift apart the moment a screen was added.
   The settings had a screen in this list once; they are pages of the pause
   ticket now, so the ticket is the only menu and there is no second list.
   Every entry has a #screen-<name> div — 'play' is a STATE but not a screen,
   because the run is the canvas with the HUD on it and nothing to show(). */
export const SCREENS = ['splash','order','clear','pause','dead','win'];

export function show(which){
  for (const s of SCREENS)
    document.getElementById('screen-'+s).classList.toggle('hidden', s!==which);
}
export function hideAll(){ for (const s of SCREENS)
    document.getElementById('screen-'+s).classList.add('hidden'); }
