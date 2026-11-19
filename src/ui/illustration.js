import { paintManualBattery, paintManualStamina, paintManualNoise, paintManualDoorCompass } from '../render/illustration.js';

/** Paints the field manual illustrations in startup order. */
export function initIllustration(){
  paintManualBattery(document.getElementById('manual-battery'));
  paintManualStamina(document.getElementById('manual-stamina'));
  paintManualNoise(document.getElementById('manual-noise'));
  paintManualDoorCompass(document.getElementById('manual-door-compass'));
}
