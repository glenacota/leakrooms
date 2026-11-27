import {
  clearLeaderboard, LEADERBOARD_TERMS, readLeaderboard, topLeaderboard,
} from '../settings/leaderboard-store.js';
import { showScreen } from './dom.js';

let returnScreen = 'splash';
let returnFocus = null;
let activeTerms = 'NORMAL';
let open = false;
let clearArmed = false;
let clearArmTimer = 0;
let notice = '';

const CLEAR_LABEL = 'CLEAR LOCAL RECORDS';
const CLEAR_ARMED_LABEL = 'TAP AGAIN — CLEARS RECORDS';
const CLEAR_ARM_MS = 5000; // Match the reset-run confirmation window.
const el = id => document.getElementById(id);

function formatElapsed(seconds){
  return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2, '0')}`;
}

function formatTimestamp(timestamp){
  return new Intl.DateTimeFormat(undefined, {
    day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit',
  }).format(new Date(timestamp));
}

function formatTotal(total){
  const formatted = new Intl.NumberFormat().format(Math.abs(total));
  return total < 0 ? `−${formatted}` : formatted;
}

function renderRows(records){
  return records.map(record => `<tr>
    <td class="leaderboard-rank">${record.rank}</td>
    <td>${formatTimestamp(record.timestamp)}</td>
    <td>${record.status}</td>
    <td>${formatElapsed(record.elapsedSeconds)}</td>
    <td class="leaderboard-total">${formatTotal(record.total)}</td>
  </tr>`).join('');
}

function disarmClear(){
  clearArmed = false;
  clearTimeout(clearArmTimer);
  clearArmTimer = 0;
  el('btn-clear-leaderboard').textContent = CLEAR_LABEL;
}

function armClear(){
  clearArmed = true;
  el('btn-clear-leaderboard').textContent = CLEAR_ARMED_LABEL;
  clearArmTimer = setTimeout(disarmClear, CLEAR_ARM_MS);
  if (clearArmTimer.unref) clearArmTimer.unref();
}

function renderLeaderboard(){
  const result = readLeaderboard();
  const table = el('leaderboard-table');
  const empty = el('leaderboard-empty');
  const message = el('leaderboard-message');
  const rows = el('leaderboard-rows');
  const selected = topLeaderboard(result.records, activeTerms);
  el('leaderboard-panel').setAttribute('aria-labelledby', `leaderboard-${activeTerms.toLowerCase()}`);

  for (const tab of document.querySelectorAll('[data-leaderboard-terms]')){
    const isSelected = tab.dataset.leaderboardTerms === activeTerms;
    tab.setAttribute('aria-selected', String(isSelected));
    tab.tabIndex = isSelected ? 0 : -1;
  }

  rows.innerHTML = result.ok ? renderRows(selected) : '';
  table.hidden = !result.ok || selected.length === 0;
  empty.hidden = !result.ok || selected.length > 0;
  empty.textContent = `No scores yet. Complete a ${activeTerms} shift to appear.`;
  message.textContent = notice || (result.ok
    ? 'Records stay in this browser. No player names are stored.'
    : 'Local records are unavailable in this browser.');
  message.dataset.state = result.ok ? 'ready' : 'error';
}

function selectTerms(terms){
  disarmClear();
  activeTerms = terms;
  notice = '';
  renderLeaderboard();
}

/**
 * Opens a terms list and remembers which end screen or title menu to restore.
 * @param {'RELAXED'|'NORMAL'|'HARD'} terms
 * @param {'splash'|'win'|'dead'} [source]
 */
export function openLeaderboard(terms, source = 'splash'){
  if (!LEADERBOARD_TERMS.includes(terms)) throw new RangeError(`Unknown leaderboard terms: ${terms}`);
  if (!['splash', 'win', 'dead'].includes(source)) throw new RangeError(`Unknown leaderboard return screen: ${source}`);
  disarmClear();
  activeTerms = terms;
  returnScreen = source;
  returnFocus = document.activeElement;
  notice = '';
  open = true;
  renderLeaderboard();
  showScreen('leaderboard');
  el('leaderboard-title')?.focus?.();
}

/** Returns to the screen that opened the board. */
export function closeLeaderboard(){
  if (!open) return false;
  open = false;
  disarmClear();
  showScreen(returnScreen);
  if (returnFocus?.focus) returnFocus.focus();
  returnFocus = null;
  return true;
}

export function isLeaderboardOpen(){
  return open;
}

/** Moves between terms tabs from the keyboard. @param {number} delta */
export function stepLeaderboardTerms(delta){
  const index = LEADERBOARD_TERMS.indexOf(activeTerms);
  selectTerms(LEADERBOARD_TERMS[(index + delta + LEADERBOARD_TERMS.length) % LEADERBOARD_TERMS.length]);
  el(`leaderboard-${activeTerms.toLowerCase()}`)?.focus?.();
}

export function requestClearLeaderboard(){
  if (!clearArmed){
    armClear();
    return;
  }
  disarmClear();
  const result = clearLeaderboard();
  notice = result.ok ? 'Local records cleared.' : 'Could not clear local records in this browser.';
  renderLeaderboard();
  el('btn-clear-leaderboard')?.focus?.();
}

export function bindLeaderboard(){
  for (const tab of document.querySelectorAll('[data-leaderboard-terms]'))
    tab.onclick = () => selectTerms(tab.dataset.leaderboardTerms);
  el('btn-leaderboard-back').onclick = closeLeaderboard;
  el('btn-clear-leaderboard').onclick = requestClearLeaderboard;
}
