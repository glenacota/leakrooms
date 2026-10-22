/**
 * DoorState — descend/ended/wet/atLeak/leakPower/Total/Dist.
 */
export function createDoorState() {
  return {
    descend: 0,
    ended: false,
    wet: 0,
    atLeak: false,
    leakPower: 0,
    leakTotal: 0,
    leakDist: 99,
  };
}