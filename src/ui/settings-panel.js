import { DIFFICULTIES } from '../config/presets.js';
import { SETTINGS, setOption } from '../settings/store.js';
import { SETTINGS_SCHEMA } from '../settings/schema.js';
import { paintTerms } from './terms.js';

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