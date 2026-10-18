/* ============================================================
   WATER TINTS
   The water is the only non-yellow hue in the world, so the player must be
   able to tell it from the carpet or the main mechanic cannot be played.

     damp  how wet carpet looks (the start of the colour ramp)
     deep  the colour that wins as the water gets deep

   The values were chosen by working out what the finished tile looks like when
   drawn over the carpet (see packWet in render/pack.js), not by picking a
   colour that looks like water on its own. Two earlier attempts failed that
   way: one looked like glowing ice, the other was as dark as an unlit floor.

   'grey' is the accessibility option: no hue, only a strong difference in
   brightness, for players who cannot tell slate from olive.
   ============================================================ */

export const WATER_TINTS = {
  slate:  { damp:[54,50,40],  deep:[32,76,112] },
  teal:   { damp:[44,52,46],  deep:[24,88,98]  },
  violet: { damp:[54,44,58],  deep:[78,50,114] },
  grey:   { damp:[40,40,40],  deep:[104,104,108] },
};

/* ============================================================
   DIFFICULTY PRESETS
   A preset changes counts and pacing only: lives, the clock per floor, repair
   time, and lifeform chase speed.

   Two things are deliberately NOT part of a preset:
     the noise values   Walking and wading staying under LOUD is the heart of
                        the stealth design. If difficulty could change them, a
                        player could configure the stealth out of the game.
                        The test suite checks this.
     the level count    There are always five levels. A preset with fewer
                        would give the game several different endings.
   ============================================================ */

export const DIFFICULTIES = {
  relaxed: { lives:5, clock:240, repairTime:7.0, huntBase:2.90, huntStep:0.26,
             label:'RELAXED' },
  normal:  { lives:3, clock:180, repairTime:5.0, huntBase:3.45, huntStep:0.34,
             label:'NORMAL' },
  hard:  { lives:1, clock:150, repairTime:4.0, huntBase:4.05, huntStep:0.42,
             label:'HARD' },
};