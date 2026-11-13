import { MAP_H, MAP_W, TILE } from '../config/constants.js';
import { STATE } from '../game/run.js';
import { cvs, SCALE } from '../render/canvas.js';
import { cam } from '../render/render.js';
import { paintTutorial } from '../render/tutorial-art.js';
import { SETTINGS } from '../settings/store.js';
import { G } from '../sim/state.js';
import { emit, on } from '../util/events.js';
import { flashBusy } from './hud.js';

const STORAGE_KEY = 'leakrooms.tutorials.v1';
const TUTORIAL_SEC = 9;
// Starting value for introducing the water clue early on the first floor.
const WATER_TUTORIAL_SEC = 3;
const TUTORIALS = {
  sprint: {
    title: 'Running has a cost',
    text: 'Running is loud and may attract hostile lifeforms. It also drains stamina. Walk or stand still to recover.',
    flash: 'RUNNING IS LOUD AND DRAINS STAMINA. STOP RUNNING TO RECOVER',
  },
  radar: {
    title: 'Radar has a cost',
    text: 'The radar reveals the map for 10 seconds, but its noise may attract hostile lifeforms. Grab spare batteries to recharge.',
    flash: 'RADAR IS LOUD AND DRAINS BATTERY',
  },
  water: {
    title: 'How to find a leak',
    text: 'Water spreads from open leaks. Follow the water on the floor to find them.',
    flash: 'FOLLOW THE WET FLOOR TO FIND A LEAK',
  },
  repair: {
    title: 'How to seal a leak',
    text: 'Stand still beside the leak to repair it. Repairing is loud and can attract lifeforms.',
    flash: 'STAND STILL BESIDE THE LEAK TO REPAIR IT. REPAIRING IS LOUD',
  },
  lifeform: {
    title: 'Watch for lifeforms',
    text: 'Dormant lifeforms cannot see you. Only loud sounds (running, using the radar) wake them. Awake lifeforms can also see you.',
    flash: 'LOUD SOUNDS WAKE LIFEFORMS OR START A HUNT. AWAKE LIFEFORMS CAN SEE YOU',
  },
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
  const sx = (x - cam.x)*TILE*SCALE + cvs.width/2 + cam.jx*SCALE;
  const sy = (y - cam.y)*TILE*SCALE + cvs.height/2 + cam.jy*SCALE;
  return sx >= 0 && sx < cvs.width && sy >= 0 && sy < cvs.height;
}

function tileVisible(x, y, pipe = false){
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H || !onScreen(x, y)) return false;
  const i = ty*MAP_W + tx;
  return pipe ? G.maskArr[i] > 0.02 : G.maskArr[i] * G.lightArr[i] > 0.05;
}

function candidates(){
  const result = [];
  const needed = id => SETTINGS.tutorials ? !completed.has(id) && current !== id && !queue.includes(id)
    : !fallback.has(id) && !fallbackQueue.includes(id);
  if (sprinted && needed('sprint')) result.push('sprint');
  if (G.radar && needed('radar')) result.push('radar');
  if (G.floor === 0 && G.time >= WATER_TUTORIAL_SEC - 1e-8 && needed('water')) result.push('water');
  if (needed('repair') && G.leaks.some(l => !l.fixed && tileVisible(l.x+0.5, l.y+0.5, true))) result.push('repair');
  if (needed('lifeform') && G.lifeforms.some(l => tileVisible(l.x, l.y))) result.push('lifeform');
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
    emit('flash', { cat: 'guide', text: TUTORIALS[id].flash });
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
  on('sprint', () => { sprinted = true; });
  on('run:start', () => { fallback.clear(); clearPending(); });
  on('floorBuilt', clearPending);
  on('tutorials:reset', () => {
    try {
      localStorage.setItem(STORAGE_KEY, '[]');
    } catch (error){
      console.warn('Could not reset tutorial history:', error);
      emit('tutorials:reset-result', false);
      return;
    }
    completed.clear();
    clearTutorialCards();
    emit('tutorials:reset-result', true);
  });
  on('settings:changed', key => {
    if (key !== 'tutorials' && key !== '*') return;
    if (SETTINGS.tutorials) fallbackQueue = [];
    else clearPending();
  });
  on('state', () => {
    if (STATE === 'pause'){
      card.hidden = true;
      hovering = focused = false;
    } else if (STATE === 'play') card.hidden = !current;
    else clearPending();
  });
}
