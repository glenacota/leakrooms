export const TILE   = 40;
/* The lit face of a wall: how tall the wallpaper band is, as a fraction of a
   tile. It is drawn into the carpet tile BELOW each wall that has floor to its
   south (bakeTiles), and it is the surface the door is painted on — so the
   number lives here, once, rather than as a local in one function and a guess in
   another. A door that is taller than this is not painted on the wall, it is
   standing in front of it.

   DO NOT RAISE IT WITHOUT RAISING THE FLOOR WITH IT. The face is drawn into the
   tile BELOW the wall, so it eats that tile's floor. At 0.74 the band took 74% of
   every edge tile, leaving 10px of carpet — and the Rigger's body occupies the
   top ~8px above their feet, which lands squarely on the wallpaper, so anyone
   standing along a wall appeared to hover in front of it. The face is not free
   to grow: it is carved out of the floor the characters walk on.

   Related and also not free: the contact shadow is drawn from the TOP of that
   same tile for TILE*0.5, so the face covers all but the last 1.6px of it and
   the height cue it exists to sell is very nearly gone already. Anything that
   makes the face taller finishes it off. */
export const WALL_FACE = TILE*0.46;
export const LS     = 4;                 // light samples per tile
export const MAP_W  = 76;
export const MAP_H  = 76;
export const VIEW_T = 27;                // tiles across the viewport
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
/* How long you have on each level to seal every pipe and get back to the door
   you came in through. This is the whole pressure of a floor: the water is the
   clock's excuse, the walk back is what it actually spends. */
let FLOOR_CLOCK = 180;      // seconds; NORMAL

/* --- the door ---
   The one door on the floor is a leaf on a hinge, not a rectangle of colour,
   so these are the three numbers that describe how it behaves. */
export const DOOR_HOLD = 1.5;      // seconds standing at it
export const DOOR_AJAR = 0.34;     // the swing it rests at once the pipes are sealed
export const DOOR_EASE = 6;        // per second; leaves the frame looking at a door

/* These are `let` rather than `const` because the settings modal drives
   them. Their initialisers are the NORMAL preset and are the documented
   tuning; applySettings() overwrites them at load. The noise table below is
   NOT among them, and deliberately so — see the difficulty note. */

export const WALK   = 3.3;               // tiles/sec
export const SPRINT = 6.0;
export const R      = 0.33;              // player collision radius (tiles)
export const RA     = 0.34;              // Lifeform collision radius (bulkier)

/* THE HIT ZONE. brush() kills at this distance, and the Stalker draws a disc
   of exactly this radius under itself, so the thing that can touch you is
   visible rather than implied. One constant, two readers: if the radius ever
   moves, the picture moves with it. */
export const CATCH_R = 0.52;
/* How far in front of the body the character holds their gear, in tiles. This
   is both where the vision cone originates and where the device is drawn on
   the avatar, so the two can never disagree. */
export const HAND_OFF = 0.135;

export const BATT_MAX   = 100;
/* The radar is the only tool, and it is expensive. At 5.6/s a full battery is
   under 18 seconds of sweep — long enough to cross a floor or two, never long
   enough to leave it running. The torch it replaced drained 2.4/s and could be
   held indefinitely, which made the budget a formality rather than a decision;
   this one has to be switched off and thought about. */
export const RADAR_DRAIN = 5.6;          // per second while sweeping
/* How far apart two pipes may be placed, in tiles. Without it the placement
   loop — which always takes the farthest candidate — stacks every burst in the
   same far corner of the floor, and four pipes become one pipes you seal four
   times in the same five seconds. The floor has to be a tour. */
export const PIPE_GAP = 12;

/* ---------- THE LEAK ----------
   You are not here to hunt. You are here because a pipe is burst somewhere in
   the building and the water is telling you where, and the only thing you can
   do about it is stand still next to it for five seconds while something else
   in the building walks toward the noise of you doing exactly that.

   THE WATER IS THE CUE. The radar reveals space and nothing else — it has no
   reason to know about plumbing and it must not be given one, or the mechanic
   collapses into sweeping. What the radar cannot do is show you which way the
   floor is wet, and water runs downhill from the leak and nowhere else, so the
   wet trail is a path to the source that costs no battery and makes no noise.
   Walking wet carpet is slightly louder and slightly slower than walking dry
   it, so following your own trail is not free either.

   THE LEAK IS A STANDING NOISE SOURCE. That is the trap. A leak that only
   flooded the floor would be scenery. One that gurgles pulls the Lifeform to
   the pipe — which is a shield while you are finding it, because something
   standing over the leak is not standing over you, and an ambush while you
   wrench is a decision you get to make rather than one that happens to you.

   And it is deliberately kept BELOW LOUD. A leak that woke the whole floor on
   sight would be a chase generator with no off switch; this one makes the
   thing curious and keeps it coming, which is the difference between a
   pursuer you can predict and one you cannot. The wrench is what is loud.

   THE FRONT IS SLOW, and it is slow on purpose. At 1.4s a tile the water
   reached the spawn inside half a minute and turned the floor into a lake long
   before you got anywhere near it — at which point the wet trail is no longer a
   trail, it is weather, and following it downhill is no longer a read you are
   making. At 3.2s a tile the front advances about half a tile per two seconds:
   still unambiguously alive, still spreading while you stand there, and the
   readable set of "tiles the water has got to" stays a set you can hold in your
   head for the length of a journey. The flood is a cue and a clock, not an
   event. */
export const LEAK_SPREAD  = 3.2;    // s of travel per tile — the water front's speed, going OUT
/* The recession walks back at its OWN speed, and it is nearly three times
   faster than the arrival. It used to be tied to LEAK_SPREAD on purpose, on the
   argument that a floor should un-flood in the time it took to flood and the
   tide you watched arrive is the tide you watch leave. The argument is wrong
   about the size of the thing: water spreads until it reaches the far side of
   the building — G.wetMaxDist is 82 to 148 tiles out there depending on the
   floor — so a symmetric recession is a five to eight minute mop-up, longer
   than the 180s clock the whole level is played against, and the player walks
   home through a wet building for minutes after the objective is done.

   The symmetry was legible; the length was not. Draining three times faster
   keeps the recession radial and readable — the waterline still pulls back
   from the edges inward, away from the pipes — and hands the player back a
   dry-ish floor inside the time they are still playing. */
export const LEAK_RETREAT = 0.5;   // s of travel per tile — the water front's speed, going IN
/* The two SOAK constants, not the front. They answer "how long does one tile
   take to darken once the waterline reaches it, and how long to fade once the
   waterline has left it" — which is a different question from how fast the
   waterline itself moves, and it was conflated with it until the recession was
   tied to the arrival pace.

   WET_FALL being at least half of WET_RISE, and the recession outrunning the
   arrival, is what makes the shoreline read as a shore: the waterline pulls
   away faster than the tiles it uncovers take to fade, so there is always a
   wet band between dry carpet and open flood. Move them together and the edge
   goes hard.

   The ratio that actually holds the band open is fade-time over retreat-speed,
   measured against rise-time over spread-speed: 14/3.2 = 4.4 tiles of soak
   arriving, 5.0/1.1 = 4.5 tiles on the way out. Same width, both directions.
   Drop WET_FALL below that and the last tiles pop from dry to flooded with
   nothing soft in between. */
export const WET_RISE     = 14.0;   // s for a soaked tile to go 0 -> 1
export const WET_FALL     = 5.0;    // s for an abandoned tile to go 1 -> 0
export const LEAK_NOISE_BASE = 0.16;   // a quiet drip, heard ~6 tiles
export const LEAK_NOISE_GAIN = 0.26;   // added as the floor drowns; still under LOUD
export const LEAK_LURE    = 0.42;   // tiles: a SEARCHING entity drifts this close
/* PIPE_FAR is the STRAIGHT-LINE CAP, indexed by pipe count: how far from the
   spawn a break is allowed to be, measured in a straight line — and the cap is
   the whole point.

   Sorting by Euclidean distance and taking the extreme corner looks right on
   paper and is wrong in a maze: a tile 70 tiles away in a straight line can
   be 200 tiles of corridor to actually walk, because a BSP level is a tree
   and the winding is the point. The first version did exactly that and the
   repair became a two-minute trudge across half the building — which is not
   tension, it is a commute, and it made the headless playthrough take longer
   than the entire rest of the suite put together.

   Capping the straight-line distance keeps it a genuine hunt — enough tiles
   that you cannot see the pipe when you spawn — without turning the
   objective into a marathon. Anything within the cap is a candidate and the
   farthest of those wins; the uncapped list is still the fallback.

   The cap is also a BUDGET, and the budget is three minutes for the whole
   level, not for one pipe. One pipe can afford to be in the far corner of the
   building; four cannot, because a level that asks for four crossings of the
   map and then the walk home is not a hard level, it is an arithmetic one that
   only the best possible route survives. So each extra pipe pulls the reach in
   — the work stays a tour, and the tour stays inside the clock. Indexed by
   (pipes - 1); the last entry repeats for any count past the table. */
export const PIPE_FAR = [56, 48, 42, 38];
/* The pipe has been open for a while before you got here. Without this the
   floor starts bone dry and the first half-minute has no cue in it at all —
   you would have to wander blindly until water happened to reach you, which
   is the exact opposite of "follow the wet floor downhill". At LEAK_SPREAD this
   is a puddle about thirteen tiles across already standing around the break —
   enough to see from the next room, small enough that you are reading a
   waterline rather than surveying a lake. */
export const LEAK_HEADSTART = 42;   // seconds of flood pre-warmed at level start

/* The repair itself. Five seconds is long enough that standing there is a
   commitment, and the commitment is the whole point of the mechanic: you are
   choosing to be immobile and loud in a building with something in it. */
let REPAIR_TIME    = 5.0;    // seconds of unbroken contact to seal the pipe
export const REPAIR_REACH = 1.25;   // tiles from the pipe face
export const REPAIR_DECAY = 2.6;    // whole-bars lost per second once you move
export const REPAIR_NOISE = 0.85;   // LOUD. Louder than running. That is the point.

/* SPRINT_NOISE is the loudest thing you can do while MOVING, and it is below
   the wrench — which is what the line above has claimed since the noise table
   was written, and what the HUD has to be able to show. It used to be a bare
   1.0, louder than the wrench at 0.85: a sprint both out-shouted the repair and
   pegged the meter, so the bar could not say which of the two loud decisions
   you were making, and the comment was simply untrue.

   0.72 keeps everything the sprint is for — 3.3x a walk at 0.22, well over LOUD,
   so it still wakes a sleeping coil and still commits a hunter to a full hunt —
   and gives the meter a top end it can actually name. hearRadius() is 12.6
   tiles, against 6.6 for a walk and 14.2 for the wrench. */
export const SPRINT_NOISE = 0.72;

export const WALL = 0, FLOOR = 1;

/* Room-scoped light.
   The bake below is per FIXTURE: how bright a tile would be if its fluorescents
   were the only thing you could see. This is per VIEWER: of that bake, only
   the parts you can actually see are lit. Rooms are separated by walls, so the
   scope falls off with how many gates you must look through — see HOP_FALL.

   The radar overrides all of it while it is on. That is the trade: everything
   visible, for eighteen seconds of battery a time. */
/* DARK_ROOM is what a tile is worth when there is no scope at all — only
   reachable in a degenerate state where the player is off the map. Normal
   darkness is not this number: it is the product of the scope, the distance
   falloff and the cone, and any tile the cone cannot reach is exactly black
   regardless. It was 0.14 for a while, chosen against measured luminance, and
   that was wrong twice over — it revealed geometry the character cannot see
   (which reads as the game drawing a map), and it hid the fact that the scope
   itself was a cliff. */
export const DARK_ROOM      = 0.0;

/* How visible a region is, by how many gates you must look through to reach
   it. This USED to be a cliff: your room 1.0, one gate away 0.30, everything
   beyond hard zero. Measured on a 40-tile straight corridor, that blacked out
   the floor from 10 tiles onward — dead ahead, in line of sight, inside a
   200 degree cone — because the corridor happened to be a second region. You
   could not see down a hallway in your own house.

   So it is a falloff, not a cliff, and the falloff is what makes the "other
   rooms are dark" rule survivable: a room two gates away down a clear line is
   dim, and one four gates away is nearly black, but the light arrives
   continuously instead of stopping at a boundary you cannot see. */
export const HOP_FALL = [1.0, 0.85, 0.50, 0.26, 0.17, 0.11];   // index = gates passed

/* Distance attenuation, applied ONLY to regions that are not your own. Without
   it a 40-tile corridor stays at 11% all the way to the far wall and reads as
   a lit tube rather than a corridor receding into the dark. Your own room gets
   no distance falloff at all: it is at most 12 tiles across, and dimming the
   far corner of the room you are standing in is the one thing this whole
   feature must never do. */
export const VIEW_FADE_NEAR = 13;    // tiles, full brightness up to here
export const VIEW_FADE_FAR  = 31;    // tiles, black from here

/* How fast the drawn mask chases the freshly traced one. The mask is per
   TILE, so even retraced every frame it is quantised — tiles enter and leave
   the fan one at a time as you walk and the boundary of vision chatters.
   Approaching the target exponentially turns that into sliding motion. */
export const MASK_TAU = 0.055;       // s; much shorter than LIGHT_FADE on purpose

/* BAKE_FLOOR is how dimmest a LIT surface is allowed to get. With darkness
   moved onto the mask this can sit at 1.0: a surface you can see is the
   palette at full strength, unmodified, because that is the whole look — the
   walls are a sickly yellow and they are always on. Anything you cannot see
   is multiplied by zero and this number is irrelevant to it. The variation
   within a room comes from the additive fixture pass (bright pools under the
   tubes) rather than from the bake dimming everything else, which is what lets
   the flat floor value coexist with a lit-looking room.

   At 0.82 the same room measured 172 against a carpet palette of 195 — close,
   but every lit surface was quietly 12% off the colour it was supposed to be,
   and the walls another 18% off that. */
export const BAKE_FLOOR     = 1.0;

export const LIGHT_FADE     = 0.30;   // s, fluorescents coming up as you cross a threshold
export const LIGHT_FADE_STEPS = 10;   // the fade is quantised: a repack per frame is 116k writes

/* ---- cone of vision ----
   A 200 degree cone, so there is always 80 degrees of blindness behind you and
   turning is how you check behind you. It is NOT a light: it decides what the
   character can SEE, and it stops dead at a wall, so a partition hides the
   room behind it however open the doorway is.

   Cast as a fan of rays from the eye and stopped by geometry, rather than a
   per-tile angle test. A per-tile test is O(5776) every frame and is also
   wrong: it lights the floor on the far side of a one-tile partition stub,
   which is exactly the case the ray cast gets right and the angle test does
   not. */
export const VIEW_DEG   = 200;
export const VIEW_HALF  = VIEW_DEG*Math.PI/360;      // radians either side of facing
export const VIEW_RAYS  = 240;                        // angular fan resolution
export const VIEW_RANGE = 34;                         // hard stop; the distance fade ends first
/* VIEW_MID is how close a ray must pass to a tile's CENTRE for that tile to
   count as seen. It is a radius in tiles: 0.5 is the inscribed circle, 0.71
   the circumscribed one. Below 0.5 the tile goes black before its edge, which
   makes vision look eaten away at the walls; at 0.71 a corner sliver counts as
   seeing the tile, which is the leak this exists to stop. */
export const VIEW_MID   = 0.48;

/* ---------- canvas ---------- */

/* VHS_PASS and FLICKER_DEPTH used to be slider positions. They are constants
   now: the scanline crawl and the stuttering tubes are how the place is lit,
   and a preference for "less of the look" is not a preference the game can
   honour without becoming a different game. Everything that reads them reads
   these, so restoring a slider later is a matter of wiring the control, not
   of hunting the values back out of the renderer. */
export const VHS_PASS = 0.7;
export const FLICKER_DEPTH = 0.65;

/* The specular sheen on deep water is quantised into this many alpha steps and
   drawn as one path per step. Four is chosen because the whole range is 0 to
   0.05 of alpha: four steps puts 0.0125 between them, which is under the
   banding a `lighter` pass shows. Scratch, so the sheen allocates nothing per
   frame — see the sheen pass in render(). */
export const SHEEN_STEPS = 4;

/* ADAPTIVE RESOLUTION.

   The device pixel ratio is capped at 2, which means a retina laptop renders
   four times the pixels of the same window on an external monitor — and every
   cost in this renderer is proportional to pixels touched, not to logic
   executed. Measured on the reference machine, the same frame cost 2.2ms at
   1x and would cost roughly four times that at 2x, for an image that is then
   scaled down by the compositor to exactly the size it would have been anyway.
   On a machine that cannot hold 60Hz, that difference is the whole margin.

   So the ratio is a starting point, not a decision. The frame time is tracked,
   and if it sits above the drop threshold for long enough to be a trend rather
   than a spike, the backing store shrinks by one step and resize() runs again.
   If it then sits comfortably below the recover threshold, it grows back. The
   bands are deliberately far apart so a machine sitting near a boundary cannot
   oscillate — a resolution that visibly pumps is worse than a slightly soft one
   that holds.

   Nothing else in the renderer changes. SCALE is derived from cvs.width, so the
   camera, the geometry, the light bake and the visibility mask all follow the
   new backing store automatically, and test 7 — which asserts the camera, the
   lightmap and the flood image all share one origin — keeps holding. */
export const RENDER_SCALES = [1, 0.8, 0.65, 0.5];
export const SCALE_DROP_MS  = 20;      // sustained frame time that costs a step
export const SCALE_RECOVER_MS= 12;     // sustained frame time that earns one back
export const SCALE_BAD_FRAMES = 45;    // frames over threshold before acting on it
export const SCALE_GOOD_FRAMES = 180;  // and a much longer run before recovering

export const WET_DRAW = 0.015;          // packWet: below this a tile is fully transparent
export const WET_EDGE = WET_DRAW*0.8;    // ...so below THIS the simulation may stop caring

export const LOUD = 0.5;
export const NOISE_FS = REPAIR_NOISE;
export const DOOR_NOISE = 1.8;
export const BRUSH_NOISE = 1.2;
