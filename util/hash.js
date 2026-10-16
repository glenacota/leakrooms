export function hash2(x,y){ let h = x*374761393 + y*668265263; h = (h ^ (h>>13))*1274126177; return ((h ^ (h>>16))>>>0)/4294967296; }
