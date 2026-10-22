/**
 * FloodState — wet arrays + floodCover.
 * Dirty tracking moved to render/repaint.js (renderer-owned).
 */
import { MAP_H, MAP_W } from '../config/constants.js';

export function createFloodState() {
  return {
    wetArr: new Float32Array(MAP_W * MAP_H),
    waterDist: null,
    wetByDist: [],
    wetFront: 0,
    wetMaxDist: 0,
    wetSum: 0,
    wetEdgeD: -1,
    wetIndexAtDist: null,
    wetCv: null,
    wetCtx: null,
    wetImg: null,
    wetFloor: 0,
    floodCover: 0,
  };
}