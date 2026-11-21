/* The overlay screens, and the functions that show and hide them.

   Every name in SCREENS has a matching #screen-<name> element in index.html.
   Runtime states map to screen identities in bind.js. The settings are not a
   screen; they are a page of the binder. */

/* 'mobile' is a device notice, not a run state. */
export const SCREENS = ['splash','binder','clear','dead','win','mobile'];

/** Shows one known screen and hides all others. @param {string} screenId */
export function showScreen(screenId){
  if (!SCREENS.includes(screenId)) throw new RangeError(`Unknown screen: ${screenId}`);
  for (const s of SCREENS)
    document.getElementById('screen-'+s).classList.toggle('hidden', s!==screenId);
  const footer = document.getElementById('page-footer');
  if (footer){
    footer.classList.remove('hidden');
    footer.classList.toggle('screen-footer--splash', screenId === 'splash');
  }
}
export function hideScreens(){
  for (const s of SCREENS)
    document.getElementById('screen-'+s).classList.add('hidden');
  const footer = document.getElementById('page-footer');
  if (footer) footer.classList.add('hidden');
}