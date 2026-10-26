import { dismissClear, retryFloor, runAgain, startRun, STATE, armReset, resetArmed, resetRun } from '../game/run.js';
import { advanceSplash } from './splash.js';
import { togglePause, setPausePage } from './pause.js';
import { setTermsOpen, termsOpen } from './terms.js';
import { resetSettings } from '../settings/store.js';
import { syncSettingsUI } from './settings-panel.js';

/* Attaches the buttons and screen clicks to the run functions that do the
   work. This function is the only place where that wiring happens. Adding the
   same listener twice is not harmless: one click on the title screen would
   advance twice and skip the work order. */
export function bindButtons(){
  document.getElementById('btn-start').onclick   = ()=>startRun();
  document.getElementById('btn-descend').onclick = ()=>dismissClear();
  document.getElementById('btn-retry').onclick   = ()=>retryFloor();
  document.getElementById('btn-again').onclick   = ()=>runAgain();
  /* The pause screen's way back into the run for a player with no ESC key.
     It only acts on the pause screen: togglePause() would also START a pause
     from play, which a RESUME button must never do. */
  document.getElementById('btn-resume').onclick  = ()=>{ if (STATE==='pause') togglePause(); };

  /* Clicking the BEGIN SHIFT button on the work order screen starts the run.
     Clicking anywhere else on the title or work order screen does nothing.
     Clicking on a control (button, slider, difficulty chooser) is a choice and
     not an advance. While the difficulty chooser is open, a click on the
     background closes it, the same as ESC. */
  for (const id of ['screen-splash','screen-order']){
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', (e)=>{
      if (e.target.closest && e.target.closest('button, input, .terms-fold')) return;
      if (STATE==='order' && termsOpen){ setTermsOpen(false); return; }
      if (STATE==='splash') advanceSplash();
    });
  }
  const resetSettingsBtn = document.getElementById('btn-settings-reset');
  if (resetSettingsBtn) resetSettingsBtn.onclick = ()=>{ resetSettings({keepTerms:true}); syncSettingsUI(); };
  for (const tab of document.querySelectorAll('[data-pause-tab]'))
    tab.onclick = ()=> setPausePage(tab.dataset.pauseTab);
  const change = document.getElementById('btn-terms-change');
  if (change) change.onclick = ()=> setTermsOpen(!termsOpen);
  const resetRunBtn = document.getElementById('btn-reset-run');
  if (resetRunBtn) resetRunBtn.onclick = ()=>{
    if (!resetArmed){ armReset(); return; }
    resetRun();
  };
}