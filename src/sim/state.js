/* All the state of the current floor lives on G. It is null until the first
   buildFloor() call, and buildFloor() replaces it completely, so nothing that
   belongs to a floor can outlive that floor. Other modules read G through
   this live binding. */
export let G = null;
export function setG(g){ G = g; }