import test from 'node:test';
import assert from 'node:assert/strict';
import { calls, fakeCanvas } from '../helpers/stubs.js';
import { initManualArt } from '../../src/ui/manual-art.js';

const ids = ['manual-battery', 'manual-stamina', 'manual-noise'];
const errors = [
  '2D canvas context unavailable for manual battery meter',
  '2D canvas context unavailable for manual stamina meter',
  '2D canvas context unavailable for manual noise indicator',
];

function withCanvases(failAt, run){
  const previous = global.document;
  const events = [];
  const canvases = ids.map((id, i) => {
    const canvas = fakeCanvas();
    canvas.width = canvas.height = 54;
    const getContext = canvas.getContext;
    canvas.getContext = type => {
      events.push(['context', id, type]);
      return i === failAt ? null : getContext();
    };
    return canvas;
  });
  global.document = {
    getElementById(id){
      events.push(['lookup', id]);
      return canvases[ids.indexOf(id)];
    },
  };
  try { run(events); }
  finally { global.document = previous; }
}

test('manual art paints each illustration in lookup order', () => {
  const start = calls.list.length;
  withCanvases(-1, events => {
    initManualArt();
    assert.deepEqual(events, ids.flatMap(id => [['lookup', id], ['context', id, '2d']]));
  });
  const drawn = calls.list.slice(start);
  assert.ok(drawn.some(c => c[0] === 'translate' && c[1] === 28 && c[2] === 30));
  assert.ok(drawn.some(c => c[0] === 'fillText' && c[1] === '83%'));
  assert.ok(drawn.some(c => c[0] === 'translate' && c[1] === 27 && c[2] === 27));
  assert.ok(drawn.some(c => c[0] === 'rect' && c[1] === -3.5 && c[2] === 5.25 && c[3] === 7 && c[4] === 15.75));
  assert.ok(drawn.some(c => c[0] === 'createRadialGradient'));
  assert.ok(drawn.some(c => c[0] === 'ellipse' && c[1] === 0 && c[2] === 0 && c[3] === 10 && c[4] === 15));
  assert.ok(drawn.filter(c => c[0] === 'arc').length >= 3);
});

for (let i = 0; i < ids.length; i++){
  test(`manual art stops at an unavailable ${ids[i]} context`, () => {
    withCanvases(i, events => {
      assert.throws(() => initManualArt(), { message: errors[i] });
      assert.deepEqual(events, ids.slice(0, i + 1).flatMap(id => [['lookup', id], ['context', id, '2d']]));
    });
  });
}
