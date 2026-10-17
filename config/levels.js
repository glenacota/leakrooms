/* ---------- THE FIVE LEVELS ----------
   Fixed content, not a difficulty curve the presets tune: this is the shape of
   the run. Each level is a floor you enter through one door, a set of burst
   pipes to find and seal, and a set of things in the building with you.

   `leaks` is the work — how many bursts to find, seal and then walk back from.
   `forms` is the pressure, and it deliberately does NOT track `leaks`: level 2
   has twice the work of level 1 and exactly the same number of things hunting
   for you, so the second level teaches the round trip (seal, then get back)
   before the building ever gets crowded. Levels 4 and 5 share four pipes and
   differ only in what is walking around while you do it. */
export const LEVELS = [
  { leaks:1, forms:1 },   // 1 — one pipe, one thing, learn the round trip
  { leaks:2, forms:2 },   // 2 — twice the work, the building starts paying attention
  { leaks:3, forms:2 },
  { leaks:4, forms:3 },
  { leaks:4, forms:4 }
];
export const LEVELS_N = LEVELS.length;
