import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { MAP_H, MAP_W, PLUMBER, WALL_OVERLAP } from '../../src/config/constants.js';

const { A, G } = await loadGame();
const W = MAP_W;

// Closest the disc gets to a wall, moving in one direction in small steps
const reach = (x, y, dx, dy) => {
  while (!A.blocked(x + dx, y + dy, PLUMBER.RADIUS)) { x += dx; y += dy; }
  return [x, y];
};

/* From a wall tile and a direction pointing away from it, walk toward the wall
   along a clear lane of 3 floor tiles and check the body stops WALL_OVERLAP closer
   than a full radius, on every side. */
test('the plumber sinks into a wall by WALL_OVERLAP on all four sides', () => {
  const counts = { up: 0, down: 0, left: 0, right: 0 };
  const sides = [
    { name: 'up',    ax: 0, ay: 1 },   // wall above, body approaches from below
    { name: 'down',  ax: 0, ay: -1 },
    { name: 'left',  ax: 1, ay: 0 },
    { name: 'right', ax: -1, ay: 0 },
  ];
  for (let seed=1; seed<=20; seed++){
    A.buildFloor(0, seed);
    const g = (x, y) => G.grid[y*W + x];
    for (let y=4; y<MAP_H-4; y++) for (let x=4; x<W-4; x++){
      if (g(x,y) !== 0) continue;
      for (const { name, ax, ay } of sides){
        if (!(g(x+ax,y+ay)===1 && g(x+2*ax,y+2*ay)===1 && g(x+3*ax,y+3*ay)===1)) continue;
        // the lane's neighbours must be floor too, so no other wall is nearer
        if (g(x+ax+ay,y+ay+ax)!==1 || g(x+ax-ay,y+ay-ax)!==1) continue;
        const [rx, ry] = reach(x + 0.5 + 3*ax, y + 0.5 + 3*ay, -ax*0.005, -ay*0.005);
        // distance from the body centre to the wall's near edge
        const edge = ax ? (ax > 0 ? x + 1 : x) : (ay > 0 ? y + 1 : y);
        const gap = ax ? Math.abs(rx - edge) : Math.abs(ry - edge);
        assert.ok(Math.abs(gap - (PLUMBER.RADIUS - WALL_OVERLAP)) < 0.01, `seed ${seed} ${name} at ${x},${y}: gap ${gap}`);
        counts[name]++;
      }
    }
  }
  for (const k in counts) assert.ok(counts[k] > 0, `no ${k} case found`);
});
