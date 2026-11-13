import { MAP_H, MAP_W, TILE, WET_DRAW } from '../config/constants.js';
import { STATE, transition } from '../game/run.js';
import { cvs, SCALE } from '../render/canvas.js';
import { cam } from '../render/render.js';
import { paintLesson } from '../render/lesson-art.js';
import { SETTINGS, setOption } from '../settings/store.js';
import { G } from '../sim/state.js';
import { emit, on } from '../util/events.js';
import { flashBusy } from './hud.js';

const STORAGE_KEY = 'leakrooms.lessons.v1';
const LESSONS = {
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
let priorFocus = null;
let waterTile = null;

function loadCompleted(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error('Invalid lesson history');
    return new Set(value.filter(id => Object.hasOwn(LESSONS, id)));
  } catch (error){
    console.warn('Could not load lesson history:', error);
    return new Set();
  }
}

function saveCompleted(){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...completed])); }
  catch (error){ console.warn('Could not save lesson history:', error); }
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
  const needed = id => SETTINGS.lessons ? !completed.has(id) && !queue.includes(id)
    : !fallback.has(id) && !fallbackQueue.includes(id);
  if (sprinted && needed('sprint')) result.push('sprint');
  if (G.radar && needed('radar')) result.push('radar');
  if (G.wetArr && needed('water')){
    for (let y=0; y<MAP_H; y++){
      let found = false;
      for (let x=0; x<MAP_W; x++){
        if (G.wetArr[y*MAP_W+x] > WET_DRAW && tileVisible(x+0.5, y+0.5)){
          waterTile = { x, y };
          result.push('water');
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }
  if (needed('repair') && G.leaks.some(l => !l.fixed && tileVisible(l.x+0.5, l.y+0.5, true))) result.push('repair');
  if (needed('lifeform') && G.lifeforms.some(l => tileVisible(l.x, l.y))) result.push('lifeform');
  return result;
}

function displayNext(){
  current = queue.shift();
  if (!current) return;
  const lesson = LESSONS[current];
  document.getElementById('lesson-title').textContent = lesson.title;
  document.getElementById('lesson-text').textContent = lesson.text;
  document.getElementById('lesson-disable').checked = false;
  paintLesson(document.getElementById('lesson-art'), current, waterTile);
  document.getElementById('lesson-overlay').hidden = false;
  document.getElementById('lesson-continue').focus?.();
}

/** Evaluates lesson triggers after a completed simulation step. */
export function tickLessons(){
  if (STATE !== 'play' || !G) return;
  for (const id of candidates()){
    if (!SETTINGS.lessons){
      fallbackQueue.push(id);
    } else if (!completed.has(id) && !queue.includes(id)){
      queue.push(id);
    }
  }
  sprinted = false;
  if (!SETTINGS.lessons && fallbackQueue.length && !flashBusy()){
    const id = fallbackQueue.shift();
    fallback.add(id);
    emit('flash', { cat: 'guide', text: LESSONS[id].flash });
  }
  if (!queue.length || !SETTINGS.lessons) return;
  priorFocus = document.activeElement;
  emit('lesson:opening');
  transition('lesson');
  displayNext();
}

/** Dismisses the active lesson and resumes when the queue is empty. */
export function dismissLesson(){
  if (STATE !== 'lesson' || !current) return;
  completed.add(current);
  saveCompleted();
  if (document.getElementById('lesson-disable').checked){
    setOption('lessons', false);
    queue = [];
    fallbackQueue = [];
  }
  current = null;
  if (queue.length){ displayNext(); return; }
  document.getElementById('lesson-overlay').hidden = true;
  transition('play');
  if (priorFocus && typeof priorFocus.focus === 'function') priorFocus.focus();
  priorFocus = null;
}

/** Binds lesson triggers, dismissal and persistent history. */
export function bindLessons(){
  completed = loadCompleted();
  fallback = new Set();
  queue = [];
  current = null;
  sprinted = false;
  document.getElementById('lesson-continue').onclick = dismissLesson;
  on('sprint', () => { sprinted = true; });
  on('run:start', () => { fallback.clear(); fallbackQueue = []; });
  on('settings:changed', key => {
    if ((key === 'lessons' || key === '*') && SETTINGS.lessons) fallbackQueue = [];
  });
  on('state', () => {
    if (STATE !== 'play' && STATE !== 'lesson'){
      queue = [];
      fallbackQueue = [];
      current = null;
      sprinted = false;
      document.getElementById('lesson-overlay').hidden = true;
    }
  });
}
