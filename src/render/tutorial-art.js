import { drawLifeform } from '../cast/lifeform.js';
import { drawPlumber } from '../cast/plumber.js';
import { MAP, MOVEMENT, WALL, WATER } from '../config/constants.js';
import { WATER_TINTS } from '../config/presets.js';
import { clockText } from '../game/run.js';
import { PAL } from '../config/palette.js';
import { SETTINGS } from '../settings/store.js';
import { G } from '../sim/state.js';
import { drawBatteryMeter } from './battery-meter.js';
import { drawDormantLifeform } from './entities.js';
import { surfaces, syncSurfaces } from './floor-surfaces.js';
import { drawTutorialLeak } from './passes/leaks.js';
import { drawStaminaMeter } from './stamina-meter.js';

function plumber(g, x, y){
  g.save();
  g.translate(x, y);
  drawPlumber(g, { T: MAP.TILE_SIZE_PX*2, phase: 0.25, gait: 0.6, t: 0, wave: 0 });
  g.restore();
}

/* Door and wall look copied straight from the gameplay renderers
   (src/render/passes/markers.js drawDoor, src/render/floor-surfaces.js bakeTiles,
   src/render/textures.js wallPat). Tile size 40, wall face 32. */
const DOOR_T = MAP.TILE_SIZE_PX;
const DOOR_FACE = WALL.FACE_HEIGHT_PX;

let doorWallPaper = null;
function doorWallPaperPattern(g){
  if (doorWallPaper) return doorWallPaper;
  const c = document.createElement('canvas'); c.width = 32; c.height = 48;
  const gg = c.getContext('2d');
  const grd = gg.createLinearGradient(0, 0, 0, 48);
  grd.addColorStop(0, PAL.bright); grd.addColorStop(0.55, PAL.pale); grd.addColorStop(1, PAL.mid);
  gg.fillStyle = grd; gg.fillRect(0, 0, 32, 48);
  gg.fillStyle = 'rgba(195,203,110,0.55)';
  for (let y = 6; y < 48; y += 11) for (let x = (y/11 | 0) % 2 ? 4 : 12; x < 32; x += 8) gg.fillRect(x, y, 2, 2);
  gg.fillStyle = 'rgba(228,230,168,0.16)'; gg.fillRect(0, 0, 32, 3);
  doorWallPaper = g.createPattern(c, 'repeat');
  return doorWallPaper;
}

/* Paints the door compass tutorial exactly like the gameplay door: a wall tile
   row with wallpaper face, the exit door (frame, ajar leaf, hinges, green ready
   lamp) cut into it at the top left, the plumber at the bottom right, and the
   compass chevron between them pointing at the door. */
function paintDoorCompass(g, w, h){
  const SCALE = 2;
  const T = DOOR_T*SCALE, F = DOOR_FACE*SCALE;
  const OW = T*0.40, OH = F*0.60;
  const hw = OW/2, hh = OH/2;

  /* Carpet floor like the baked tiles canvas. */
  g.fillStyle = PAL.carpet; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++){
    g.fillStyle = Math.random() < 0.5 ? 'rgba(163,163,112,0.16)' : 'rgba(228,230,168,0.10)';
    g.fillRect(Math.random()*w, Math.random()*h, 2, 2);
  }

  /* Top wall tile row, full width of the illustration, matching bakeTiles:
     wall top then wallpaper face. */
  const wx = 0, ww = w;
  g.fillStyle = PAL.wallTop; g.fillRect(wx, 0, ww, T);                                  // wall top
  g.fillStyle = 'rgba(28,26,16,0.55)'; g.fillRect(wx+ww-2, 0, 2, T);                    // right edge where wall meets carpet
  g.fillStyle = doorWallPaperPattern(g);
  g.fillRect(wx, T-F, ww, F);                                                           // wallpaper face, bottom 32 px
  g.fillStyle = 'rgba(40,38,24,0.55)'; g.fillRect(wx, T-F, ww, 2);                      // hard line at top of face
  g.fillStyle = 'rgba(48,46,30,0.22)'; g.fillRect(wx, T, ww, 2);                        // skirting shadow at base
  const sh = g.createLinearGradient(0, T, 0, T+T*0.5);
  sh.addColorStop(0, 'rgba(12,10,4,0.20)'); sh.addColorStop(1, 'rgba(12,10,4,0)');
  g.fillStyle = sh; g.fillRect(wx, T, ww, T*0.5);                                       // carpet shadow below wall

  /* The exit door, origin at the door tile centre, top-left area.
     Every leak is sealed so the door is armed (green lamp, ajar leaf). */
  const ox = 220, oy = 56;                                                              // door origin (top left)
  const open = 0.34;                                                                    // DOOR.AJAR_FRACTION: ready

  /* Glow on the wall behind the door. */
  const glow = g.createRadialGradient(ox, oy-6, 4, ox, oy-6, 96);
  glow.addColorStop(0, 'rgba(143,208,122,0.5)'); glow.addColorStop(1, 'rgba(143,208,122,0)');
  g.fillStyle = glow; g.beginPath(); g.arc(ox, oy-6, 48, 0, Math.PI*2); g.fill();

  /* The opening, darker than the wall it is cut into. */
  g.fillStyle = 'rgba(16,20,12,0.88)';
  g.fillRect(ox-hw, oy-hh, OW, OH);

  /* Frame: two jambs and a head. */
  g.strokeStyle = '#9c9a68'; g.lineWidth = 2.5;
  g.strokeRect(ox-hw-1.5, oy-hh-1.5, OW+3, OH+3);
  g.strokeStyle = 'rgba(40,38,24,0.5)'; g.lineWidth = 1;
  g.strokeRect(ox-hw-3, oy-hh-3, OW+6, OH+6);
  g.fillStyle = 'rgba(120,118,70,0.55)';
  g.fillRect(ox-hw-1.5, oy+hh+1.5, OW+3, 1.5);                                          // sill

  /* Door leaf, hinged on the left jamb, ajar toward the viewer. */
  const hx = ox-hw;
  const fx = hx + OW*(1 - 0.52*open);
  const top = oy-hh + OH*0.26*open;
  g.beginPath();
  g.moveTo(hx, oy-hh); g.lineTo(fx, top);
  g.lineTo(fx, top+OH); g.lineTo(hx, oy+hh);
  g.closePath();
  const lg = g.createLinearGradient(hx, 0, fx, 0);
  lg.addColorStop(0, '#cdc98f'); lg.addColorStop(1, '#a8a473');
  g.fillStyle = lg; g.fill();
  g.strokeStyle = 'rgba(28,26,20,0.55)'; g.lineWidth = 1; g.stroke();
  if (fx-hx > 6){
    g.strokeStyle = 'rgba(28,26,20,0.22)';
    g.beginPath();
    g.moveTo(hx+2.5, oy-hh+2.5); g.lineTo(fx-2.5, top+2.5);
    g.lineTo(fx-2.5, top+OH-2.5); g.lineTo(hx+2.5, oy+hh-2.5);
    g.stroke();
  }
  g.fillStyle = '#7d8288';                                                              // handle on swinging edge
  g.fillRect(fx-3.5, top+OH/2-4.5, 2.5, 9);
  g.fillStyle = '#6f6c47';                                                              // hinges on the jamb
  g.fillRect(hx-3.5, oy-hh+3, 2.5, 4.5); g.fillRect(hx-3.5, oy+hh-7.5, 2.5, 4.5);

  /* Lamp: green = level can end. */
  const lx = ox+hw+5, ly = oy-hh+6;
  g.fillStyle = '#cdf3bd';
  g.beginPath(); g.arc(lx, ly, 2.4, 0, Math.PI*2); g.fill();
  g.strokeStyle = 'rgba(28,26,20,0.65)'; g.lineWidth = 1;
  g.beginPath(); g.arc(lx, ly, 2.4, 0, Math.PI*2); g.stroke();

  /* Compass chevron between plumber and door, pointing at the door (top left). */
  const cx = w*0.6, cy = h*0.35;
  const arrow = 20;
  const ang = Math.atan2(oy-cy, ox-cx);
  const ux = Math.cos(ang), uy = Math.sin(ang);
  g.save();
  g.translate(cx, cy);
  g.rotate(ang);
  g.beginPath();
  g.moveTo(arrow, 0);
  g.lineTo(-arrow*0.7, -arrow*0.9);
  g.lineTo(-arrow*0.25, 0);
  g.lineTo(-arrow*0.7, arrow*0.9);
  g.closePath();
  g.lineJoin = 'round'; g.lineWidth = 4;
  g.strokeStyle = '#0c0e0a'; g.stroke();
  g.fillStyle = '#8fd07a'; g.fill();
  g.restore();

  /* "DOOR" label beside the chevron, offset away from the door like the
     gameplay cue (src/render/passes/door-compass.js). */
  const labelOff = 44;
  const labX = cx - ux*labelOff, labY = cy - uy*labelOff;
  g.font = 'bold 20px "Courier New", monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = 5;
  g.strokeStyle = 'rgba(12,14,10,0.9)';
  g.strokeText('DOOR', labX, labY);
  g.fillStyle = '#8fd07a';
  g.fillText('DOOR', labX, labY);

  /* The plumber, bottom right, heading for the door. */
  plumber(g, w*0.80, h*0.84);
}

function paintAirSupply(g, w, h){
  const segments = 20;
  const duration = G.time + G.clock;
  const fraction = duration > 0 ? Math.max(0, G.clock / duration) : 0;
  const lit = Math.ceil(fraction * segments);
  const barWidth = w*0.78;
  const barX = (w - barWidth)/2;
  const gap = 3;
  const segmentWidth = (barWidth - gap*(segments-1))/segments;

  g.fillStyle = '#202419';
  g.fillRect(w*0.08, h*0.09, w*0.84, h*0.82);
  g.textAlign = 'center';
  g.fillStyle = '#c5c99a';
  g.font = 'bold 18px Courier New, monospace';
  g.fillText('AIR', w/2, h*0.27);
  g.fillStyle = '#fffed1';
  g.font = `bold ${Math.round(h*0.25)}px Courier New, monospace`;
  g.fillText(clockText(G.clock), w/2, h*0.53);
  for (let i=0; i<segments; i++){
    g.fillStyle = i < lit ? '#fffed1' : '#41452f';
    g.fillRect(barX + i*(segmentWidth+gap), h*0.68, segmentWidth, h*0.08);
  }
}

/** Paints a controlled illustration using the game's own sprites and meters. */
export function paintTutorial(canvas, id){
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas context unavailable for tutorial illustration');
  const w = canvas.width, h = canvas.height;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#777c45';
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(24,26,16,0.2)';
  g.fillRect(0, h*0.68, w, h*0.32);
  if (id === 'sprint' || id === 'radar'){
    plumber(g, w*0.48, h*0.62);
    g.save();
    g.translate(w*0.72, h*0.54);
    g.scale(2.4, 2.4);
    if (id === 'sprint') drawStaminaMeter(g, -70, 0, MOVEMENT.SPRINT_STAMINA_SECONDS*0.6);
    else drawBatteryMeter(g, 0, 0, 70, true, -Math.PI/3);
    g.restore();
  } else if (id === 'lifeform'){
    g.save();
    g.translate(w*0.25, h*0.63);
    g.scale(2.2, 2.2);
    drawDormantLifeform(g, 0, 0, 0);
    g.restore();
    g.save();
    g.translate(w*0.75, h*0.67);
    drawLifeform(g, { T: MAP.TILE_SIZE_PX*2, h: 1, phase: 0.3, gait: 1, t: 0, danger: 1 });
    g.restore();
    g.font = 'bold 18px Courier New, monospace';
    g.textAlign = 'center';
    g.fillStyle = '#fffed1';
    g.fillText('Dormant', w*0.25, h-12);
    g.fillText('Hunting', w*0.75, h-12);
  } else if (id === 'airsupply'){
    paintAirSupply(g, w, h);
  } else if (id === 'doorCompass'){
    paintDoorCompass(g, w, h);
  } else {
    const deep = (WATER_TINTS[SETTINGS.waterHue] || WATER_TINTS.slate).deep;
    if (id === 'repair'){
      drawTutorialLeak(g, w*0.30, h*0.02, 120, deep);
      plumber(g, w*0.48, h*0.78);
      g.strokeStyle = '#e4e6a8';
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(w*0.48, h*0.82, 26, 10, 0, 0, Math.PI*2);
      g.stroke();
    } else {
      let deepest = -1;
      for (let i=0; i<G.wetArr.length; i++){
        if (G.wetArr[i] > WATER.DRAW_THRESHOLD && (deepest < 0 || G.wetArr[i] > G.wetArr[deepest])) deepest = i;
      }
      if (deepest >= 0){
        syncSurfaces(G);
        const x = Math.max(0, Math.min(MAP.WIDTH_TILES-5, deepest%MAP.WIDTH_TILES-2));
        const y = Math.max(0, Math.min(MAP.HEIGHT_TILES-3, Math.floor(deepest/MAP.WIDTH_TILES)-1));
        g.imageSmoothingEnabled = true;
        g.drawImage(surfaces.tiles, x*MAP.TILE_SIZE_PX, y*MAP.TILE_SIZE_PX, 5*MAP.TILE_SIZE_PX, 3*MAP.TILE_SIZE_PX, 0, 0, w, h);
        g.drawImage(surfaces.wet, x, y, 5, 3, 0, 0, w, h);
      }
      plumber(g, w*0.28, h*0.62);
    }
  }
}
