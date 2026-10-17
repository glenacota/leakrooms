import { TAU, limb, blob } from './primitives.js';
import { CATCH_R } from '../config/constants.js';
const STALKER_SIDE = [-1, 1, -1, 1];
const STALKER_PH   = [0, Math.PI, Math.PI*0.55, Math.PI*0.55];
export function drawStalker(g, S) {
  const T = S.T, t = S.t;
  const HGT = T * 0.75;
  g.globalAlpha = Math.min(1, 0.30 + S.h * 0.70);
  g.save();
  const s = Math.sin(S.phase * TAU) * (S.gait || 0);
  const legs = STALKER_SIDE;

  /* THE HIT ZONE, drawn first so the legs and body stand on it. brush() is
     fatal at CATCH_R tiles and nothing on screen said so: the legs reached
     further than the kill radius and the body was smaller than it, so the part
     that could touch you was invisible. This disc IS the kill radius. */
  const danger = S.danger || 0;
  blob(g, 0, 0, T * CATCH_R, T * CATCH_R * 0.92, `rgba(18,20,14,${0.20 + 0.14 * danger})`);
  g.strokeStyle = `rgba(216,80,60,${0.20 + 0.34 * danger})`;
  g.lineWidth = 2;
  g.beginPath(); g.ellipse(0, 0, T * CATCH_R, T * CATCH_R * 0.92, 0, 0, TAU); g.stroke();

  for (let i = 0; i < 4; i++) {
    const side = legs[i], ph = STALKER_PH[i];
    const sw = Math.sin(S.phase * TAU + ph) * (S.gait || 0);
    const footX = side * T * (0.30 + sw * 0.10);
    const footY = -HGT * 0.06 + Math.cos(S.phase * TAU + ph) * T * 0.09 * (S.gait || 0);
    const hipX = side * T * 0.10, hipY = -HGT * 0.62;
    // knee: out to the side and below the hip line, so the leg reads bent
    const kneeX = side * T * (0.22 + sw * 0.06);
    const kneeY = -HGT * 0.34;
    limb(g, hipX, hipY, kneeX, kneeY, T * 0.095, '#0e0e0d');
    limb(g, kneeX, kneeY, footX, footY, T * 0.070, '#0e0e0d');
    // three-toed foot, the shape that says "not a boot"
    g.strokeStyle = '#0e0e0d'; g.lineWidth = T * 0.035; g.lineCap = 'round';
    for (const k of [-0.4, 0, 0.4]) {
      g.beginPath();
      g.moveTo(footX, footY);
      g.lineTo(footX + Math.sin(k) * T * 0.08, footY - T * 0.08 + Math.abs(k) * T * 0.02);
      g.stroke();
    }
    g.lineCap = 'butt';
  }

  // body: a glossy black mass with two lobed shoulders
  const pitch = s * T * 0.03;
  g.save();
  g.translate(pitch, 0);
  blob(g, 0, -HGT * 0.72, T * 0.20, T * 0.15, '#121211');
  blob(g, -T * 0.15, -HGT * 0.84, T * 0.10, T * 0.08, '#151514');
  blob(g, T * 0.16, -HGT * 0.80, T * 0.12, T * 0.09, '#151514');
  blob(g, 0, -HGT * 0.92, T * 0.10, T * 0.08, '#181817');
  // wet highlights: the sheen is what makes it liquid rather than matte
  g.fillStyle = `rgba(228,230,168,${0.10 + 0.05 * Math.sin(t * 0.004)})`;
  g.beginPath(); g.ellipse(-T * 0.045, -HGT * 0.75, T * 0.045, T * 0.017, -0.5, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(T * 0.055, -HGT * 0.86, T * 0.035, T * 0.014, -0.4, 0, TAU); g.fill();
  g.restore();   // the body pitch

  /* Pop the save() at the top of this function. Without it the Stalker leaks
     one canvas state per frame, and because the states are LIFO the damage is
     not confined to itself: drawAgent's two restores then pop the WRONG pair,
     so its floor clip survives past drawAgent and the player — drawn after it
     in the y-sort — is clipped to the five tiles around the Stalker. The
     Rigger therefore vanished whenever a Lifeform happened to sort north of
     it, which is every frame in the bottom half of a floor. */
  g.restore();
  g.globalAlpha = 1;
}
