import { DIFFICULTIES } from '../config/presets.js';
import { SETTINGS, setOption, resetSettings } from '../settings/store.js';
import { SETTINGS_SCHEMA } from '../settings/schema.js';
import { armReset, resetArmed, resetRun } from '../game/run.js';
import { paintTerms, setTermsOpen, termsOpen } from './terms.js';
import { setPausePage } from './pause.js';

/* The buttons for each segmented row (value and label pairs). They are listed
   here and not in the HTML, so the allowed values and their labels cannot
   drift apart. */
export const SEGMENTS = {
  difficulty: () => Object.keys(DIFFICULTIES).map(k => [k, DIFFICULTIES[k].label]),
  waterHue:   () => [['slate','SLATE'],['teal','TEAL'],['violet','VIOLET'],['grey','GREY']],
  flash:      () => [['true','ON'],['false','OFF']],
  touchHud:   () => [['auto','AUTO'],['always','ALWAYS'],['minimal','MINIMAL']],
  touchSide:  () => [['left','LEFT'],['right','RIGHT']],
  haptics:    () => [['true','ON'],['false','OFF']],
  fullscreen: () => [['auto','AUTO'],['off','OFF']],
  sprintPush: () => [['light','LIGHT'],['normal','NORMAL'],['firm','FIRM']],
};

/* Builds and wires the settings controls from the empty rows in index.html.
   Called once at boot. The settings are pages of the pause screen, so there is
   no separate settings screen to return from: ESC steps from the briefing back
   to the settings page. */
export function buildSettingsUI(){
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
  /* keepTerms: this button is on the pause screen of a live run, and the
     difficulty is fixed when the run starts. Resetting it here would change
     the clock and repair time of the floor the player is standing in. */
  if (reset) reset.onclick = ()=>{ resetSettings({keepTerms:true}); syncSettingsUI(); };
  /* The settings page has no BACK button because ESC already does that.
     The briefing page's tabs are the way between the two pages. */
  for (const t of document.querySelectorAll('[data-pause-tab]'))
    t.onclick = ()=> setPausePage(t.dataset.pauseTab);
  // CHANGE opens and closes the difficulty chooser on the work order screen.
  const change = document.getElementById('btn-terms-change');
  if (change) change.onclick = ()=> setTermsOpen(!termsOpen);
  // RESET GAME needs two taps: the first arms it, the second ends the run.
  const resetRunBtn = document.getElementById('btn-reset-run');
  if (resetRunBtn) resetRunBtn.onclick = ()=>{
    if (!resetArmed){ armReset(); return; }
    resetRun();
  };
}

/* Makes every control show the current settings: slider positions, which
   segmented button is pressed, and the difficulty stamps and note. Called after
   any change to the settings. */
export function syncSettingsUI(){
  for (const el of document.querySelectorAll('input[type=range][data-opt]')){
    const v = SETTINGS[el.dataset.opt];
    if (v !== undefined && Number(el.value) !== v) el.value = v;
  }
  for (const row of document.querySelectorAll('.seg[data-opt]')){
    const key = row.dataset.opt, cur = String(SETTINGS[key]);
    for (const b of row.querySelectorAll('button')){
      b.setAttribute('aria-pressed', String(b.dataset.value === cur));
    }
  }
  // The difficulty text in three places is painted from here, so they always match.
  paintTerms();
}