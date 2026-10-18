/* The size of the canvas in device pixels and the world scale. render/canvas.js
   writes it on resize, and the simulation reads it (for example in onScreen), so
   the simulation never has to import the renderer. */
export const view = { w:0, h:0, scale:1 };