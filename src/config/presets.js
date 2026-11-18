/* The grey tint retains a visible brightness difference without colour. */
export const WATER_TINTS = {
  slate:  { damp:[54,50,40],  deep:[32,76,112] },
  teal:   { damp:[44,52,46],  deep:[24,88,98]  },
  violet: { damp:[54,44,58],  deep:[78,50,114] },
  grey:   { damp:[40,40,40],  deep:[104,104,108] },
};

/* Presets change pacing and lives, never noise or the five-floor count. */
export const DIFFICULTIES = {
  relaxed: { lives:5, clock:240, repairTime:7.0, huntBase:2.90, huntStep:0.26,
             label:'RELAXED' },
  normal:  { lives:3, clock:180, repairTime:5.0, huntBase:3.45, huntStep:0.34,
             label:'NORMAL' },
  hard:  { lives:1, clock:150, repairTime:4.0, huntBase:4.05, huntStep:0.42,
             label:'HARD' },
};