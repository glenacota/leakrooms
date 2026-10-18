import { DIFFICULTIES } from '../config/presets.js';
import { SETTINGS } from '../settings/store.js';
import { applyDifficulty } from '../config/tuning.js';
import { Audio_ } from '../audio/index.js';
import { on } from '../util/events.js';
import { G } from '../sim/state.js';
import { paintSplashPlan } from '../render/splash-plan.js';
import { hideAll, show } from './dom.js';
import { flash, renderLives } from './hud.js';
import { syncAmbience } from './splash.js';
import { syncSettingsUI } from './settings-panel.js';

export function applySettings(){
  const d = DIFFICULTIES[SETTINGS.difficulty] || DIFFICULTIES.normal;
  applyDifficulty(d);
  Audio_.setMaster(SETTINGS.master);
  /* Both of them, or the settings modal becomes a lie. M flips the stored flag
     through setOption, which lands here — and this used to push only the volume,
     so the mute persisted perfectly and changed nothing at all. A setting that
     saves, survives a reload, and has no effect is the worst kind of setting,
     because the reload appears to prove it worked. */
  Audio_.setMuted(SETTINGS.muted);
}

/* The DOM side of the event bus. Everything above this line reports a fact; the
   handlers here are the only place a fact becomes a pixel. They are collected
   into one bind function so the wiring is a single call at boot and the
   subscription list can be read top to bottom in one place. */
export function bindDom(){
  on('settings:changed', key => {
    if ((key === '*' || key === 'waterHue' || key === 'waterContrast') && G) G.dirty.water = true;
    applySettings();
    syncSettingsUI();
  });
  on('screen', name => { if (name === null) hideAll(); else show(name); });
  on('hud', on_ => { const h = document.getElementById('hud'); if (on_) h.classList.add('on'); else h.classList.remove('on'); });
  on('dead', ({ lives, cause }) => {
    const sub = document.getElementById('dead-sub');
    if (lives > 0) sub.textContent = `${lives} LIVES REMAINING \u2014 ${cause}`;
    else sub.textContent = 'SIGNAL LOST';
  });
  on('win', ({ sealed, deaths, noises, floors, time }) => {
    document.getElementById('win-stats').innerHTML =
      `You sealed <b>${sealed}</b> pipes and got back through the door on all <b>${floors}</b> levels.<br>Deaths: <b>${deaths}</b> &nbsp; Noise made: <b>${noises}</b><br>Time: <b>${Math.floor(time/60)}:${String(Math.floor(time%60)).padStart(2,'0')}</b>`;
  });
  on('lives', renderLives);
  on('state', syncAmbience);
  // textures subscription registered at import of render/textures.js; plan rebuild after.
  on('resize', ()=>{ if (G) paintSplashPlan(); });
  on('flash', flash);
  on('sfx', (n, ...a) => Audio_[n](...a));
}
