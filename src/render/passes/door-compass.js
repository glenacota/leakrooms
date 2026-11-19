/* ============================================================
   DOOR COMPASS
   A green chevron pinned to the edge of the screen, pointing at the exit door.
   It shows while the radar is on, and also while leaks are still open
   (openLeaks > 0), so a player who is lost in the dark always has a bearing.
   Once every leak is sealed it shows until the plumber reaches the door.

   Screen space, drawn last in device pixels, so the lighting, the vision mask
   and the post effects never cover it. Draws nothing and touches no context
   state when hidden, so frames without the cue cost nothing.
   ============================================================ */

import { G } from '../../sim/state.js';
import { ctx, DPR } from '../canvas.js';
import { DOOR_REACH } from '../../config/constants.js';

const GREEN = '#8fd07a';
const INK = '#0c0e0a';
/* Distance from the screen edge to the chevron, in CSS pixels. Keeps it clear
   of the canvas border and the vignette. */
const EDGE_MARGIN = 26;
const CHEVRON = 13;
const LABEL_PX = 11;
/* Seconds for the cue to fade in and out. A short fade stops it popping in
   the moment the radar is pressed or the last leak seals. */
const FADE_IN = 0.2;
const FADE_OUT = 0.35;
/* Pulse and bob speeds in radians per second. Slow enough not to flicker. */
const PULSE_SPEED = 4;
const BOB_SPEED = 5;
const BOB_CSS = 2.5;

let alpha = 0;

/* The door reach test, the same as the one that starts the door hold. */
function atDoor(){
  const p = G.plumber;
  for (const e of G.exitTiles){
    if (Math.hypot(e.x + 0.5 - p.x, e.y + 0.5 - p.y) < DOOR_REACH) return true;
  }
  return false;
}

/* Whether the cue should be showing at all. Radar always shows it; without
   the radar it shows only while leaks are open or sealed-but-not-at-the-door. */
function wanted(){
  if (G.radar) return true;
  return G.openLeaks === 0 && !atDoor();
}

/**
 * Draws the door compass. Called once per frame from render(), after the
 * diegetic HUD, in device space.
 *
 * @param {object} rc - the render frame context.
 */
export function doorCompass(rc){
  const on = wanted();
  alpha = on ? Math.min(1, alpha + rc.dt / FADE_IN) : Math.max(0, alpha - rc.dt / FADE_OUT);
  if (alpha <= 0) return;

  const {p} = rc;
  const door = G.exitTiles[0];
  if (!door) return;

  /* Work in device pixels. w2sx and w2sy take tile coordinates and return
     device pixels, so the plumber's and the door's screen positions come
     straight from the frame's mapping. */
  const px = rc.w2sx(p.x), py = rc.w2sy(p.y);
  const dxT = door.x + 0.5, dyT = door.y + 0.5;
  const dx = rc.w2sx(dxT) - px, dy = rc.w2sy(dyT) - py;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;

  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const m = EDGE_MARGIN * DPR;
  const left = m, right = cw - m, top = m, bottom = ch - m;

  /* Walk from the plumber toward the door until the ray leaves the margin
     box. Each axis gives a distance; the nearer one is the edge. A door
     already inside the box is reached first, so the cue sits on it. */
  const tx = ux > 0 ? (right - px) / ux : ux < 0 ? (left - px) / ux : Infinity;
  const ty = uy > 0 ? (bottom - py) / uy : uy < 0 ? (top - py) / uy : Infinity;
  const s = Math.max(0, Math.min(tx, ty, len));

  const pulse = 0.5 + 0.5 * Math.sin(rc.t / 1000 * PULSE_SPEED);
  const bob = Math.sin(rc.t / 1000 * BOB_SPEED) * BOB_CSS * DPR;
  const x = px + dx * (s / len) + ux * bob;
  const y = py + dy * (s / len) + uy * bob;
  const ang = Math.atan2(dy, dx);
  const size = CHEVRON * DPR;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = alpha;

  /* A soft glow behind the chevron, so it reads on the dark floor. */
  const glowR = 34 * DPR;
  const g = ctx.createRadialGradient(x, y, 2 * DPR, x, y, glowR);
  g.addColorStop(0, `rgba(143,208,122,${0.35 + 0.25 * pulse})`);
  g.addColorStop(1, 'rgba(143,208,122,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, glowR, 0, Math.PI * 2); ctx.fill();

  /* The chevron, pointing along the bearing. */
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.7, -size * 0.9);
  ctx.lineTo(-size * 0.2, 0);
  ctx.lineTo(-size * 0.7, size * 0.9);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.5 * DPR;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = GREEN;
  ctx.fill();
  ctx.restore();

  /* Straight-line distance to the door, in tiles. Not the walking distance:
     the cue points the way, it does not plan the route. */
  const dist = Math.round(len / rc.T);
  const labelOff = 34 * DPR;
  ctx.font = `bold ${LABEL_PX * DPR}px "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3 * DPR;
  ctx.strokeStyle = 'rgba(12,14,10,0.9)';
  const lx = x - ux * labelOff, ly = y - uy * labelOff;
  ctx.strokeText(`DOOR ${dist}`, lx, ly);
  ctx.fillStyle = GREEN;
  ctx.fillText(`DOOR ${dist}`, lx, ly);
  ctx.restore();
}
