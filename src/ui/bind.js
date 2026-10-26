import { SETTINGS, currentTerms } from '../settings/store.js';
import { applyDifficulty } from '../config/tuning.js';
import { Audio_ } from '../audio/index.js';
import { on } from '../util/events.js';
import { repaintDirty } from '../util/repaint.js';
import { G } from '../sim/state.js';
import { STATE } from '../game/run.js';
import { paintSplashPlan } from '../render/splash-plan.js';
import { attachFloorImages } from '../render/bake.js';
import { buildGrainFull, buildPatterns } from '../render/textures.js';
import { hideAll, show } from './dom.js';
import { flash, renderLives } from './hud.js';
import { syncAmbience } from './splash.js';
import { syncSettingsUI } from './settings-panel.js';

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
  on('settings:changed', key => {
    if ((key === '*' || key === 'waterHue' || key === 'waterContrast') && G) repaintDirty.water = true;
    applySettings();
    syncSettingsUI();
  });
  on('screen', name => { if (name === null) hideAll(); else show(name); });
  on('hud', showing => {
    const h = document.getElementById('hud');
    if (showing) h.classList.add('on'); else h.classList.remove('on');
  });
  on('lives', renderLives);
  on('splash:repaint', paintSplashPlan);
  on('resize', () => {
    if (G && (STATE === 'splash' || STATE === 'order')) paintSplashPlan();
  });
  on('contextrestored', () => {
    buildPatterns();
    buildGrainFull();
    attachFloorImages(G);
    repaintDirty.water = true;
    repaintDirty.mask = true;
  });
  on('state', () => {
    syncAmbience();
    if (STATE !== 'play'){ Audio_.silenceBeds(); Audio_.silence(); }
    if (STATE === 'pause') Audio_.suspend();
    else if (STATE === 'play') Audio_.resume();
  });
  on('flash', flash);
  on('sfx', (n, ...a) => Audio_[n](...a));
}
