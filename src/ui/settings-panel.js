import { DIFFICULTIES } from '../config/presets.js';
import { SETTINGS, setOption, saveSettings, resetSettings } from '../settings/store.js';
import { SETTINGS_SCHEMA } from '../settings/schema.js';
import { armReset, resetArmed, resetRun } from '../game/run.js';
import { paintTerms, setTermsOpen, termsOpen } from './terms.js';
import { setPausePage } from './pause.js';

/* Button label sets per segmented row. Declared here rather than in markup so
   the enum and the labels cannot drift apart. */
export const SEGMENTS = {
  difficulty: () => Object.keys(DIFFICULTIES).map(k => [k, DIFFICULTIES[k].label]),
  waterHue:   () => [['slate','SLATE'],['teal','TEAL'],['violet','VIOLET'],['grey','GREY']],
};

export function buildSettingsUI(){
  /* The controls used to live in a modal they shared with a BACK button, and
     the return path was state juggling: remember where you were, swap STATE,
     map it back on the way out. Now the ticket's pages ARE the menu, so the
     return path is one line: the tab that is not pressed. Escape out of the
     briefing page cannot strand the player anywhere, because there is only
     ever the ticket. */
  for (const row of document.querySelectorAll('.seg[data-opt]')){
    const key = row.dataset.opt;
    const opts = (SEGMENTS[key] || (()=>[]))();
    row.innerHTML = '';
    for (const [val,label] of opts){
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.value = String(val);
      b.onclick = ()=> setOption(key, SETTINGS_SCHEMA[key].type === 'enum' ? val : (val==='true'));
      row.appendChild(b);
    }
  }
  for (const el of document.querySelectorAll('input[type=range][data-opt]')){
    const key = el.dataset.opt;
    el.addEventListener('input', ()=> setOption(key, parseFloat(el.value)));
  }
  const reset = document.getElementById('btn-settings-reset');
  /* keepTerms: this button is on the ticket of a LIVE run, and the terms are
     stamped at the door rather than chosen here. Resetting the terms from here
     rewrote the clock and the repair time of the floor the player is standing
     in. The stamp owns difficulty; the ticket owns everything else. */
  if (reset) reset.onclick = ()=>{ resetSettings({keepTerms:true}); syncSettingsUI(); };
  /* No BACK on the settings page: it is the page a pause lands on, so BACK
     would mean ESC, and a second control that does what the key under the
     player's hand already does is a control nobody needs. The briefing's BACK
     is different — it goes somewhere, back to the settings page. */
  for (const t of document.querySelectorAll('[data-pause-tab]'))
    t.onclick = ()=> setPausePage(t.dataset.pauseTab);
  /* The terms chooser: the front door. CHANGE folds it out of the stamp on
     the work order; the segmented row inside it is built by the loop above,
     exactly as it was when it was a settings row. */
  const change = document.getElementById('btn-terms-change');
  if (change) change.onclick = ()=> setTermsOpen(!termsOpen);
  /* RESET GAME: arm on the first press, fire on the second. */
  const resetRunBtn = document.getElementById('btn-reset-run');
  if (resetRunBtn) resetRunBtn.onclick = ()=>{
    if (!resetArmed){ armReset(); return; }
    resetRun();
  };
}

export function syncSettingsUI(){
  // sliders
  for (const el of document.querySelectorAll('input[type=range][data-opt]')){
    const v = SETTINGS[el.dataset.opt];
    if (v !== undefined && Number(el.value) !== v) el.value = v;
  }
  // segmented buttons
  for (const row of document.querySelectorAll('.seg[data-opt]')){
    const key = row.dataset.opt, cur = String(SETTINGS[key]);
    for (const b of row.querySelectorAll('button')){
      b.setAttribute('aria-pressed', String(b.dataset.value === cur));
    }
  }
  /* The stamp on the work order, on its stub, and on the pause stub are the
     same fact as the segmented row, so they are painted from the same place
     the row is synced — one writer, three stamps, the note line. */
  paintTerms();
}
