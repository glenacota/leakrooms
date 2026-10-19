import { TAU, limb, blob, rim, arm, feet, legs, stride } from './primitives.js';

/* THE AVATAR: the Rigger. Hard hat, hi-vis vest with two reflective bands that
   slide fore and aft on the stride, tool belt, and a wrench that swings with the
   walk. Local -y is forward: the boots lead, the hat brim trails. */
export function drawRigger(g, S) {
  const T = S.T, st = stride(S);
  const hip = st.bob * T;

  feet(g, T, S, { sep:0.088, y:-0.085, bob:hip, col:'#4a3a22', dark:'#2f2515', lift:0.06, sc:0.9 });

  // work trousers
  legs(g, T, S, { sep:0.105, y:-0.135, bob:hip, hipSep:0.072, hipY:-0.02, col:'#4a4a52', w:0.095 });

  // vest over a grey tee
  blob(g, 0, T * 0.025 + hip, T * 0.155, T * 0.115, '#c8b25a');
  rim(g, 0, T * 0.025 + hip, T * 0.155, T * 0.115);
  g.fillStyle = '#8e8a72';
  g.beginPath(); g.ellipse(0, T * 0.045 + hip, T * 0.055, T * 0.075, 0, 0, TAU); g.fill();
  // reflective bands, offset by the stride
  const off = st.s * T * 0.018;
  g.fillStyle = 'rgba(236,238,196,0.85)';
  g.fillRect(-T * 0.15, T * 0.05 + hip - off, T * 0.30, T * 0.022);
  g.fillRect(-T * 0.15, T * 0.10 + hip - off, T * 0.30, T * 0.022);

  // arms, and a wrench hanging off the belt that swings with the walk
  for (const s of [-1, 1]) arm(g, T, s, T * 0.035 + hip, -st.s * 0.05 * s, '#8e8a72', '#c9a072');
  g.save();
  g.translate(T * 0.14, T * 0.10 + hip); g.rotate(-0.4 + st.s * 0.5);
  g.fillStyle = '#7d8288';
  g.fillRect(-T * 0.015, 0, T * 0.03, T * 0.11);
  g.beginPath(); g.arc(0, T * 0.11, T * 0.028, 0, TAU); g.fill();
  g.restore();

  // hard hat: dome plus a brim that leads
  blob(g, 0, T * 0.055 + hip, T * 0.10, T * 0.10, '#e8b62e');
  rim(g, 0, T * 0.055 + hip, T * 0.10, T * 0.10);
  blob(g, 0, T * 0.105 + hip, T * 0.115, T * 0.05, '#c9921f');
  g.strokeStyle = 'rgba(255,244,200,0.6)'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(-T * 0.07, T * 0.04 + hip); g.lineTo(T * 0.07, T * 0.04 + hip); g.stroke();
}