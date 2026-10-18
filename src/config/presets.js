/* The water palette. The leak is the ONLY non-yellow hue in the world and it
   is the entire cue, so a player who cannot separate this from the carpet
   cannot play the mechanic at all. `damp` is what compositing wet carpet looks
   like; `deep` is the hue that finally wins. Every value here is chosen by
   solving for the composited tile, not by picking a colour that looks like
   water in isolation — see packWet().

   `grey` is the accessibility option: no hue at all, just a hard value
   difference, for anyone who cannot separate slate from olive. */
export const WATER_TINTS = {
  slate:  { damp:[54,50,40],  deep:[32,76,112] },
  teal:   { damp:[44,52,46],  deep:[24,88,98]  },
  violet: { damp:[54,44,58],  deep:[78,50,114] },
  grey:   { damp:[40,40,40],  deep:[104,104,108] },
};

/* Difficulty. PRESETS, not a slider, and they move COUNTS AND SPACING only:
   lives, how long you get on the clock, how long the repair takes, and how fast
   the Lifeform commits. None of them touches the noise table, and that is the
   whole discipline here — walk/wading staying under LOUD is the design contract,
   and a difficulty control that could push a quiet noise over the line would let
   a player configure the stealth layer out of the game. The suite asserts this.

   Note what is NOT here any more: the level count. The five levels are the run,
   not a setting — a preset that gave you four of them meant the game had five
   endings depending on which menu you picked, and there is only one of those
   worth designing. */
export const DIFFICULTIES = {
  relaxed: { lives:5, clock:240, repairTime:7.0, huntBase:2.90, huntStep:0.26,
             label:'RELAXED' },
  normal:  { lives:3, clock:180, repairTime:5.0, huntBase:3.45, huntStep:0.34,
             label:'NORMAL' },
  hard:  { lives:1, clock:150, repairTime:4.0, huntBase:4.05, huntStep:0.42,
             label:'HARD' },
};

