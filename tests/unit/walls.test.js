import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR, MAP_H, MAP_W, WALL } from '../../src/config/constants.js';
import { wallNeighbourMax } from '../../src/sim/walls.js';

test('wallNeighbourMax returns the brightest orthogonal floor neighbour', () => {
  const grid = new Uint8Array(MAP_W * MAP_H).fill(WALL);
  const values = new Float32Array(MAP_W * MAP_H);
  const i = 10 * MAP_W + 10;
  const neighbours = [i + 1, i - 1, i + MAP_W, i - MAP_W];
  const brightness = [0.25, 0.75, 0.5, 0.125];
  for (let n = 0; n < neighbours.length; n++) {
    grid[neighbours[n]] = FLOOR;
    values[neighbours[n]] = brightness[n];
  }

  assert.equal(wallNeighbourMax(grid, values, i), 0.75);
});

test('wallNeighbourMax ignores non-floor tiles and walls without floor neighbours', () => {
  const grid = new Uint8Array(MAP_W * MAP_H).fill(WALL);
  const values = new Float32Array(MAP_W * MAP_H).fill(1);
  const i = 10 * MAP_W + 10;

  assert.equal(wallNeighbourMax(grid, values, i), 0);
});

test('wallNeighbourMax does not wrap across map edges', () => {
  const grid = new Uint8Array(MAP_W * MAP_H).fill(WALL);
  const values = new Float32Array(MAP_W * MAP_H);
  const i = 10 * MAP_W;
  grid[i - 1] = FLOOR;
  values[i - 1] = 1;

  assert.equal(wallNeighbourMax(grid, values, i), 0);
});
