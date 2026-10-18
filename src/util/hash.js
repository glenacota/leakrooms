/* A cheap deterministic hash of two integers, returning a number from 0 
up to (not including) 1. The same inputs always give the same output, so 
it can pick per-tile variation without using the random number generator. */
export function hash2(x,y){ let h = x*374761393 + y*668265263; h = (h ^ (h>>13))*1274126177; return ((h ^ (h>>16))>>>0)/4294967296; }