import { DIFFICULTIES } from '../config/presets.js';
import { SETTINGS } from '../settings/store.js';
import { applyDifficulty } from '../config/tuning.js';
import { Audio_ } from '../audio/index.js';
import { on } from '../util/events.js';
import { G } from '../sim/state.js';
import { STATE } from '../game/run.js';
import { paintSplashPlan } from '../render/splash-plan.js';
import { attachFloorImages } from '../render/bake.js';
import { buildGrainFull, buildPatterns } from '../render/textures.js';
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
  /* The splash plan is the riser's picture of the building, drawn from the seed
     the run will use. It is only visible on the title chain, and it costs a
     full repaint of a screen-sized canvas — so it is repainted there and only
     there. A resize during a run used to repaint it invisibly, fifty times a
     drag, for a canvas nobody can see under the HUD. */
  on('resize', ()=>{
    if (G && (STATE==='splash' || STATE==='order')) paintSplashPlan();
  });

  /* CONTEXT RESTORED. Every bitmap this renderer draws from belonged to the
     context that was lost: the procedural patterns, the screen-sized grain, the
     light bake and the two world-sized tile layers. All of them come back blank,
     and the game does not notice — it keeps drawing from empty canvases at full
     frame rate, which is a black rectangle with a clock running behind it. So
     the restore rebuilds all of it and marks the packed fields dirty, because
     the flood image and the visibility mask are the two things that are only
     regenerated when something says they are stale. */
  on('contextrestored', ()=>{
    buildPatterns();
    buildGrainFull();
    if (G){
      attachFloorImages();
      G.dirty.water = true;
      G.dirty.mask  = true;
    }
  });
  on('state', () => {
    syncAmbience();
    /* Leaving play is the end of update(), and update() is what drives the two
       continuous beds and the drone. Nothing would close them: the noise floor
       of a level nobody is playing stays at whatever the last frame told it,
       under the pause ticket, the death card or the win screen. Every state
       change announces itself here now, so every one of them closes the mix. */
    if (STATE!=='play'){ Audio_.silenceBeds(); Audio_.silence(); }
    /* The pause holds the clock, the flood and the simulation; it now holds the
       audio context too, and blur/visibilitychange reach the pause by pausing.
       Resuming is attempted without a gesture, which a browser may refuse — the
       next key goes through unlock() with one, which always works. */
    if (STATE==='pause') Audio_.suspend();
    else if (STATE==='play') Audio_.resume();
  });
  // textures subscription registered at import of render/textures.js.
  on('flash', flash);
  on('sfx', (n, ...a) => Audio_[n](...a));
}
