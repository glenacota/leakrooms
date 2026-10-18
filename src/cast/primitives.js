export const TAU = Math.PI * 2;

export function limb(g, x1, y1, x2, y2, w, col) {
  g.strokeStyle = col;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  g.lineCap = 'butt';
}

export function blob(g, cx, cy, rx, ry, col, rot) {
  g.fillStyle = col;
  g.beginPath(); g.ellipse(cx, cy, rx, ry, rot || 0, 0, TAU); g.fill();
}

/* One stride: `s` is the fore/aft offset of the leading foot, `liftL`/`liftR`
   are how high each foot is off the carpet, `bob` is the body rise that comes
   with two steps. gait=0 collapses all of it to zero, so an idle sprite is
   symmetric without any special case. */
export function stride(S) {
  const k = S.gait || 0;
  const p = S.phase * TAU;
  const s = Math.sin(p) * k;
  return { s, liftL: Math.max(0, s), liftR: Math.max(0, -s), bob: -Math.abs(Math.cos(p)) * 0.012 * k };
}

/* A rubber boot: shaft, then a sole that reaches forward of it. The sole is
   what reads as a foot from above, so it is drawn second and darker. */
export function boot(g, T, cx, cy, ang, sc, col, dark) {
  g.save();
  g.translate(cx, cy);
  g.rotate(ang);
  blob(g, 0, 0, 0.058 * sc * T, 0.078 * sc * T, col);
  blob(g, 0, -0.048 * sc * T, 0.052 * sc * T, 0.040 * sc * T, dark);
  g.restore();
}

/* The carpet is a saturated yellow and so is the vest. A dark rim is what
   keeps a figure from bleeding into the floor at game scale. */
export function rim(g, cx, cy, rx, ry) {
  g.strokeStyle = 'rgba(24,26,16,0.55)';
  g.lineWidth = 0.055 * (rx + ry) * 0.5 + 0.6;
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.stroke();
}

/* An arm from the shoulder to the hand. The shoulder sits BEHIND the centre
   of the body and the hand level with it, so the limb hangs along the flank:
   reaching further forward than this puts two pale blobs above the head, and
   from directly overhead a top-down figure with two blobs above its head is
   a rabbit. */
export function arm(g, T, side, cy, swing, col, handCol, reach) {
  const r = reach || 1;
  const sx = side * T * 0.155, sy = cy + T * 0.05;
  const ex = side * T * (0.17 + 0.02 * r), ey = cy + T * 0.01 + swing * T * 0.5;
  const hx = side * T * (0.10 + 0.04 * r), hy = cy - T * 0.055 + swing * T;
  limb(g, sx, sy, ex, ey, T * 0.066, col);
  limb(g, ex, ey, hx, hy, T * 0.056, col);
  blob(g, hx, hy, T * 0.038, T * 0.042, handCol);
}

/* Where both feet are, this frame. One plan, two consumers: the legs are
   drawn to it and the boots are drawn on it, so the legs cannot come apart
   from the boots — which is the usual way a hand-drawn walk cycle falls
   apart.

   It writes into two module-level scratch records rather than building and
   returning an array. Both consumers run back to back on the same sprite and
   nothing else reads the plan while either is drawing, so the scratch cannot
   be observed — and this ran twice per sprite per frame, allocating an array,
   an object and a `stride` result each time. Same numbers out; the shape is
   the only thing that changed. */
const FOOT_A = { s:0, x:0, y:0, ang:0, sc:1 };
const FOOT_B = { s:0, x:0, y:0, ang:0, sc:1 };
const FOOT_PLAN = [FOOT_A, FOOT_B];
export function footPlan(S, T, o) {
  const st = stride(S);
  const bob = st.bob * T + (o.bob || 0);
  const swing = o.swing || 0.045, liftK = o.lift || 0.06, turn = o.turn || 0.30;
  const y0 = o.y * T + bob, sc = o.sc || 1, sep = o.sep * T;
  for (let n=0; n<2; n++){
    const s = n===0 ? -1 : 1;
    const f = n===0 ? FOOT_A : FOOT_B;
    const lift = s > 0 ? st.liftR : st.liftL;
    f.s = s;
    f.x = s * sep;
    f.y = y0 - st.s * s * T * swing - lift * liftK * T;
    f.ang = -s * st.s * turn;
    f.sc = sc;
  }
  return FOOT_PLAN;
}

export function feet(g, T, S, o) {
  const plan = footPlan(S, T, o);
  for (let n=0;n<2;n++){ const f=plan[n]; boot(g, T, f.x, f.y, f.ang, f.sc, o.col, o.dark); }
}

export function legs(g, T, S, o) {
  const plan = footPlan(S, T, o);
  const w = T * (o.w || 0.10);
  for (let n=0;n<2;n++){ const f=plan[n];
    limb(g, f.s * o.hipSep * T, o.hipY * T, f.x, f.y + T * 0.035, w, o.col); }
}

/* THE AVATAR — the Rigger. Hard hat, hi-vis vest with two reflective bands
   that slide fore and aft on the stride, tool belt, and a wrench that swings
   with the walk. Local -y is forward: the boots lead, the hat brim trails. */
