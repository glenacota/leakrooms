/* ============================================================
   GAME CONSTANTS
   Fixed numbers that define how the game behaves. Values that change with
   difficulty are in tuning.js and presets.js.

   Distances are in tiles unless a comment says otherwise. One tile is
   TILE pixels on the baked art.
   ============================================================ */

/* ---------- Map and camera ---------- */
export const TILE   = 40;
export const LS     = 4;                 // light samples per tile in the light bake
export const MAP_W  = 76;
export const MAP_H  = 76;
export const VIEW_T = 27;                // tiles across the viewport

/* The lit face of a wall: how tall the wallpaper band is, as a fraction of a
   tile. It is drawn into the carpet tile BELOW each wall (see bakeTiles in
   render/bake.js) and it is the surface the door is painted on. */
export const WALL_FACE = TILE*0.46;

/* ---------- The door ---------- */
export const DOOR_HOLD = 1.5;      // seconds standing at the door to cycle it
export const DOOR_AJAR = 0.34;     // how far the door rests open once every pipe is sealed
export const DOOR_EASE = 6;        // how quickly the door leaf moves toward its target, per second

/* ---------- Movement and bodies ---------- */
export const WALK   = 3.3;               // tiles per second
export const SPRINT = 6.0;

/* The on-screen stick (touch). First-guess numbers: tune them on a real device. */
export const STICK = Object.freeze({
  DEAD: 0.2,          // fraction of the radius with no response at all
  /* How far you push the stick (as a fraction of its radius) before the plumber
     runs. The player picks one of these in the settings (SPRINT PUSH). They are
     first guesses, to be tuned on a real device. They move only WHEN the stick
     reports sprint, never how loud sprinting is: the noise table (NOISE) and the
     speeds (WALK, SPRINT) are the same for every preset. */
  SPRINT_PRESETS: Object.freeze({ light: 0.75, normal: 0.88, firm: 0.96 }),
  SPRINT_HYST: 0.08,  // a sprint lasts until you come back this far below its preset
  RADIUS_VMIN: 0.11,  // stick radius as a share of the short screen side
  RADIUS_MIN: 44,     // CSS pixels: smallest the stick radius gets
  RADIUS_MAX: 80,     // CSS pixels: largest the stick radius gets
});

/* Plumber (player character) constants */
export const PLUMBER = Object.freeze({
  RADIUS: 0.33,              // collision radius
});

/* Lifeform (hostile creature) constants */
export const LIFEFORM = Object.freeze({
  RADIUS: 0.34,              // collision radius (slightly bulkier)
  WALK_SPEED: 1.5,           // tiles per second while wandering
  WALK_STEP: 0.1,            // extra wander speed per floor
  SEARCH_SPEED: 2.3,         // tiles per second toward a noise it is investigating
  SIGHT: 8,                  // tiles — closer than this and it looks
  SIGHT_DOT: 0.28,           // and only inside this cone of its facing
  SIGHT_AMBIENT: 0.30,       // ...and only if the light you stand in is above this
});

/* The hit zone. A lifeform catches you inside this distance, and draws a disc
   of exactly this radius under itself, so the dangerous area is visible. Both
   read this one constant, so they cannot disagree. */
export const CATCH_R = 0.52;

/* How far in front of the body the character holds the radar. The vision cone
   starts here and the radar is drawn here, so they always match. */
export const HAND_OFF = 0.135;

/* ---------- Battery and radar ---------- */
export const BATT_MAX   = 100;
/* The radar is the only tool and it is expensive: a full battery gives under
   18 seconds of sweeping. It has to be switched off and thought about. */
export const RADAR_DRAIN = 5.6;          // per second while sweeping

/* The radar gauge is drawn as a battery: a shell with a terminal on the right
   and a row of cells inside it that empty from the right as the charge goes.
   BATT_CELLS is how many cells there are, so each one is a step of
   BATT_MAX/BATT_CELLS charge. Below BATT_LOW the lit cells turn red, which
   is the same warning the noise bar gives. */
export const BATT_CELLS = 10;
export const BATT_LOW  = 35;

/* ---------- The leaks ----------
   The player is here because pipes burst, and the water shows where. The only
   fix is to stand still next to a pipe while something in the building walks
   toward the noise.

   The water is the main clue. The radar only reveals space and knows nothing
   about plumbing. Water spreads from the leak and nowhere else, so following
   the wet floor leads to the source without using battery.

   An open pipe is also a standing noise source. That pulls lifeforms toward
   the pipe, which can act as a shield while you search, but the noise is kept
   below LOUD on purpose. A leak above LOUD would wake the whole floor. The
   wrench is the loud part. */

/* The minimum spacing between pipes, in tiles. Without it, the placement
   loop (which prefers the farthest tile) would put every pipe in the same far
   corner, and four pipes would become one pipe sealed four times. */
export const PIPE_GAP = 12;

/* How fast the water front moves outward, in seconds per tile. At 3.2 the
   front advances about half a tile every two seconds: clearly alive, but still
   easy to hold in your head. */
export const LEAK_SPREAD  = 3.2;

/* How fast the water front moves back in once every pipe is sealed, in seconds
   per tile. It is much faster than the arrival. The flood can reach the far
   side of the building (82 to 148 tiles away depending on the floor), so a
   recession at the arrival speed would take longer than the level clock and
   the player would walk home through wet floor for minutes. The recession
   still moves from the edges inward, away from the pipes. */
export const LEAK_RETREAT = 0.5;

/* How long a single tile takes to darken once the front reaches it
   (WET_RISE) and to fade once the front has left it (WET_FALL). This is
   separate from how fast the front moves.

   Together with the front speeds, these decide the width of the damp band
   between dry carpet and open flood:
     coming in:  WET_RISE / LEAK_SPREAD  = 14 / 3.2 = about 4.4 tiles
     going out:  WET_FALL / LEAK_RETREAT = 5 / 0.5  = 10 tiles
   The band going out must not be narrower than the band coming in, or the
   last tiles jump from flooded to dry and the shoreline looks like a hard
   edge. The test suite checks this. */
export const WET_RISE     = 14.0;   // seconds for a soaked tile to go from 0 to 1
export const WET_FALL     = 5.0;    // seconds for an abandoned tile to go from 1 to 0

export const LEAK_NOISE_BASE = 0.16;   // a quiet drip, heard about 6 tiles away
export const LEAK_NOISE_GAIN = 0.26;   // added as the floor floods; the total stays under LOUD
export const LEAK_LURE    = 0.42;   // how close a searching lifeform drifts to a pipe

/* How far from the spawn a pipe may be, measured in a straight line. Indexed
   by pipe count minus one; the last entry repeats for larger counts.

   The cap is on straight-line distance because in a maze, a tile 70 tiles away
   can be 200 tiles of corridor to walk. Choosing the farthest tile overall made
   the repair a two-minute trek, which is a commute and not tension.

   It is also a time budget. Three minutes covers the whole level (every pipe
   plus the walk back), so every extra pipe pulls the reach in. */
export const PIPE_FAR = [56, 48, 42, 38];

/* The flood is pre-warmed this many seconds before the level starts. Without
   it the floor would start dry and the first half minute would have no clue at
   all. At LEAK_SPREAD it is a puddle about 13 tiles out from the break:
   visible from the next room, but small enough to read as a waterline. */
export const LEAK_HEADSTART = 42;

/* ---------- The repair ---------- */
/* Five seconds of standing still is long enough to be a real commitment: you
   choose to be immobile and loud in a building with something in it. */
export const REPAIR_REACH = 1.25;   // how close you must be to the pipe's standing spot
export const REPAIR_DECAY = 2.6;    // whole bars lost per second once you move
/* The wrench's noise power is NOISE.REPAIR: above LOUD, and louder than a
   sprint on purpose. */

/* ---------- Tiles ---------- */
export const WALL = 0, FLOOR = 1;

/* ---------- Room-scoped light ----------
   Two separate things decide what is lit:
     the bake   how bright each tile is under its own lights (per fixture)
     the scope  which of those tiles the player can currently see (per viewer)
   Rooms are separated by walls, and the scope fades with the number of gates
   you must look through (HOP_FALL). The radar overrides all of it while on. */

/* The brightness of a tile when there is no scope at all. This only happens
   if the player is somehow off the map. Normal darkness comes from the scope,
   distance fade and cone multiplied together. */
export const DARK_ROOM      = 0.0;

/* How visible a room is, by how many gates away it is (index = gates passed).
   A gradual falloff lets light arrive smoothly instead of stopping at an
   invisible boundary. */
export const HOP_FALL = [1.0, 0.85, 0.50, 0.26, 0.17, 0.11];

/* Distance fade for rooms that are not your own. Without it a 40-tile corridor
   stays at 11% all the way and looks like a lit tube. Your own room never
   fades with distance (it is at most 12 tiles across). */
export const VIEW_FADE_NEAR = 13;    // full brightness up to this distance
export const VIEW_FADE_FAR  = 31;    // black from this distance

/* How fast the drawn mask follows the freshly calculated one, in seconds. The
   mask is per tile, so tiles enter and leave view one at a time as you walk and
   the edge would flicker. Easing toward the target turns that into a sliding
   edge. It is much shorter than LIGHT_FADE on purpose. */
export const MASK_TAU = 0.055;

/* The dimmest a lit surface can be. With darkness handled by the mask this is
   1.0: a visible surface shows the palette at full strength. The pools of light
   under the tubes come from the additive pass in the renderer, not from this
   value. */
export const BAKE_FLOOR     = 1.0;

export const LIGHT_FADE     = 0.30;   // seconds for the lights to come up when you cross a threshold
export const LIGHT_FADE_STEPS = 10;   // the fade is done in steps, because repacking the image every frame is expensive

/* ---------- Cone of vision ----------
   A 200 degree cone, so there are always 80 degrees of blindness behind you
   and turning is how you look back. It decides what the character can SEE
   (not what is lit) and stops at walls.

   It is traced as a fan of rays. A per-tile angle test would be wrong: it
   lights the floor behind a one-tile partition stub, which the ray trace
   correctly hides. */
export const VIEW_DEG   = 200;
export const VIEW_HALF  = VIEW_DEG*Math.PI/360;      // radians on either side of facing
export const VIEW_RAYS  = 240;                        // how many rays make up the fan
export const VIEW_RANGE = 34;                         // hard stop; the distance fade ends first

/* How close a ray must pass to a tile's centre for the tile to count as
   seen, in tiles. 0.5 is the circle that fits inside the tile and 0.71 is the
   one that touches its corners. Lower and vision looks eaten away at walls;
   higher and a ray clipping a corner counts as seeing the tile. */
export const VIEW_MID   = 0.48;

/* ---------- Render ---------- */

/* The tape look and the flickering lights are part of the game's appearance,
   not player preferences, so they are constants. */
export const VHS_PASS = 0.7;
export const FLICKER_DEPTH = 0.65;

/* The shine on deep water is drawn in this many alpha steps (one path per
   step). The whole range is only 0 to 0.05 alpha, so four steps are too close
   together to show banding. The scratch data is in render/passes/ground.js. */
export const SHEEN_STEPS = 4;

/* Adaptive resolution: the available render scales and when to switch.
   The "drop" and "recover" thresholds are far apart on purpose, so a
   machine near the boundary does not keep switching back and forth. */
export const RENDER_SCALES = [1, 0.8, 0.65, 0.5];
export const SCALE_DROP_MS  = 20;      // average frame time that lowers the resolution
export const SCALE_RECOVER_MS= 12;     // average frame time that allows raising it again
export const SCALE_BAD_FRAMES = 45;    // slow frames needed before lowering
export const SCALE_GOOD_FRAMES = 180;  // fast frames needed before raising

/* A wet tile stops being drawn below WET_DRAW. WET_EDGE, the point where the
   simulation stops updating it, must be lower, or a tile would freeze just above
   the draw cut and stay as a visible damp patch. It cannot be zero either, since
   a tile approaching zero would never be finished. The two are written together
   so they cannot drift apart. */
export const WET_DRAW = 0.015;          // below this a tile is fully transparent
export const WET_EDGE = WET_DRAW*0.8;   // below this the simulation stops updating the tile

/* ---------- Noise ----------
   Every noise power in the game, in one frozen table. They were named
   constants scattered through the simulation, which meant the relationships
   between them (a walk under LOUD, a sprint over it, the wrench above both)
   could only be checked by reading every file. Read them here instead.

   Frozen because this is the stealth contract: a difficulty preset must not
   be able to nudge a number that decides what a lifeform hears. */
export const NOISE = Object.freeze({
  /* What the player makes. */
  WALK: 0.20,          // a dry step; the quiet end of the contract
  WADE: 0.30,          // a wet step — louder, still under LOUD on purpose
  SPRINT: 0.7,        // 3.5 times a walk, and well above LOUD
  REPAIR: 0.85,        // the wrench: the loud decision, above LOUD
  BUMP_SPRINT: 0.55,   // walked into a wall while sprinting
  BUMP_WALK: 0.3,      // walked into a wall
  RADAR: 0.5,          // switching the radar on pings the whole floor

  /* What the building makes, and what happens to you. */
  DOOR: 1.8,           // the door is the loudest thing in the building
  BRUSH: 1.2,          // a lifeform touching you is heard across the floor

  /* The threshold between "makes a lifeform curious" and "wakes or hunts".
     Walking and wading are below it, sprinting and the wrench are above it. */
  LOUD: 0.5,

  /* How far a sound carries: a floor of HEAR_BASE tiles plus HEAR_GAIN per
     unit of power. A walk reaches 6.6 tiles, a sprint 12.6, the wrench 14.2. */
  HEAR_BASE: 4,
  HEAR_GAIN: 12,

  /* How much one wall takes off the distance a sound travels, in tiles. A walk
     is heard 6.6 tiles away in the open, so two walls leave it near the edge of
     hearing and three put it out of range. That makes walls real cover. This
     changes how far sounds carry, not how loud anything is, so LOUD and the
     noise powers are untouched. */
  WALL_COST: 3.0,
});

/** Sound levels used to derive the maximum wall-step count. */
export const SOUND_POWERS = Object.freeze([
  NOISE.WALK,
  NOISE.WADE,
  NOISE.SPRINT,
  NOISE.REPAIR,
  NOISE.BUMP_SPRINT,
  NOISE.BUMP_WALK,
  NOISE.RADAR,
  NOISE.DOOR,
  NOISE.BRUSH,
]);
/** Alias retained for code that names the noise-power set. */
export const NOISE_POWERS = SOUND_POWERS;

/* ---------- Lifeforms ----------
   The things hunting you are not tuning: every number here is the same on
   every difficulty, which is why they are frozen constants and not preset
   values. The chase SPEED lives in config/tuning.js, because a preset is
   allowed to move it. */
/* ---------- Names the rest of the tree already imports ----------
   These read off the table, so there is one place to change a noise power and
   every existing import keeps working. */

/* What a full noise bar means: the loudest sustained thing you can do, the
   wrench. It must not be BATT_MAX. */
export const NOISE_FS = NOISE.REPAIR;

export const LOUD        = NOISE.LOUD;
export const SPRINT_NOISE= NOISE.SPRINT;
export const REPAIR_NOISE= NOISE.REPAIR;
export const DOOR_NOISE  = NOISE.DOOR;
export const BRUSH_NOISE = NOISE.BRUSH;