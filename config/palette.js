/* THE PALETTE.
   The five colours of the place, and every surface in the game is drawn from
   them — there is no other hue anywhere in the world. They are the walls, the
   carpet and the ceiling in the original, and the roles are assigned by how
   they read from directly above:

     WALL_TOP   the ceiling of a partition, seen from above. Muted and
                desaturated, because it has to separate from the carpet
                without going dark — a wall you cannot tell from the floor is
                not a wall.
     CARPET     the saturated one. It is the dominant surface in the frame and
                it is the colour the place is named for.
     WALL_FACE  the pale end. The vertical face of a partition catches the
                fluorescents, so it is the brightest thing in the room. */
export const PAL = {
  bright:  '#e4e6a8',   // (228,230,168)
  pale:    '#e1e2bb',   // (225,226,187)
  mid:     '#d6dea7',   // (214,222,167)
  carpet:  '#c3cb6e',   // (195,203,110)
  wallTop: '#c6c58b',   // (198,197,139)
};
