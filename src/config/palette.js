/* ============================================================
   THE PALETTE
   Five yellows. Every surface in the game is drawn from them and there is no
   other hue in the world. (Water blue and the danger red are the only
   exceptions, and they are used on purpose.) The same values are in the
   :root block of css/tokens.css.

   Each colour has a role, based on how it looks from directly above:
     wallTop   the top of a partition. Muted, so it separates from the carpet
               without going dark.
     carpet    the saturated one, and the main colour of the frame
     bright    the brightest end, used on wall faces
   ============================================================ */

export const PAL = {
  bright:  '#e4e6a8',   // (228,230,168)
  pale:    '#e1e2bb',   // (225,226,187)
  mid:     '#d6dea7',   // (214,222,167)
  carpet:  '#c3cb6e',   // (195,203,110)
  wallTop: '#c6c58b',   // (198,197,139)
};