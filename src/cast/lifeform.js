import { TAU, limb, blob } from './primitives.js';
import { CATCH_RADIUS_TILES } from '../config/constants.js';

// specify which side each leg is on and its phase offset in the walk cycle
const LIFEFORM_LEGS = [-1, 1, -1, 1];
const LIFEFORM_PH   = [0, Math.PI, Math.PI*0.55, Math.PI*0.55];

/* The lifeform has four thick black legs under a small glossy body,
   and it's ca. 4x the size of a plumber. */
export function drawLifeform(g, S) {
  const T = S.T, t = S.t;
  const HGT = T * 0.75;
  g.globalAlpha = Math.min(1, 0.30 + S.h * 0.70);
  g.save();
  const s = Math.sin(S.phase * TAU) * (S.gait || 0);

  const danger = S.danger || 0;
  drawCatchRadius(g, T, danger);
  drawLegs(g, T, S, HGT);
  const pitch = s * T * 0.03;
  drawBody(g, T, t, HGT, pitch);

  /* Pops the save() at the top of this function (every save needs its own restore). */
  g.restore();
  g.globalAlpha = 1;
}

function drawCatchRadius(g, T, danger){
  blob(g, 0, 0, T * CATCH_RADIUS_TILES, T * CATCH_RADIUS_TILES * 0.92, `rgba(18,20,14,${0.20 + 0.14 * danger})`);
  g.strokeStyle = `rgba(216,80,60,${0.20 + 0.34 * danger})`;
  g.lineWidth = 2;
  g.beginPath(); g.ellipse(0, 0, T * CATCH_RADIUS_TILES, T * CATCH_RADIUS_TILES * 0.92, 0, 0, TAU); g.stroke();
}

function drawLegs(g, T, S, hgt){
  for (let i = 0; i < 4; i++) {
    const side = LIFEFORM_LEGS[i], ph = LIFEFORM_PH[i];
    const sw = Math.sin(S.phase * TAU + ph) * (S.gait || 0);
    const footX = side * T * (0.30 + sw * 0.10);
    const footY = -hgt * 0.06 + Math.cos(S.phase * TAU + ph) * T * 0.09 * (S.gait || 0);
    const hipX = side * T * 0.10, hipY = -hgt * 0.62;
    const kneeX = side * T * (0.22 + sw * 0.06);
    const kneeY = -hgt * 0.34;
    limb(g, hipX, hipY, kneeX, kneeY, T * 0.095, '#0e0e0d');
    limb(g, kneeX, kneeY, footX, footY, T * 0.070, '#0e0e0d');
    g.strokeStyle = '#0e0e0d'; g.lineWidth = T * 0.035; g.lineCap = 'round';
    for (const k of [-0.4, 0, 0.4]) {
      g.beginPath();
      g.moveTo(footX, footY);
      g.lineTo(footX + Math.sin(k) * T * 0.08, footY - T * 0.08 + Math.abs(k) * T * 0.02);
      g.stroke();
    }
    g.lineCap = 'butt';
  }
}

function drawBody(g, T, t, hgt, pitch){
  g.save();
  g.translate(pitch, 0);
  blob(g, 0, -hgt * 0.72, T * 0.20, T * 0.15, '#121211');
  blob(g, -T * 0.15, -hgt * 0.84, T * 0.10, T * 0.08, '#151514');
  blob(g, T * 0.16, -hgt * 0.80, T * 0.12, T * 0.09, '#151514');
  blob(g, 0, -hgt * 0.92, T * 0.10, T * 0.08, '#181817');
  g.fillStyle = `rgba(228,230,168,${0.10 + 0.05 * Math.sin(t * 0.004)})`;
  g.beginPath(); g.ellipse(-T * 0.045, -hgt * 0.75, T * 0.045, T * 0.017, -0.5, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(T * 0.055, -hgt * 0.86, T * 0.035, T * 0.014, -0.4, 0, TAU); g.fill();
  g.restore();
}
