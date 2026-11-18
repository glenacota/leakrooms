/* Wires shell events to the modules that own each effect. bindDom is the one
   orchestrator: it calls the bind* helper of every feature. Each listener lives
   beside the module that owns the DOM element or audio voice it touches. */

import { Audio_ } from '../audio/index.js';
import { play } from '../audio/voices.js';
import { on, EVENT } from '../util/events.js';
import { STATE } from '../game/run.js';
import { bindSettings } from './settings-panel.js';
import { bindScreen } from './binder.js';
import { bindHud, bindFlash } from './hud.js';
import { bindSplashRepaint, bindResize } from '../render/splash-plan.js';
import { bindStateAmbience } from './splash.js';

export { applySettings } from './settings-panel.js';

export function bindDom(){
  bindSettings();
  bindScreen();
  bindHud();
  bindFlash();
  bindSfx();
  bindSplashRepaint();
  bindResize();
  bindStateAmbience();
  bindStateAudio();
}

function bindSfx(){
  on(EVENT.sfx, (n, ...a) => play(n, ...a));
}

function bindStateAudio(){
  on(EVENT.state, () => {
    if (STATE !== 'play'){ Audio_.silenceBeds(); Audio_.silence(); }
    if (STATE === 'pause') Audio_.suspend();
    else if (STATE === 'play') Audio_.resume();
  });
}
