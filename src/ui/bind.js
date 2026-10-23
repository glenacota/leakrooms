import { DIFFICULTIES } from '../config/presets.js';
import { SETTINGS } from '../settings/store.js';
import { applyDifficulty, FLOOR_CLOCK } from '../config/tuning.js';
import { Audio_ } from '../audio/index.js';
import { on } from '../util/events.js';
import { G } from '../sim/state.js';
import { clearCard, clockText, STATE } from '../game/run.js';
import { paintSplashPlan } from '../render/splash-plan.js';
import { attachFloorImages } from '../render/bake.js';
import { buildGrainFull, buildPatterns } from '../render/textures.js';
import { hideAll, show } from './dom.js';
import { flash, renderLives } from './hud.js';
import { syncAmbience } from './splash.js';
import { syncSettingsUI } from './settings-panel.js';

/**
 * Copies the saved settings into the live game: difficulty values, volume and
 * mute. Runs at boot and every time a setting changes.
 */
export function applySettings(){
  const d = DIFFICULTIES[SETTINGS.difficulty] || DIFFICULTIES.normal;
  applyDifficulty(d);
  Audio_.setMaster(SETTINGS.master);
  /* Both volume and mute are applied. The M key flips the stored mute flag and
     ends up here, so applying only the volume would save the mute and change
     nothing the player can hear. */
  Audio_.setMuted(SETTINGS.muted);
  /* The beds level is applied with the same live binding: it is read by the
     audio graph through the beds gain node, not stored on a voice. */
  Audio_.setBeds(SETTINGS.ambience);
}

/* The DOM side of the event bus. The simulation and the run only report
   facts ("flash this text", "the player died"). The handlers here turn those
   facts into changes on screen, and are the only place that happens. They are
   in one function so the whole list can be read in one place, and boot()
   attaches them with a single call. */
export function bindDom(){
  on('settings:changed', key => {
    // A new water tint changes the packed water image, even though the water itself did not move.
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
  /* The run owns the numbers on the floor-clear card; writing them is the
     shell's job. The praise depends only on how much clock was left — barely
     making it gets the cooler line. */
  on('clear:show', () => {
    const el = id => document.getElementById(id);
    el('clear-clock').textContent = clockText(clearCard.clock);
    el('clear-floor').textContent  = clearCard.floor+1;
    el('clear-leaks').textContent  = clearCard.leaks;
    el('clear-forms').textContent  = clearCard.lifeforms;
    el('clear-sub').textContent =
      clearCard.clock >= FLOOR_CLOCK*0.34 ? 'GOOD WORK. MANAGEMENT NOTICES.'
                                        : 'SEALED. MANAGEMENT HAS NO COMMENT.';
  });
  /* RESET GAME arms on the first press; the label is what tells the player
     the second press is the one that ends the run. */
  on('reset', armed => {
    const b = document.getElementById('btn-reset-run');
    if (b) b.textContent = armed ? 'TAP AGAIN — LOSES THE RUN' : 'RESET GAME';
  });
  /* A new building means a new plan behind the title. The run says so; the
     renderer paints it. */
  on('splash:repaint', ()=>{ paintSplashPlan(); });
  /* The title plan is only visible on the title and work order screens, so it
     is only repainted there. Repainting it during play (for example while the
     window is being resized) would redraw a large canvas that nobody can see. */
  on('resize', ()=>{
    if (G && (STATE==='splash' || STATE==='order')) paintSplashPlan();
  });

  /* The browser can take the canvas context away (a graphics driver reset, a
     switch between graphics chips). Every bitmap the renderer draws from is
     lost with it, and the game would keep running and drawing blank canvases.
     When the context comes back, rebuild everything and mark the packed water
     and mask images as stale. */
  on('contextrestored', ()=>{
    buildPatterns();
    buildGrainFull();
    attachFloorImages();
    G.dirty.water = true;
    G.dirty.mask  = true;
  });
  on('state', () => {
    syncAmbience();
    /* update() stops when play stops, and update() is what drives the noise
       beds and the drone. Without this, they would stay at their last level
       under the pause, death and win screens. */
    if (STATE!=='play'){ Audio_.silenceBeds(); Audio_.silence(); }
    /* Pausing also suspends the audio context so a paused game does no audio
       work. Resuming here may be refused by the browser without a user
       gesture; the next key press calls unlock(), which always works. */
    if (STATE==='pause') Audio_.suspend();
    else if (STATE==='play') Audio_.resume();
  });
  // The texture module subscribes to 'resize' by itself when it loads.
  on('flash', flash);
  on('sfx', (n, ...a) => Audio_[n](...a));
}