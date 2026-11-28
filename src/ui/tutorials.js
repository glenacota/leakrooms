import { MAP } from '../config/constants.js';
import { STATE } from '../game/run.js';
import { cvs, SCALE } from '../render/canvas.js';
import { cam } from '../render/render.js';
import { paintTutorial } from '../render/tutorial-art.js';
import { SETTINGS } from '../settings/store.js';
import { G } from '../sim/state.js';
import { emit, on, EVENT } from '../util/events.js';
import { flashBusy } from './hud.js';

const STORAGE_KEY = 'leakrooms.tutorials.v1';
const TUTORIAL_SEC = 9;
// Starting value for introducing the water clue early on the first floor.
const WATER_TUTORIAL_SEC = 20;
// One active minute gives the player a clear example of elapsed air supply.
const AIR_TUTORIAL_SEC = 60;
const TUTORIALS = {
  sprint: {
    title: 'Save your legs',
    text: 'Running drains stamina and makes enough noise to draw unwanted attention. Walk to recover and stay undetected.',
    flash: 'RUNNING IS LOUD AND DRAINS STAMINA. STOP RUNNING TO RECOVER',
  },
  radar: {
    title: 'Use the radar sparingly',
    text: 'The radar reveals the floor for ten seconds, but its pulse can draw attention. Grab batteries when you find them.',
    flash: 'RADAR IS LOUD AND DRAINS BATTERY',
  },
  water: {
    title: 'How to find a leak',
    text: 'Water runs from broken pipes. Follow the wet carpet to find the leak.',
    flash: 'FOLLOW THE WET CARPET TO FIND A LEAK',
  },
  repair: {
    title: 'How to seal a leak',
    text: 'Hold still beside the leak to seal it. The clatter of your wrench could draw unwanted attention.',
    flash: 'HOLD STILL BESIDE THE LEAK TO SEAL IT. REPAIR IS LOUD',
  },
  lifeform: {
    title: 'Watch for lifeforms',
    text: 'Loud sounds can wake a dormant lifeform or start a hunt. Awake lifeforms can still see you nearby.',
    flash: 'LOUD SOUNDS WAKE LIFEFORMS OR START A HUNT. AWAKE LIFEFORMS CAN SEE YOU NEARBY',
  },
  airsupply: {
    title: 'Limited air supply',
    text: 'One minute of air supply is already gone. The countdown timer shows how much is left.',
    flash: 'USED ONE MINUTE OF AIR SUPPLY. MONITOR THE TIMER'
  },
  doorCompass: {
    title: 'All leaks sealed. Find the door',
    text: 'The door is open now. Stand still to remember which way you came.',
    flash: 'STOP TO REMEMBER THE WAY BACK TO THE EXIT'
  }
};

let completed = new Set();
let fallback = new Set();
let queue = [];
let fallbackQueue = [];
let current = null;
let sprinted = false;
let remaining = 0;
let hovering = false;
let focused = false;
let lastOpenLeaks = 0;
let replayPending = false;
let replayAcknowledged = false;

export function tutorialReplayState(){
  return { pending: replayPending, acknowledged: replayAcknowledged };
}

export function resetTutorialReplayStatus(){
  replayAcknowledged = false;
}

function loadCompleted(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error('Invalid tutorial history');
    return new Set(value.filter(id => Object.hasOwn(TUTORIALS, id)));
  } catch (error){
    console.warn('Could not load tutorial history:', error);
    return new Set();
  }
}

function saveCompleted(){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...completed])); }
  catch (error){ console.warn('Could not save tutorial history:', error); }
}

function onScreen(x, y){
  if (!SCALE || !cvs.width || !cvs.height) return false;
  const sx = (x - cam.x)*MAP.TILE_SIZE_PX*SCALE + cvs.width/2 + cam.jx*SCALE;
  const sy = (y - cam.y)*MAP.TILE_SIZE_PX*SCALE + cvs.height/2 + cam.jy*SCALE;
  return sx >= 0 && sx < cvs.width && sy >= 0 && sy < cvs.height;
}

function tileVisible(x, y, pipe = false){
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || tx >= MAP.WIDTH_TILES || ty < 0 || ty >= MAP.HEIGHT_TILES || !onScreen(x, y)) return false;
  const i = ty*MAP.WIDTH_TILES + tx;
  return pipe ? G.maskArr[i] > 0.02 : G.maskArr[i] * G.lightArr[i] > 0.05;
}

function candidates(){
  const result = [];
  const sealedJustNow = lastOpenLeaks > 0 && G.openLeaks === 0;
  lastOpenLeaks = G.openLeaks;
  const needed = id => SETTINGS.tutorials ? !completed.has(id) && current !== id && !queue.includes(id)
    : !fallback.has(id) && !fallbackQueue.includes(id);
  if (sprinted && needed('sprint')) result.push('sprint');
  if (G.radar && needed('radar')) result.push('radar');
  if (G.floor === 0 && G.time >= WATER_TUTORIAL_SEC - 1e-8 && needed('water')) result.push('water');
  if (needed('repair') && G.leaks.some(l => !l.fixed && tileVisible(l.x+0.5, l.y+0.5, true))) result.push('repair');
  if (needed('lifeform') && G.lifeforms.some(l => tileVisible(l.x, l.y))) result.push('lifeform');
  if (G.time >= AIR_TUTORIAL_SEC - 1e-8 && needed('airsupply')) result.push('airsupply');
  if (sealedJustNow && needed('doorCompass')) result.push('doorCompass');
  return result;
}

function displayNext(){
  current = queue.shift();
  if (!current) return;
  remaining = TUTORIAL_SEC;
  const tutorial = TUTORIALS[current];
  document.getElementById('tutorial-title').textContent = tutorial.title;
  document.getElementById('tutorial-text').textContent = tutorial.text;
  paintTutorial(document.getElementById('tutorial-art'), current);
  document.getElementById('tutorial-overlay').hidden = false;
  syncCountdown();
  if (replayPending){
    replayPending = false;
    replayAcknowledged = true;
    emit(EVENT.tutorialsReplayCardOpened);
  }
}

function syncCountdown(){
  const el = document.getElementById('tutorial-countdown');
  const text = `[${Math.ceil(remaining)}s]`;
  if (el.textContent !== text) el.textContent = text;
}

function clearTutorialCards(){
  queue = [];
  current = null;
  sprinted = false;
  remaining = 0;
  hovering = focused = false;
  document.getElementById('tutorial-overlay').hidden = true;
}

function clearPending(){
  fallbackQueue = [];
  clearTutorialCards();
  lastOpenLeaks = 0;
}

/** Evaluates tutorial triggers after a completed simulation step. */
export function tickTutorials(dt = 0){
  if (STATE !== 'play' || !G) return;
  const active = current;
  for (const id of candidates()){
    if (!SETTINGS.tutorials){
      fallbackQueue.push(id);
    } else if (!completed.has(id) && !queue.includes(id)){
      queue.push(id);
    }
  }
  sprinted = false;
  if (!SETTINGS.tutorials && fallbackQueue.length && !flashBusy()){
    const id = fallbackQueue.shift();
    fallback.add(id);
    emit(EVENT.flash, { cat: 'guide', text: TUTORIALS[id].flash });
  }
  if (active && current === active && !hovering && !focused){
    remaining = Math.max(0, remaining - dt);
    if (remaining < 1e-8) dismissTutorial();
    else syncCountdown();
  }
  if (!current && queue.length && SETTINGS.tutorials) displayNext();
}

/** Dismisses a visible tutorial, returning whether one was present. */
export function dismissTutorial(dismiss = true){
  if (STATE !== 'play' || !current) return false;
  if (!dismiss) return true;
  completed.add(current);
  saveCompleted();
  current = null;
  if (queue.length) displayNext();
  else {
    document.getElementById('tutorial-overlay').hidden = true;
    hovering = focused = false;
  }
  return true;
}

/** Binds tutorial triggers, dismissal and persistent history. */
export function bindTutorials(){
  completed = loadCompleted();
  fallback = new Set();
  clearPending();
  const card = document.getElementById('tutorial-overlay');
  document.getElementById('tutorial-continue').onclick = () => dismissTutorial();
  card.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') hovering = true; });
  card.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') hovering = false; });
  card.addEventListener('focusin', () => { focused = true; });
  card.addEventListener('focusout', e => { focused = !!e.relatedTarget && card.contains(e.relatedTarget); });
  on(EVENT.sprint, () => { sprinted = true; });
  on(EVENT.runStart, () => { fallback.clear(); clearPending(); });
  on(EVENT.floorBuilt, clearPending);
  on(EVENT.tutorialsReset, () => {
    try {
      localStorage.setItem(STORAGE_KEY, '[]');
    } catch (error){
      console.warn('Could not reset tutorial history:', error);
      emit(EVENT.tutorialsResetResult, false);
      return;
    }
    completed.clear();
    replayPending = SETTINGS.tutorials;
    replayAcknowledged = false;
    clearTutorialCards();
    emit(EVENT.tutorialsResetResult, true);
    if (replayPending) emit(EVENT.tutorialsReplayStarted);
  });
  on(EVENT.settingsChanged, key => {
    if (key !== 'tutorials' && key !== '*') return;
    if (SETTINGS.tutorials) fallbackQueue = [];
    else clearPending();
  });
  on(EVENT.state, () => {
    if (STATE === 'pause'){
      card.hidden = true;
      hovering = focused = false;
    } else if (STATE === 'play') card.hidden = !current;
    else clearPending();
  });
}
