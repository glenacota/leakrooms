/* ============================================================
   THE FIVE LEVELS
   The content of each level. This is fixed: the difficulty presets do not
   change it.

     leaks  the work: how many burst pipes to find, seal and walk back from
     forms  the pressure: how many lifeforms are in the building

   The two are independent on purpose. Level 2 has twice the pipes of level 1
   but the same number of lifeforms, so the player learns the round trip
   (seal, then get back) before the building gets crowded. Levels 4 and 5 have
   the same four pipes and differ only in how many lifeforms walk around.
   ============================================================ */

export const LEVELS = [
  { leaks:1, lifeforms:1 },   // 1: one pipe, one lifeform; learn the round trip
  { leaks:2, lifeforms:2 },   // 2: twice the work; the building starts paying attention
  { leaks:3, lifeforms:2 },
  { leaks:4, lifeforms:3 },
  { leaks:4, lifeforms:4 }
];
export const LEVELS_N = LEVELS.length;