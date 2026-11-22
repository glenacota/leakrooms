import { DIFFICULTIES } from '../config/presets.js';
import { applyDifficulty } from '../config/tuning.js';
import { SETTINGS, setOption, currentTerms } from '../settings/store.js';
import { SETTINGS_SCHEMA } from '../settings/schema.js';
import { emit, on, EVENT } from '../util/events.js';
import { repaintDirty } from '../util/repaint.js';
import { G } from '../sim/state.js';
import { Audio_ } from '../audio/index.js';
import { paintTerms } from './terms.js';
import { tutorialReplayState, resetTutorialReplayStatus } from './tutorials.js';

export { resetTutorialReplayStatus };

/* The buttons for each segmented row (value and label pairs). They are listed
   here and not in the HTML, so the allowed values and their labels cannot
   drift apart. */
export const SEGMENTS = {
  difficulty: () => Object.keys(DIFFICULTIES).map(k => [k, DIFFICULTIES[k].label]),
  waterHue:   () => [['slate','SLATE'],['teal','TEAL'],['violet','VIOLET'],['grey','GREY']],
  flash:      () => [['true','ON'],['false','OFF']],
  tutorials:    () => [['true','ON'],['false','OFF']],
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
      b.className = 'btn btn--ghost btn--compact touch-target';
      b.onclick = ()=> setOption(key, SETTINGS_SCHEMA[key].type === 'enum' ? val : (val==='true'));
      row.appendChild(b);
    }
  }
  for (const el of document.querySelectorAll('input[type=range][data-opt]')){
    const key = el.dataset.opt;
    el.addEventListener('input', ()=> setOption(key, parseFloat(el.value)));
  }

  document.getElementById('btn-reset-tutorials').onclick = () => emit(EVENT.tutorialsReset);
  on(EVENT.tutorialsResetResult, success => {
    let message = 'COULD NOT REPLAY TUTORIALS. CHECK BROWSER STORAGE AND TRY AGAIN.';
    if (success){
      const replay = tutorialReplayState();
      message = replay.pending
        ? 'Tutorials will reappear as mechanics arise.'
        : 'Tutorial cards appear as mechanics arise.';
    }
    document.getElementById('tutorials-reset-status').textContent = message;
  });
  on(EVENT.tutorialsReplayStarted, () => {
    const replay = document.getElementById('btn-reset-tutorials');
    const status = document.getElementById('tutorials-reset-status');
    if (replay) replay.disabled = true;
    if (status) status.textContent = 'Tutorials will reappear as mechanics arise.';
  });
  on(EVENT.tutorialsReplayCardOpened, () => {
    const replay = document.getElementById('btn-reset-tutorials');
    const status = document.getElementById('tutorials-reset-status');
    if (replay) replay.disabled = false;
    if (status) status.textContent = 'TUTORIAL CARD OPENED.';
  });
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
  const replay = document.getElementById('btn-reset-tutorials');
  const status = document.getElementById('tutorials-reset-status');
  const replayState = tutorialReplayState();
  if (replay) replay.disabled = !SETTINGS.tutorials || replayState.pending;
  if (status){
    if (!SETTINGS.tutorials){
      status.textContent = 'Turn on tutorial cards to replay them during play.';
    }
    else if (replayState.pending) status.textContent = 'Tutorials will reappear as mechanics arise.';
    else if (replayState.acknowledged) status.textContent = 'TUTORIAL CARD OPENED.';
    else status.textContent = 'Tutorial cards appear as mechanics arise.';
  }
  // The difficulty text in three places is painted from here, so they always match.
  paintTerms();
}

/* Copies saved difficulty, volume, mute, and ambience settings into the live
   game. Runs at boot and every time a setting changes. */
export function applySettings(){
  applyDifficulty(currentTerms());
  Audio_.setMaster(SETTINGS.master);
  Audio_.setMuted(SETTINGS.muted);
  Audio_.setBeds(SETTINGS.ambience);
}

/* Wires the settings listener: water tint changes repaint the water surface,
   then settings are applied and the settings UI re-synced. */
export function bindSettings(){
  on(EVENT.settingsChanged, key => {
    if ((key === '*' || key === 'waterHue' || key === 'waterContrast') && G) repaintDirty.water = true;
    applySettings();
    syncSettingsUI();
  });
}