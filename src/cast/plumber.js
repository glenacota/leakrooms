import { TAU, blob, rim, arm, feet, legs, limb, stride } from './primitives.js';

/* THE AVATAR: the Plumber, in a yellow hazmat suit. Hooded head with a visor,
   two reflective bands that slide fore and aft on the stride, taped gloves, and
   a wrench that swings with the walk. Local -y is forward: the boots and the
   visor lead. */
const SUIT = '#e8c11f', SUIT_TRIM = '#b88e12', GLOVE = '#666', VISOR = '#000', WRENCH = '#7d8288', ARM_BORDER = 'rgba(24,26,16,0.55)';
export function drawPlumber(g, S) {
  const T = S.T, st = stride(S);
  const hip = st.bob * T;

  feet(g, T, S, { sep:0.088, y:-0.085, bob:hip, col:'#4a3a22', dark:'#2f2515', lift:0.06, sc:0.9 });

  // work trousers
  legs(g, T, S, { sep:0.105, y:-0.135, bob:hip, hipSep:0.072, hipY:-0.02, col:VISOR, w:0.095 });

  // the suit, with a front zip
  blob(g, 0, T * 0.025 + hip, T * 0.155, T * 0.115, SUIT);
  rim(g, 0, T * 0.025 + hip, T * 0.155, T * 0.115);
  g.strokeStyle = SUIT_TRIM; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, -T * 0.07 + hip); g.lineTo(0, T * 0.12 + hip); g.stroke();

  // arms, and a wrench hanging off the belt that swings with the walk
  const cy = T * 0.035 + hip, wk = S.wave || 0;
  // left arm: grey border underneath the suit limb
  limb(g, -T * 0.155, cy + T * 0.05, -T * 0.19, cy + T * 0.01 + st.s * 0.05 * T * 0.5, T * 0.086, ARM_BORDER);
  limb(g, -T * 0.19, cy + T * 0.01 + st.s * 0.05 * T * 0.5, -T * 0.14, cy - T * 0.055 + st.s * 0.05 * T, T * 0.073, ARM_BORDER);
  arm(g, T, -1, cy, st.s * 0.05, SUIT, GLOVE);
  // right arm: hanging normally, or raised and waving the wrench while repairing (wk 0 to 1)
  g.save();
  g.globalAlpha = 1 - wk;
  // right arm: grey border underneath the suit limb
  limb(g, T * 0.155, cy + T * 0.05, T * 0.19, cy + T * 0.01 - st.s * 0.05 * T * 0.5, T * 0.086, ARM_BORDER);
  limb(g, T * 0.19, cy + T * 0.01 - st.s * 0.05 * T * 0.5, T * 0.14, cy - T * 0.055 - st.s * 0.05 * T, T * 0.073, ARM_BORDER);
  arm(g, T, 1, cy, -st.s * 0.05, SUIT, GLOVE);
  g.globalAlpha = 1;
  g.translate(T * 0.14, T * 0.10 + hip); g.rotate(-0.4 + st.s * 0.5);
  g.fillStyle = WRENCH;
  g.fillRect(-T * 0.015, 0, T * 0.03, T * 0.11);
  g.beginPath(); g.arc(0, T * 0.11, T * 0.028, 0, TAU); g.fill();
  g.restore();
  if (wk > 0) {
    const sway = Math.sin(S.t * 0.014);
    const hx = T * (0.28 + 0.035 * sway), hy = cy - T * 0.24;
    g.save();
    g.globalAlpha = wk;
    limb(g, T * 0.155, cy + T * 0.05, T * 0.22, cy - T * 0.05, T * 0.086, ARM_BORDER);
    limb(g, T * 0.22, cy - T * 0.05, hx, hy, T * 0.073, ARM_BORDER);
    limb(g, T * 0.155, cy + T * 0.05, T * 0.22, cy - T * 0.05, T * 0.066, SUIT);
    limb(g, T * 0.22, cy - T * 0.05, hx, hy, T * 0.056, SUIT);
    blob(g, hx, hy, T * 0.038, T * 0.042, GLOVE);
    // the wrench held up, swaying side to side
    g.translate(hx, hy); g.rotate(sway * 0.5);
    g.fillStyle = WRENCH;
    g.fillRect(-T * 0.015, -T * 0.11, T * 0.03, T * 0.11);
    g.beginPath(); g.arc(0, -T * 0.11, T * 0.028, 0, TAU); g.fill();
    g.restore();
  }

  // hood with a visor on the leading side
  blob(g, 0, T * 0.055 + hip, T * 0.10, T * 0.10, SUIT);
  rim(g, 0, T * 0.055 + hip, T * 0.10, T * 0.10);
  g.strokeStyle = SUIT_TRIM; g.lineWidth = 0.01;
  g.beginPath(); g.moveTo(0, T * 0.155 + hip); g.lineTo(0, T * 0.08 + hip); g.stroke();   // hood seam
  blob(g, 0, T * 0.027 + hip, T * 0.062, T * 0.045, VISOR);
  blob(g, -T * 0.02, T * 0.032 + hip, T * 0.022, T * 0.012, 'rgba(190,236,244,0.75)');
}