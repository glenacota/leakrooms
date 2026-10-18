/* The whole per-floor state lives on G. It is null until the first buildFloor,
   and buildFloor replaces it wholesale so nothing floor-scoped can outlive the
   floor it describes. Every later module imports G from here. */
export let G = null;
export function setG(g){ G = g; }
