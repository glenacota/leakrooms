import { TAU, blob, rim, arm, feet, legs, stride } from './primitives.js';

/* THE AVATAR: the Plumber, in a yellow hazmat suit. Hooded head with a visor,
   two reflective bands that slide fore and aft on the stride, taped gloves, and
   a wrench that swings with the walk. Local -y is forward: the boots and the
   visor lead. */
const SUIT = '#e8c11f', SUIT_TRIM = '#b88e12', GLOVE = '#c8501f', VISOR = '#2d5560';
export function drawPlumber(g, S) {
  const T = S.T, st = stride(S);
  const hip = st.bob * T;

  feet(g, T, S, { sep:0.088, y:-0.085, bob:hip, col:'#4a3a22', dark:'#2f2515', lift:0.06, sc:0.9 });

  // work trousers
  legs(g, T, S, { sep:0.105, y:-0.135, bob:hip, hipSep:0.072, hipY:-0.02, col:SUIT, w:0.095 });

  // the suit, with a front zip
  blob(g, 0, T * 0.025 + hip, T * 0.155, T * 0.115, SUIT);
  rim(g, 0, T * 0.025 + hip, T * 0.155, T * 0.115);
  g.strokeStyle = SUIT_TRIM; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, -T * 0.07 + hip); g.lineTo(0, T * 0.12 + hip); g.stroke();
  // reflective bands, offset by the stride
  const off = st.s * T * 0.018;
  g.fillStyle = 'rgba(236,238,196,0.85)';
  g.fillRect(-T * 0.15, T * 0.05 + hip - off, T * 0.30, T * 0.022);
  g.fillRect(-T * 0.15, T * 0.10 + hip - off, T * 0.30, T * 0.022);

  // arms, and a wrench hanging off the belt that swings with the walk
  for (const s of [-1, 1]) arm(g, T, s, T * 0.035 + hip, -st.s * 0.05 * s, SUIT, GLOVE);
  g.save();
  g.translate(T * 0.14, T * 0.10 + hip); g.rotate(-0.4 + st.s * 0.5);
  g.fillStyle = '#7d8288';
  g.fillRect(-T * 0.015, 0, T * 0.03, T * 0.11);
  g.beginPath(); g.arc(0, T * 0.11, T * 0.028, 0, TAU); g.fill();
  g.restore();

  // hood with a visor on the leading side
  blob(g, 0, T * 0.055 + hip, T * 0.10, T * 0.10, SUIT);
  rim(g, 0, T * 0.055 + hip, T * 0.10, T * 0.10);
  g.strokeStyle = SUIT_TRIM; g.lineWidth = 0.9;
  g.beginPath(); g.moveTo(0, T * 0.155 + hip); g.lineTo(0, T * 0.08 + hip); g.stroke();   // hood seam
  blob(g, 0, T * 0.027 + hip, T * 0.062, T * 0.045, VISOR);
  blob(g, -T * 0.02, T * 0.012 + hip, T * 0.022, T * 0.012, 'rgba(190,236,244,0.75)');
}