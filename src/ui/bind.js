import { SETTINGS, currentTerms } from '../settings/store.js';
import { applyDifficulty } from '../config/tuning.js';
import { Audio_ } from '../audio/index.js';
import { on, EVENT } from '../util/events.js';
import { repaintDirty } from '../util/repaint.js';
import { G } from '../sim/state.js';
import { STATE } from '../game/run.js';
import { paintSplashPlan } from '../render/splash-plan.js';
import { hideScreens, showScreen } from './dom.js';
import { flash, renderLives } from './hud.js';
import { syncAmbience } from './splash.js';
import { syncSettingsUI } from './settings-panel.js';

const SCREEN_FOR_STATE = Object.freeze({
  splash: 'splash',
  binder: 'binder',
  pause: 'binder',
  clear: 'clear',
  dead: 'dead',
  win: 'win',
});

function showStateScreen(state){
  if (state === null){
    hideScreens();
    return;
  }
  if (!Object.hasOwn(SCREEN_FOR_STATE, state))
    throw new RangeError(`Unknown run state: ${state}`);
  const screenId = SCREEN_FOR_STATE[state];
  showScreen(screenId);
}

/**
 * Copies saved difficulty, volume, mute, and ambience settings into the live game.
 * Runs at boot and every time a setting changes.
 */
export function applySettings(){
  applyDifficulty(currentTerms());
  Audio_.setMaster(SETTINGS.master);
  Audio_.setMuted(SETTINGS.muted);
  Audio_.setBeds(SETTINGS.ambience);
}

/** Wires common shell events: settings, screens, HUD, rendering and audio. */
export function bindDom(){
  on(EVENT.settingsChanged, key => {
    if ((key === '*' || key === 'waterHue' || key === 'waterContrast') && G) repaintDirty.water = true;
    applySettings();
    syncSettingsUI();
  });
  on(EVENT.screen, showStateScreen);
  on(EVENT.hud, showing => {
    const h = document.getElementById('hud');
    if (showing) h.classList.add('on'); else h.classList.remove('on');
  });
  on(EVENT.lives, renderLives);
  on(EVENT.splashRepaint, () => paintSplashPlan());
  on(EVENT.resize, () => {
    if (G && (STATE === 'splash' || STATE === 'binder')) paintSplashPlan();
  });
  on(EVENT.state, () => {
    syncAmbience();
    if (STATE !== 'play'){ Audio_.silenceBeds(); Audio_.silence(); }
    if (STATE === 'pause') Audio_.suspend();
    else if (STATE === 'play') Audio_.resume();
  });
  on(EVENT.flash, flash);
  on(EVENT.sfx, (n, ...a) => Audio_[n](...a));
}
