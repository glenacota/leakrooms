import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';
import { emit } from '../../src/util/events.js';
import { tickLore, loreReset } from '../../src/sim/lore.js';

const { A, G } = await loadGame();
const buildFloor = A.buildFloor;

function freshFloor(seed){
  loreReset();
  buildFloor(0, seed);
}

test('lore: every floor carries unseen notes with text', () => {
  freshFloor(4242);
  assert.ok(Array.isArray(G.notes) && G.notes.length > 0, 'the floor has notes');
  for (const n of G.notes) {
    assert.equal(n.seen, false, 'every note starts unseen');
    assert.ok(typeof n.text === 'string' && n.text.length > 0, 'each note carries text');
  }
});

test('lore: reveals one unseen note per roll, once each, independent of the radar', () => {
  freshFloor(4242);
  const total = G.notes.length;

  // loreRng() === 0 rolls under LORE_CHANCE and picks index 0: reveals in order
  G.loreRng = () => 0;
  G.radar = false; // lore must not depend on the radar being on
  for (let i = 0; i < total + 2; i++) tickLore(G);
  const seen = G.notes.filter(n => n.seen).length;
  assert.equal(seen, total, 'every note revealed exactly once');

  // a roll at or above the chance reveals nothing
  G.loreRng = () => 1;
  const before = G.notes.map(n => n.seen);
  for (let i = 0; i < 5; i++) tickLore(G);
  assert.deepEqual(G.notes.map(n => n.seen), before, 'nothing revealed when the roll misses');
});

test('lore: a revealed note stays revealed for the floor', () => {
  freshFloor(9090);
  G.loreRng = () => 0;
  tickLore(G);
  assert.equal(G.notes.filter(n => n.seen).length, 1, 'one note revealed on the first roll');
  const revealedText = G.notes.find(n => n.seen).text;

  // always miss the roll: nothing new should be revealed and the seen note stays seen
  G.loreRng = () => 1;
  for (let i = 0; i < 20; i++) tickLore(G);
  assert.equal(G.notes.filter(n => n.seen).length, 1, 'no additional note revealed on a miss');
  assert.equal(G.notes.find(n => n.seen).text, revealedText, 'the same note stays the revealed one');
});

test('lore: a non-lore flash starts the 20s gap, blocking lore until it expires', () => {
  freshFloor(3131);
  G.loreRng = () => 0; // always roll under

  // gate is open after loreReset: a note reveals immediately
  tickLore(G);
  assert.equal(G.notes.filter(n => n.seen).length, 1, 'lore reveals when the gap is open');

  // a non-lore flash restarts the gap timer
  emit('flash', { cat: 'danger', text: 'IT SEES YOU' });

  // gate is closed: lore must not reveal even though the roll passes
  const before = G.notes.filter(n => n.seen).length;
  for (let i = 0; i < 10; i++) tickLore(G);
  assert.equal(G.notes.filter(n => n.seen).length, before, 'lore is blocked while the gap is open');

  // loreReset opens the gate again: lore reveals immediately
  loreReset();
  tickLore(G);
  assert.equal(G.notes.filter(n => n.seen).length, before + 1, 'lore reveals once the gap is reset');
});
