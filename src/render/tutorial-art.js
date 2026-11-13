import { drawLifeform } from '../cast/lifeform.js';
import { drawPlumber } from '../cast/plumber.js';
import { MAP_H, MAP_W, SPRINT_STAMINA, TILE, WET_DRAW } from '../config/constants.js';
import { WATER_TINTS } from '../config/presets.js';
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
  drawPlumber(g, { T: TILE*2, phase: 0.25, gait: 0.6, t: 0, wave: 0 });
  g.restore();
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
    if (id === 'sprint') drawStaminaMeter(g, -70, 0, SPRINT_STAMINA*0.6);
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
    drawLifeform(g, { T: TILE*2, h: 1, phase: 0.3, gait: 1, t: 0, danger: 1 });
    g.restore();
    g.font = 'bold 18px Courier New, monospace';
    g.textAlign = 'center';
    g.fillStyle = '#fffed1';
    g.fillText('Dormant', w*0.25, h-12);
    g.fillText('Hunting', w*0.75, h-12);
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
        if (G.wetArr[i] > WET_DRAW && (deepest < 0 || G.wetArr[i] > G.wetArr[deepest])) deepest = i;
      }
      if (deepest >= 0){
        syncSurfaces(G);
        const x = Math.max(0, Math.min(MAP_W-5, deepest%MAP_W-2));
        const y = Math.max(0, Math.min(MAP_H-3, Math.floor(deepest/MAP_W)-1));
        g.imageSmoothingEnabled = true;
        g.drawImage(surfaces.tiles, x*TILE, y*TILE, 5*TILE, 3*TILE, 0, 0, w, h);
        g.drawImage(surfaces.wet, x, y, 5, 3, 0, 0, w, h);
      }
      plumber(g, w*0.28, h*0.62);
    }
  }
}
