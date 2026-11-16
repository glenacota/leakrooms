import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';
import { buildDangerWash, buildVignette, post } from '../../src/render/passes/post.js';
import { setOption } from '../../src/settings/store.js';

const { A, G, calls } = await loadGame();

test('zero CRT skips tape rendering while preserving overlays and supports re-enabling', () => {
  A.buildFloor(0, 1234);
  G.seenBy = 0.5;
  buildVignette();
  buildDangerWash();
  const rc = { t: 1000, dt: 1 / 60 };

  function draw(crt, radar){
    assert.equal(setOption('crt', crt), true);
    G.radar = radar;
    calls.list.length = 0;
    post(rc);
    return calls.list.slice();
  }

  function assertDisabled(log){
    assert.equal(log.filter(c => c[0] === 'drawImage').length, 2, 'danger wash and vignette remain');
    assert.equal(log.some(c => c[0] === 'drawImage' && c[1] === A.cvs), false, 'no screen snapshot');
    assert.equal(log.some(c => c[0] === 'createLinearGradient'), false, 'no tracking band');
    assert.equal(log.some(c => c[0] === 'fillRect'), false, 'no CRT fills');
  }

  function assertEnabled(log){
    assert.equal(log.filter(c => c[0] === 'drawImage' && c[1] === A.cvs).length, 1, 'screen snapshot is copied');
    assert.equal(log.some(c => c[0] === 'createLinearGradient'), true, 'tracking band is drawn');
    assert.ok(log.filter(c => c[0] === 'drawImage').length >= 5, 'overlays, grain and ghost are drawn');
  }

  try {
    assertDisabled(draw(0, false));
    assertEnabled(draw(1, false));
    assertDisabled(draw(0, true));
    assertEnabled(draw(0.01, true));
  } finally {
    setOption('crt', 1);
    G.radar = false;
  }
});
