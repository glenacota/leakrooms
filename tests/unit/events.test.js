import test from 'node:test';
import assert from 'node:assert/strict';
import { on, off, emit, clearAll } from '../../src/util/events.js';

test('emit calls listeners in order', () => {
  clearAll();
  const order = [];
  on('x', () => order.push(1));
  on('x', () => order.push(2));
  emit('x');
  assert.deepEqual(order, [1, 2]);
});

test('unsubscribe stops calls', () => {
  clearAll();
  let n = 0;
  const unsub = on('y', () => n++);
  emit('y');
  assert.equal(n, 1);
  unsub();
  emit('y');
  assert.equal(n, 1);
});

test('off removes listener', () => {
  clearAll();
  let n = 0;
  const fn = () => n++;
  on('z', fn);
  off('z', fn);
  emit('z');
  assert.equal(n, 0);
});

test('emit with no listeners is no-op', () => {
  clearAll();
  assert.doesNotThrow(() => emit('nope', 1, 2, 3));
});

test('clearAll wipes everything', () => {
  clearAll();
  let n = 0;
  on('a', () => n++);
  clearAll();
  emit('a');
  assert.equal(n, 0);
});

test('emit passes args', () => {
  clearAll();
  let received = null;
  on('ev', (...a) => { received = a; });
  emit('ev', 1, 'two', 3);
  assert.deepEqual(received, [1, 'two', 3]);
});