export const TILE_SIZE_PX = 40;
export const LIGHT_SAMPLES_PER_TILE = 4;
export const MAP_WIDTH_TILES = 76;
export const MAP_HEIGHT_TILES = 76;
export const VIEWPORT_WIDTH_TILES = 27;

// Wider-than-27:12 screens hit this row floor; after the width scale is insufficient
export const VIEWPORT_MIN_ROWS = 12;

// How tall the lit face of a wall is
export const WALL_FACE_HEIGHT_PX = TILE_SIZE_PX*0.8;

// Bodies overlap wall faces but keep their centres clear
export const WALL_OVERLAP_TILES = 0.15;

// The thinnest any wall may be, in tiles
export const MIN_WALL = 2;

export const DOOR_HOLD_SEC = 0.5;
/* Standing within this many tiles of an exit counts as being at the door. Matches the hold in sim/door.js. */
export const DOOR_REACH = 1.25;
export const DOOR_AJAR_FRACTION = 0.34;
export const DOOR_SWING_EASE = 6;

export const WALK_SPEED_TILES_PER_SECOND   = 3.3;
export const SPRINT_SPEED_TILES_PER_SECOND = 6.0;
export const SPRINT_STAMINA_SECONDS = 5;
export const SPRINT_RECOVERY_SECONDS = 5;

export const STICK = Object.freeze({
  DEAD: 0.2,
  /* Presets change only the push threshold, never sprint noise or speed. */
  SPRINT_PRESETS: Object.freeze({ light: 0.75, normal: 0.88, firm: 0.96 }),
  SPRINT_HYST: 0.08,
  RADIUS_VMIN: 0.11,
  RADIUS_MIN: 44,
  RADIUS_MAX: 80,
});

export const PLUMBER = Object.freeze({
  RADIUS: 0.33,
});

export const LIFEFORM = Object.freeze({
  RADIUS: 0.34,
  WALK_SPEED: 1.5,
  WALK_STEP: 0.1,
  SEARCH_SPEED: 2.3,
  SIGHT: 8,
  SIGHT_DOT: 0.28,
  SIGHT_AMBIENT: 0.30,
});

/* Catch distance and drawn danger radius share this value. */
export const CATCH_RADIUS_TILES = 0.52;

/* The radar hand-off position is the start of the shared vision origin. */
export const RADAR_HAND_OFF_TILES = 0.135;

export const BATTERY_MAX_CHARGE   = 100;
/* A full battery provides ten seconds of sweeping. */
export const RADAR_DRAIN_CHARGE_PER_SECOND = BATTERY_MAX_CHARGE / 10;

export const BATTERY_GAUGE_CELLS = 10;
export const BATTERY_LOW_CHARGE  = 40;

/* Prevent four leaks from clustering in the farthest corner. */
export const LEAK_GAP = 12;

/* The front advances about half a tile every two seconds. */
export const LEAK_SPREAD_SECONDS_PER_TILE  = 3.2;

/* Fast retreat keeps the wet route short after sealing and moves inward,
   away from the leaks. */
export const LEAK_RETREAT_SECONDS_PER_TILE = 0.5;

/* The retreat band must remain at least as broad as the arrival band, or the
   shoreline will jump from wet to dry. */
export const WET_TILE_RISE_SECONDS     = 14.0;
export const WET_TILE_FALL_SECONDS     = 2.0;

export const LEAK_NOISE_BASE = 0.16;
export const LEAK_NOISE_GAIN = 0.26;
export const LEAK_LURE    = 0.42;

/* How far from the spawn a leak may be, measured in a straight line. Indexed
   by leak count minus one; the last entry repeats for larger counts.
   The straight-line cap accounts for corridor distance and pulls reach inward
   as the seal workload grows. */
export const LEAK_FAR = [56, 48, 42, 38];

/* Pre-warming starts with a small, legible waterline instead of dry carpet. */
export const LEAK_HEADSTART = 42;

export const REPAIR_REACH = 1.25;
export const REPAIR_DECAY = 2.6;

export const WALL = 0, FLOOR = 1;

export const DARK_ROOM      = 0.0;

/* Falloff is indexed by gates passed, including the starting room. */
export const ROOM_SCOPE_FALLOFF = [1.0, 0.30, 0.08, 0.02, 0.01, 0.005];

export const VIEW_FADE_NEAR = 13;
export const VIEW_FADE_FAR  = 31;

/* The mask eases faster than the light fade to keep edge motion separate. */
export const MASK_TAU = 0.055;

/* Darkness bleeds inward; lit surfaces and pure black stay crisp. */
export const VISION_PENUMBRA_TILES = 1;

/* The wall-face backlight stays low enough to preserve dark interiors. */
export const FACE_BACKLIGHT = 0.85;

export const BAKE_FLOOR     = 1.0;

export const LIGHT_FADE     = 0.30;
export const LIGHT_FADE_STEPS = 10;

/* The cone leaves 80 degrees behind the facing direction. */
export const VIEW_DEG   = 200;
export const VIEW_HALF  = VIEW_DEG*Math.PI/360;
export const VIEW_RAYS  = 240;
export const VIEW_RANGE = 34;

/* 0.48 avoids both wall-edge gaps and corner-clipping false positives. */
export const VIEW_MID   = 0.48;

/* Tape and fixture flicker are fixed appearance, not settings. */
export const VHS_PASS = 0.7;
export const FLICKER_DEPTH = 0.65;

/* Four alpha bands are distinct across the 0 to 0.05 shine range. */
export const SHEEN_STEPS = 4;

/* Drop and recover thresholds have a wide separation to avoid scale hysteresis. */
export const RENDER_SCALES = [1, 0.8, 0.65, 0.5];
export const SCALE_DROP_RATIO = 1.2;
export const SCALE_RECOVER_RATIO = 0.72;
export const SCALE_BAD_FRAMES = 45;
export const SCALE_GOOD_FRAMES = 180;

export const RENDER_START_IDX_HANDHELD = 0;

/* WET_EDGE stays below WET_DRAW so a damp tile cannot freeze above the
   visibility cutoff. */
export const WET_DRAW = 0.015;
export const WET_EDGE = WET_DRAW*0.8;

/* Frozen because difficulty presets must not change hearing behavior. */
export const NOISE = Object.freeze({
  WALK_SPEED_TILES_PER_SECOND: 0.20,
  WADE: 0.30,
  SPRINT_SPEED_TILES_PER_SECOND: 0.7,
  REPAIR: 0.85,
  BUMP_SPRINT: 0.55,
  BUMP_WALK: 0.3,
  RADAR: 0.5,

  DOOR: 1.8,
  BRUSH: 1.2,

  LOUD: 0.5,
  HEAR_BASE: 4,
  HEAR_GAIN: 12,
  WALL_COST: 3.0,
});

export const SOUND_POWERS = Object.freeze([
  NOISE.WALK_SPEED_TILES_PER_SECOND,
  NOISE.WADE,
  NOISE.SPRINT_SPEED_TILES_PER_SECOND,
  NOISE.REPAIR,
  NOISE.BUMP_SPRINT,
  NOISE.BUMP_WALK,
  NOISE.RADAR,
  NOISE.DOOR,
  NOISE.BRUSH,
]);
/* A full noise bar represents the loudest sustained action, not battery. */
export const NOISE_FULL_SCALE = NOISE.REPAIR;

export const LOUD        = NOISE.LOUD;
export const SPRINT_NOISE= NOISE.SPRINT_SPEED_TILES_PER_SECOND;
export const REPAIR_NOISE= NOISE.REPAIR;
export const DOOR_NOISE  = NOISE.DOOR;
export const BRUSH_NOISE = NOISE.BRUSH;