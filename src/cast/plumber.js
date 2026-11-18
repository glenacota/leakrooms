import { TAU, blob, limb } from './primitives.js';

const SUIT = '#e8c11f';
const SUIT_TRIM = '#b88e12';
const GLOVE = '#666';
const VISOR = '#000';
const WRENCH = '#7d8288';
const ARM_BORDER = 'rgba(24,26,16,0.55)';

/* Feet and legs share one plan so they cannot come apart. Scratch records avoid
   allocation because both consumers run before the next sprite changes the plan. */
const FOOT_A = { s:0, x:0, y:0, ang:0, sc:1 };
const FOOT_B = { s:0, x:0, y:0, ang:0, sc:1 };
const FOOT_PLAN = [FOOT_A, FOOT_B];

// The plumber is a human in a yellow hazmat suit, seen from up above
export function drawPlumber(g, S) {
  const T = S.T, st = stride(S);
  const hip = st.bob * T;
  const cy = T * 0.035 + hip, wk = S.wave || 0;

  feet(g, T, S, { sep:0.088, y:-0.085, bob:hip, col:'#4a3a22', dark:'#2f2515', lift:0.06, sc:0.9 });
  legs(g, T, S, { sep:0.105, y:-0.135, bob:hip, hipSep:0.072, hipY:-0.02, col:VISOR, w:0.095 });
  drawSuit(g, T, hip);
  drawLeftArm(g, T, cy, st);
  drawRightArm(g, T, st, cy, wk, hip);
  drawRaisedWrench(g, T, S, cy, wk);
  drawHood(g, T, hip);
}

function drawSuit(g, T, hip){
  blob(g, 0, T * 0.025 + hip, T * 0.155, T * 0.115, SUIT);
  rim(g, 0, T * 0.025 + hip, T * 0.155, T * 0.115);
  g.strokeStyle = SUIT_TRIM; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, -T * 0.07 + hip); g.lineTo(0, T * 0.12 + hip); g.stroke();
}

function drawLeftArm(g, T, cy, st){
  limb(g, -T * 0.155, cy + T * 0.05, -T * 0.19, cy + T * 0.01 + st.s * 0.05 * T * 0.5, T * 0.086, ARM_BORDER);
  limb(g, -T * 0.19, cy + T * 0.01 + st.s * 0.05 * T * 0.5, -T * 0.14, cy - T * 0.055 + st.s * 0.05 * T, T * 0.073, ARM_BORDER);
  arm(g, T, -1, cy, st.s * 0.05, SUIT, GLOVE);
}

function drawRightArm(g, T, st, cy, wk, hip){
  g.save();
  g.globalAlpha = 1 - wk;
  limb(g, T * 0.155, cy + T * 0.05, T * 0.19, cy + T * 0.01 - st.s * 0.05 * T * 0.5, T * 0.086, ARM_BORDER);
  limb(g, T * 0.19, cy + T * 0.01 - st.s * 0.05 * T * 0.5, T * 0.14, cy - T * 0.055 - st.s * 0.05 * T, T * 0.073, ARM_BORDER);
  arm(g, T, 1, cy, -st.s * 0.05, SUIT, GLOVE);
  g.globalAlpha = 1;
  g.translate(T * 0.14, T * 0.10 + hip); g.rotate(-0.4 + st.s * 0.5);
  g.fillStyle = WRENCH;
  g.fillRect(-T * 0.015, 0, T * 0.03, T * 0.11);
  g.beginPath(); g.arc(0, T * 0.11, T * 0.028, 0, TAU); g.fill();
  g.restore();
}

function drawRaisedWrench(g, T, S, cy, wk){
  if (wk <= 0) return;
  const sway = Math.sin(S.t * 0.014);
  const hx = T * (0.12 + 0.02 * sway), hy = cy - T * 0.16;
  g.save();
  g.globalAlpha = wk;
  limb(g, T * 0.155, cy + T * 0.05, T * 0.22, cy - T * 0.05, T * 0.086, ARM_BORDER);
  limb(g, T * 0.22, cy - T * 0.05, hx, hy, T * 0.073, ARM_BORDER);
  limb(g, T * 0.155, cy + T * 0.05, T * 0.22, cy - T * 0.05, T * 0.066, SUIT);
  limb(g, T * 0.22, cy - T * 0.05, hx, hy, T * 0.056, SUIT);
  blob(g, hx, hy, T * 0.038, T * 0.042, GLOVE);
  g.translate(hx, hy); g.rotate(sway * 0.5);
  g.fillStyle = WRENCH;
  g.fillRect(-T * 0.015, -T * 0.07, T * 0.03, T * 0.07);
  g.beginPath(); g.arc(0, -T * 0.07, T * 0.028, 0, TAU); g.fill();
  g.restore();
}

function drawHood(g, T, hip){
  blob(g, 0, T * 0.055 + hip, T * 0.10, T * 0.10, SUIT);
  rim(g, 0, T * 0.055 + hip, T * 0.10, T * 0.10);
  g.strokeStyle = SUIT_TRIM; g.lineWidth = 0.01;
  g.beginPath(); g.moveTo(0, T * 0.155 + hip); g.lineTo(0, T * 0.08 + hip); g.stroke();
  blob(g, 0, T * 0.027 + hip, T * 0.062, T * 0.045, VISOR);
  blob(g, -T * 0.02, T * 0.032 + hip, T * 0.022, T * 0.012, 'rgba(190,236,244,0.75)');
}

/* Zero gait collapses stride values so idle sprites stay symmetric. */
function stride(S) {
  const k = S.gait || 0;
  const p = S.phase * TAU;
  const s = Math.sin(p) * k;
  return { s, liftL: Math.max(0, s), liftR: Math.max(0, -s), bob: -Math.abs(Math.cos(p)) * 0.012 * k };
}

function footPlan(S, T, o) {
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

function feet(g, T, S, o) {
  const plan = footPlan(S, T, o);
  for (let n=0;n<2;n++){
    const f = plan[n];
    boot(g, T, f.x, f.y, f.ang, f.sc, o.col, o.dark);
  }
}

function legs(g, T, S, o) {
  const plan = footPlan(S, T, o);
  const w = T * (o.w || 0.10);
  for (let n=0;n<2;n++){
    const f = plan[n];
    limb(g, f.s * o.hipSep * T, o.hipY * T, f.x, f.y + T * 0.035, w, o.col);
  }
}

function boot(g, T, cx, cy, ang, sc, col, dark) {
  g.save();
  g.translate(cx, cy);
  g.rotate(ang);
  blob(g, 0, 0, 0.058 * sc * T, 0.078 * sc * T, col);
  blob(g, 0, -0.048 * sc * T, 0.052 * sc * T, 0.040 * sc * T, dark);
  g.restore();
}

function rim(g, cx, cy, rx, ry) {
  g.strokeStyle = 'rgba(24,26,16,0.55)';
  g.lineWidth = 0.055 * (rx + ry) * 0.5 + 0.6;
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.stroke();
}

function arm(g, T, side, cy, swing, col, handCol, reach) {
  const r = reach || 1;
  const sx = side * T * 0.155, sy = cy + T * 0.05;
  const ex = side * T * (0.17 + 0.02 * r), ey = cy + T * 0.01 + swing * T * 0.5;
  const hx = side * T * (0.10 + 0.04 * r), hy = cy - T * 0.055 + swing * T;
  limb(g, sx, sy, ex, ey, T * 0.066, col);
  limb(g, ex, ey, hx, hy, T * 0.056, col);
  blob(g, hx, hy, T * 0.038, T * 0.042, handCol);
}
