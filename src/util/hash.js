/**
 * Derives repeatable per-coordinate variation for simulation and rendering.
 * @returns {number} A value in the range [0, 1).
 */
export function hash2(x,y){ let h = x*374761393 + y*668265263; h = (h ^ (h>>13))*1274126177; return ((h ^ (h>>16))>>>0)/4294967296; }