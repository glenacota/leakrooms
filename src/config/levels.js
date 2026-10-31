/* ============================================================
   THE FIVE LEVELS
   The content of each level. This is fixed: the difficulty presets do not
   change it.

     leaks  the work: how many burst pipes to find, seal and walk back from
     forms  the pressure: how many lifeforms are in the building

   The two are independent on purpose.
   ============================================================ */

export const LEVELS = [
  { leaks:1, lifeforms:1 },   // 1: one leak, one lifeform; learn the round trip
  { leaks:2, lifeforms:2 },   // 2: twice the work; the building starts paying attention
  { leaks:3, lifeforms:2 },
  { leaks:4, lifeforms:3 },
  { leaks:4, lifeforms:4 }
];
export const LEVELS_N = LEVELS.length;