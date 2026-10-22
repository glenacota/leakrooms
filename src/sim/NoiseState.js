/**
 * NoiseState — noise meters + stat.
 */
export function createNoiseState() {
  return {
    noise: 0,
    noisePeak: 0,
    selfNoise: 0,
    ambientNoise: 0,
    stat: { noises: 0, deaths: 0, sealed: 0 },
  };
}