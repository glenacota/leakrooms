import test from 'node:test';
import { strict as assert } from 'node:assert';
import { loadGame } from '../helpers/harness.js';
import { emit, on, EVENT } from '../../src/util/events.js';
import { MAP } from '../../src/config/constants.js';
import { clearInput } from '../../src/sim/keys.js';
import { FACE, pipeFlipped, pipeLayout, PIPE_FACE_BOTTOM } from '../../src/render/pipe-layout.js';

const { A, G, calls } = await loadGame();
const { tickLoudFlash } = await import('../../src/ui/hints.js');
const { cam } = await import('../../src/render/render.js');

const sparkColor = 'rgba(255,246,190,';
function sparkPaths(){
  const paths = [];
  for (let i = 0; i < calls.list.length; i++){
    const fill = calls.list[i];
    if (fill[0] !== 'fill' || typeof fill.style !== 'string' ||
        !fill.style.startsWith(sparkColor)) continue;
    let moveIndex = i-1;
    while (moveIndex >= 0 && calls.list[moveIndex][0] !== 'moveTo') moveIndex--;
    const move = calls.list[moveIndex];
    const lines = calls.list.slice(moveIndex+1, i).filter(call => call[0] === 'lineTo');
    paths.push({ move, lines });
  }
  return paths;
}
function splitWorldPixels(leak){
  const { dropFrom } = pipeLayout(pipeFlipped(leak.x, leak.y));
  return {
    x: (leak.x + dropFrom.x)*MAP.TILE_SIZE_PX,
    y: (leak.y + PIPE_FACE_BOTTOM - FACE + dropFrom.y)*MAP.TILE_SIZE_PX,
  };
}

test('sealing emits one burst and one camera cue', () => {
  A.buildFloor(0, 1234);
  const leak = G.leaks[0];
  const bursts = [], shakes = [];
  const offBurst = on(EVENT.sealBurst, (...args) => bursts.push(args));
  const offShake = on(EVENT.cameraShake, cue => shakes.push(cue));
  const before = A.getParticleCount();

  A.sealLeak(leak);
  A.sealLeak(leak);

  offBurst();
  offShake();
  assert.deepEqual(bursts, [[leak.x+0.5, leak.y+0.5]]);
  assert.deepEqual(shakes, ['seal']);
  assert.equal(A.getParticleCount(), before+12);
});

test('repair tick is safe while the plumber is away from every leak', () => {
  A.buildFloor(0, 1234);
  G.plumber.x = 1000;
  G.plumber.y = 1000;
  assert.doesNotThrow(() => A.tickRepair(1/60, false, false));
});

test('repair sparks stay visible only during the real active-repair path', () => {
  A.buildFloor(0, 1234);
  const leak = G.leaks[0];
  clearInput();
  G.lifeforms.length = 0;
  G.plumber.x = leak.sx+0.5;
  G.plumber.y = leak.sy+0.5;
  cam.x = G.plumber.x;
  cam.y = G.plumber.y;
  const sparkSignals = [], clears = [];
  const offSpark = on(EVENT.repairSpark, (...args) => sparkSignals.push(args));
  const offClear = on(EVENT.repairSparksClear, () => clears.push(true));
  const dt = 1/60;
  let t = 1000;

  try {
    for (let frame = 0; frame < 60; frame++){
      A.update(dt);
      assert.equal(leak.repairing, true, 'the plumber remains in active repair');
      if (frame === 0){
        assert.deepEqual(sparkSignals, [[leak.x, leak.y]],
          'repair starts by emitting the pipe wall tile immediately');
      }
      calls.list.length = 0;
      A.render(t);
      const paths = sparkPaths();
      assert.ok(paths.length >= 3, `sparks draw on stationary repair frame ${frame}`);
      if (frame === 0){
        const split = splitWorldPixels(leak);
        for (const { move, lines } of paths.slice(0, 3)){
          assert.equal(lines.length, 7, 'each sparkle is a pointed glint, not a circle');
          const bottom = lines[3];
          const centerX = (move[1]+bottom[1])/2;
          const centerY = (move[2]+bottom[2])/2;
          const distance = Math.hypot(centerX-split.x, centerY-split.y);
          assert.ok(distance > 0 && distance < 3,
            `spark shoots outward from the pipe split (offset ${distance.toFixed(2)}px)`);
        }
      }
      t += 1000/60;
    }
    assert.ok(sparkSignals.length >= 2, 'sparks are regenerated while repair remains active');
    assert.ok(sparkSignals.every(([x,y]) => x === leak.x && y === leak.y),
      'every cluster refers to the same wall pipe tile');
    assert.ok(leak.repair < A.REPAIR_TIME, 'the leak remains unsealed during the test');

    const tileX = Math.floor(G.plumber.x), tileY = Math.floor(G.plumber.y);
    const move = [
      ['d', 1, 0], ['a', -1, 0], ['s', 0, 1], ['w', 0, -1],
    ].find(([,dx,dy]) => G.grid[(tileY+dy)*MAP.WIDTH_TILES + tileX+dx] === 1);
    assert.ok(move, 'the repair spot has a walkable neighboring tile');
    A.keys[move[0]] = true;
    A.update(dt);
    assert.equal(G.plumber.moving, true);
    assert.equal(leak.repairing, false);
    assert.equal(A.getParticleCount('repair'), 0, 'interruption clears existing repair sparks');
    const signalsAtStop = sparkSignals.length;
    calls.list.length = 0;
    A.render(t);
    assert.equal(sparkPaths().length, 0, 'no sparks draw while moving by the pipe');
    assert.equal(sparkSignals.length, signalsAtStop, 'movement emits no new spark cluster');

    clearInput();
    A.update(dt);
    assert.equal(leak.repairing, true, 'standing still resumes repair');
    assert.equal(A.getParticleCount('repair'), 3, 'a new cluster appears immediately on resume');

    leak.repair = A.REPAIR_TIME-dt;
    A.update(dt);
    assert.equal(leak.fixed, true, 'repair seals the leak');
    assert.equal(A.getParticleCount('repair'), 0, 'sealing clears repair sparks');
    calls.list.length = 0;
    A.render(t+1000/60);
    assert.equal(sparkPaths().length, 0, 'no repair sparks draw after sealing');
    assert.ok(clears.length >= 2, 'interruption and sealing both clear sparks');
  } finally {
    clearInput();
    offSpark();
    offClear();
  }
});

test('first loud threshold still flashes once when flash is on', () => {
  const oldNoise = G.selfNoise;
  const flashes = [];
  const off = on(EVENT.flash, flash => flashes.push(flash));
  G.selfNoise = A.NOISE.LOUD;
  emit(EVENT.state, 'splash');
  tickLoudFlash();
  tickLoudFlash();
  off();
  G.selfNoise = oldNoise;
  assert.equal(flashes.length, 1);
});

test('particle pool stays capped and prioritizes seal bursts over repair sparks', () => {
  while (A.getParticleCount() < A.MAX_PARTICLES)
    emit(EVENT.particle, 10, 10);
  assert.equal(A.getParticleCount(), A.MAX_PARTICLES);

  const sparksBefore = A.getParticleCount('repair');
  emit(EVENT.repairSpark, 10, 10);
  assert.equal(A.getParticleCount(), A.MAX_PARTICLES);
  assert.equal(A.getParticleCount('repair'), sparksBefore+3);

  const sealsBefore = A.getParticleCount('seal');
  emit(EVENT.sealBurst, 10, 10);
  assert.equal(A.getParticleCount(), A.MAX_PARTICLES);
  assert.equal(A.getParticleCount('seal'), sealsBefore+12);
});
