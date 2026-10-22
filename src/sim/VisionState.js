/**
 * VisionState — vis/mask/cone arrays + visRegion/Step/FadeT + coneX/Y/Face/Radar + scopeDirty.
 * wantVision is a module-level flag in vision.js, not stored here.
 */
import { MAP_H, MAP_W, DARK_ROOM } from '../config/constants.js';

export function createVisionState() {
  return {
    visArr: new Float32Array(MAP_W * MAP_H).fill(DARK_ROOM),
    visFrom: new Float32Array(MAP_W * MAP_H).fill(DARK_ROOM),
    visTgt: new Float32Array(MAP_W * MAP_H).fill(DARK_ROOM),
    visScratch: new Float32Array(MAP_W * MAP_H),
    maskArr: new Float32Array(MAP_W * MAP_H),
    maskTgt: new Float32Array(MAP_W * MAP_H),
    coneArr: new Float32Array(MAP_W * MAP_H),
    maskCv: null,
    maskCtx: null,
    maskImg: null,
    visRegion: -1,
    visStep: 0,
    visFadeT: 0,
    coneX: NaN,
    coneY: NaN,
    coneFace: NaN,
    coneRadar: null,
    scopeDirty: false,
  };
}