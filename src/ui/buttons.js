import { dismissClear, retryFloor, runAgain, STATE, armReset, resetArmed, resetRun } from '../game/run.js';
import { activateMenu, beginShift } from './splash.js';
import { togglePause } from './pause.js';
import { setBinderTab } from './binder.js';
import { toggleFullscreen, dismissHint } from './fullscreen.js';
import { resetSettings } from '../settings/store.js';
import { syncSettingsUI } from './settings-panel.js';

/* Attaches the buttons and screen clicks to the run functions that do the
   work. This function is the only place where that wiring happens. Adding the
   same listener twice is not harmless: one click on the title screen would
   advance twice and skip the work order. */
export function bindButtons(){
  document.getElementById('btn-start').onclick   = ()=>beginShift();
  document.getElementById('btn-descend').onclick = ()=>dismissClear();
  document.getElementById('btn-retry').onclick   = ()=>retryFloor();
  document.getElementById('btn-again').onclick   = ()=>runAgain();
  /* The pause screen's way back into the run for a player with no ESC key.
     It only acts on the pause screen: togglePause() would also START a pause
     from play, which a RESUME button must never do. */
  document.getElementById('btn-resume').onclick  = ()=>{ if (STATE==='pause') togglePause(); };

  /* The fullscreen button and the tip's dismiss buttons. Both are touch-only
     and both act on click, which is the gesture fullscreen needs. */
  document.getElementById('btn-fullscreen').onclick = ()=>{ toggleFullscreen(); };
  for (const id of ['btn-hint-title','btn-hint-pause'])
    document.getElementById(id).onclick = ()=>dismissHint();

  /* The title menu buttons open the binder. A click on the title background
     does nothing: the menu is the only way in. */
  for (const el of document.querySelectorAll('[data-menu]'))
    el.onclick = ()=> activateMenu(el.dataset.menu);

  const resetSettingsBtn = document.getElementById('btn-settings-reset');
  if (resetSettingsBtn) resetSettingsBtn.onclick = ()=>{ resetSettings({keepTerms:true}); syncSettingsUI(); };
  for (const tab of document.querySelectorAll('[data-binder-tab]'))
    tab.onclick = ()=> setBinderTab(tab.dataset.binderTab);
  const resetRunBtn = document.getElementById('btn-reset-run');
  if (resetRunBtn) resetRunBtn.onclick = ()=>{
    if (!resetArmed){ armReset(); return; }
    resetRun();
  };
}