import { TAU, limb, blob } from './primitives.js';
import { CATCH_R } from '../config/constants.js';

/* The four legs, as two flat arrays: which side each leg is on, and its phase
   offset in the walk cycle. The table is constant, so it is built once here and
   not rebuilt for every Stalker on every frame. */
const STALKER_SIDE = [-1, 1, -1, 1];
const STALKER_PH   = [0, Math.PI, Math.PI*0.55, Math.PI*0.55];

/* THE LIFEFORM: the Stalker. Four thick black legs under a small glossy body,
   roughly TWICE the size of the avatar: the Rigger stands about a quarter of a
   tile tall and half a tile wide, and this is about half a tile tall and three
   quarters across. It does not grow as it approaches. It is compact and simply
   already there. Its legs reach further than its body, which is why the floor is
   clipped under it (see drawAgent): an unclipped leg over a partition reads as
   walking through walls. The origin is the feet; it grows upward. */
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

  /* Pops the save() at the top of this function. Every save needs its own
     restore. Canvas states are last-in first-out, so a missing one here would
     make drawAgent's two restores pop the wrong pair, leave its floor clip
     active, and clip the player (drawn after it) to the tiles around the
     Stalker. The render test checks that no save outlives a frame. */
  g.restore();
  g.globalAlpha = 1;
}