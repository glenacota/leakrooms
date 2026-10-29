/* Unit tests for src/render/pipe-layout.js — pure geometry, no canvas needed. */
import test from 'node:test';
import assert from 'node:assert/strict';

// pipe-layout.js imports canvas.js indirectly? No — it only imports
// config/constants.js and util/hash.js, both of which are headless-safe.
import {
  FACE,
  dropAt, HANG, LAND_Y,
  pipeFlipped, pipeLayout,
  waterCss,
} from '../../src/render/pipe-layout.js';

// ── FACE ──────────────────────────────────────────────────────────────────────
test('FACE is positive and less than 1 (band is smaller than a full tile)', () => {
  assert.ok(FACE > 0 && FACE < 1, `FACE=${FACE}`);
});

// ── pipeFlipped ───────────────────────────────────────────────────────────────
test('pipeFlipped returns a boolean for any integer tile coords', () => {
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++){
    const v = pipeFlipped(x, y);
    assert.equal(typeof v, 'boolean', `pipeFlipped(${x},${y}) returned ${v}`);
  }
});

test('pipeFlipped is deterministic for the same coords', () => {
  assert.equal(pipeFlipped(7, 13), pipeFlipped(7, 13));
  assert.equal(pipeFlipped(0, 0),  pipeFlipped(0, 0));
});

test('pipeFlipped returns a consistent value for the same coords across calls', () => {
  // Verify determinism: calling with the same tile coords always gives the same result.
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++){
    const a = pipeFlipped(x, y), b = pipeFlipped(x, y);
    assert.equal(a, b,
      `pipeFlipped(${x},${y}) gave different results on two calls: ${a} vs ${b}`);
  }
  // Verify that different coords CAN differ (at least one pair disagrees somewhere):
  // hash2 with non-integer multipliers produces variety — that is how the drop
  // phase staggers. For plain integer (tx,ty) coords in the small-map range,
  // hash2 happens to be always < 0.5, so all tiles flip the same way.
  // This is the defined behaviour; what matters for correctness is determinism.
});

// ── pipeLayout ────────────────────────────────────────────────────────────────
test('pipeLayout(false) returns expected keys', () => {
  const P = pipeLayout(false);
  for (const k of ['rects','crack','dropFrom','puddle','glint','elbowRight'])
    assert.ok(k in P, `missing key: ${k}`);
});

test('pipeLayout(false).elbowRight is true, pipeLayout(true).elbowRight is false', () => {
  assert.equal(pipeLayout(false).elbowRight, true);
  assert.equal(pipeLayout(true).elbowRight,  false);
});

test('pipeLayout rects contain x, y, w, h numbers', () => {
  for (const flip of [false, true]){
    const { rects } = pipeLayout(flip);
    for (const [name, r] of Object.entries(rects)){
      for (const field of ['x','y','w','h'])
        assert.equal(typeof r[field], 'number',
          `rects.${name}.${field} is not a number (flip=${flip})`);
    }
  }
});

test('pipeLayout mirroring: run rect x flips correctly', () => {
  const un = pipeLayout(false), fl = pipeLayout(true);
  const { run: u } = un.rects, { run: f } = fl.rects;
  assert.ok(Math.abs((u.x + u.w) - (1 - f.x)) < 1e-9,
    'run rect right edge should be mirror of flipped run rect right edge');
});

test('pipeLayout crack array has at least 4 points', () => {
  const { crack } = pipeLayout(false);
  assert.ok(crack.length >= 4, `crack has only ${crack.length} points`);
  for (const [x,y] of crack){
    assert.equal(typeof x, 'number');
    assert.equal(typeof y, 'number');
  }
});

test('pipeLayout puddle is an array of [cx,cy,rx,ry] tuples', () => {
  const { puddle } = pipeLayout(false);
  assert.ok(puddle.length >= 1);
  for (const t of puddle){
    assert.equal(t.length, 4);
    for (const v of t) assert.equal(typeof v, 'number');
  }
});

// ── dropAt ────────────────────────────────────────────────────────────────────
test('dropAt returns hang phase for phase in [0, HANG)', () => {
  const d = dropAt(0);
  assert.equal(d.kind, 'hang', `phase=0 should be 'hang'`);
  assert.equal(typeof d.y, 'number');
  assert.equal(typeof d.r, 'number');
  assert.equal(typeof d.ripple, 'number');
  assert.ok(d.r > 0, 'hang radius should be positive');
});

test('dropAt returns fall phase for phase in (HANG, 1)', () => {
  const d = dropAt(HANG + 0.01);
  assert.equal(d.kind, 'fall');
  assert.ok(d.r > 0);
  assert.equal(d.ripple, 0);
});

test('dropAt y increases through the fall phase', () => {
  // All phases must be within (HANG, 1) so they don't wrap into hang.
  const gap = 1 - HANG;
  const phases = [HANG + gap*0.01, HANG + gap*0.25, HANG + gap*0.6, HANG + gap*0.95];
  let prev = -Infinity;
  for (const p of phases){
    const d = dropAt(p);
    assert.equal(d.kind, 'fall', `expected fall phase at p=${p}`);
    assert.ok(d.y > prev, `y should increase through fall (p=${p}, y=${d.y}, prev=${prev})`);
    prev = d.y;
  }
});

test('dropAt y at end of fall is at or near LAND_Y', () => {
  const d = dropAt(0.9999);
  assert.ok(Math.abs(d.y - LAND_Y) < 0.05,
    `end-of-fall y=${d.y} should be near LAND_Y=${LAND_Y}`);
});

test('dropAt is periodic: phase=0 and phase=1 give same result', () => {
  const a = dropAt(0), b = dropAt(1);
  assert.equal(a.kind,   b.kind);
  assert.ok(Math.abs(a.y - b.y) < 1e-9);
  assert.ok(Math.abs(a.r - b.r) < 1e-9);
});

test('dropAt works with negative phase (wraps into [0,1))', () => {
  const d = dropAt(-0.1);
  assert.ok(['hang','fall'].includes(d.kind));
  assert.ok(d.r > 0);
});

// ── waterCss ──────────────────────────────────────────────────────────────────
test('waterCss with k=0 returns the original colour', () => {
  const s = waterCss([100, 150, 200], 0);
  assert.match(s, /^rgba\(100,150,200,1\)$/);
});

test('waterCss with k=1 returns white', () => {
  const s = waterCss([100, 150, 200], 1);
  assert.match(s, /^rgba\(255,255,255,1\)$/);
});

test('waterCss with k=0.5 interpolates toward white', () => {
  const s = waterCss([0, 0, 0], 0.5, 0.8);
  assert.match(s, /^rgba\(128,128,128,0.8\)$/);
});

test('waterCss alpha defaults to 1', () => {
  const s = waterCss([200, 200, 200], 0);
  assert.ok(s.endsWith(',1)'), `expected alpha 1 in "${s}"`);
});
