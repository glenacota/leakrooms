import { paintManualBattery, paintManualStamina, paintManualNoise } from '../render/manual-art.js';

/** Paints the field manual illustrations in startup order. */
export function initManualArt(){
  paintManualBattery(document.getElementById('manual-battery'));
  paintManualStamina(document.getElementById('manual-stamina'));
  paintManualNoise(document.getElementById('manual-noise'));
}
