/* mulberry32: a small seeded random number generator. Given the same seed it
   produces the same sequence every time, which is what makes a floor
   reproducible from its seed. Returns a function that gives a number from 0 up
   to (not including) 1 on each call. */
export function mulberry32(a){
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}