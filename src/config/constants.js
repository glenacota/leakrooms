export const MAP = Object.freeze({
  TILE_SIZE_PX: 40,
  LIGHT_SAMPLES_PER_TILE: 4,
  WIDTH_TILES: 76,
  HEIGHT_TILES: 76,
  VIEWPORT_WIDTH_TILES: 27,
  // Wider-than-27:12 screens hit this row floor after the width scale is insufficient.
  VIEWPORT_MIN_ROWS: 12,
});

export const TILE_TYPES = Object.freeze({
  WALL: 0,
  FLOOR: 1,
});

export const WALL = Object.freeze({
  FACE_HEIGHT_PX: MAP.TILE_SIZE_PX*0.8,
  // Centres stay clear while sprites overlap wall faces.
  OVERLAP_TILES: 0.15,
  MIN_THICKNESS_TILES: 2,
});

export const DOOR = Object.freeze({
  HOLD_SECONDS: 0.5,
  AJAR_FRACTION: 0.34,
  SWING_EASE_PER_SECOND: 6,
  REACH: 1.25
});

export const MOVEMENT = Object.freeze({
  WALK_SPEED_TILES_PER_SECOND: 3.3,
  SPRINT_SPEED_TILES_PER_SECOND: 6.0,
  SPRINT_STAMINA_SECONDS: 5,
  SPRINT_RECOVERY_SECONDS: 5,
});

export const STICK = Object.freeze({
  DEAD: 0.2,
  /* Presets change only the push threshold, never sprint noise or speed. */
  SPRINT_DISTANCE_PRESETS: Object.freeze({ light: 0.8, normal: 0.9, firm: 1 }),
  SPRINT_RELEASE_MARGIN: 0.08,
  RADIUS_BY_VIEWPORT: 0.2,
  RADIUS_MIN: 44,
  RADIUS_MAX: 100,
});

export const PLUMBER = Object.freeze({
  RADIUS_TILES: 0.33,
});

export const LIFEFORM = Object.freeze({
  RADIUS_TILES: 0.34,
  CATCH_RADIUS_TILES: 0.52,
  WALK_SPEED_TILES_PER_SECOND: 1.5,
  WALK_STEP_TILES_PER_FLOOR: 0.1,
  SEARCH_SPEED_TILES_PER_SECOND: 2.3,
  SIGHT_TILES: 8,
  SIGHT_DOT: 0.28,
  SIGHT_AMBIENT: 0.30,
});

export const RADAR = Object.freeze({
  HAND_OFF_TILES: 0.135,
});

export const BATTERY = Object.freeze({
  MAX_CHARGE: 100,
  // A full battery provides ten seconds of sweeping.
  GAUGE_CELLS: 10,
  LOW_CHARGE: 40,
  RADAR_DRAIN_CHARGE_PER_SECOND: 100 / 10,
});

export const LEAK = Object.freeze({
  GAP_TILES: 12,
  SPREAD_SECONDS_PER_TILE: 3.2,
  // Fast retreat keeps the wet route short after sealing.
  RETREAT_SECONDS_PER_TILE: 0.5,
  NOISE_BASE: 0.16,
  NOISE_GAIN: 0.26,
  LURE_TILES: 0.42,
  FAR_DISTANCE_TILES: Object.freeze([56, 48, 42, 38]),
  HEADSTART_SECONDS: 42,
  REPAIR_REACH_TILES: 1.25,
  REPAIR_DECAY_BARS_PER_SECOND: 2.6,
});

export const WATER = Object.freeze({
  // The retreat band must remain at least as broad as the arrival band.
  TILE_RISE_SECONDS: 14.0,
  TILE_FALL_SECONDS: 2.0,
  DRAW_THRESHOLD: 0.015,
  EDGE_THRESHOLD: 0.015*0.8,
});

export const ROOM_LIGHT = Object.freeze({
  DARK_LEVEL: 0.0,
  SCOPE_FALLOFF: Object.freeze([1.0, 0.30, 0.08, 0.02, 0.01, 0.005]),
  VIEW_FADE_NEAR_TILES: 13,
  VIEW_FADE_FAR_TILES: 31,
  MASK_TAU_SECONDS: 0.055,
  BAKE_FLOOR: 1.0,
  FACE_BACKLIGHT: 0.85,
});

export const VISION = Object.freeze({
  // 200 degrees leaves 80 degrees behind the facing direction.
  DEGREES: 200,
  HALF_RADIANS: 200*Math.PI/360,
  RAYS: 240,
  RANGE_TILES: 34,
  MID_TILE_FRACTION: 0.48,
  PENUMBRA_TILES: 1,
});

export const RENDER = Object.freeze({
  VHS_PASS: 0.7,
  FLICKER_DEPTH: 0.65,
  SHEEN_STEPS: 4,
  // Wide thresholds keep a machine near a boundary from switching scales.
  SCALES: Object.freeze([1, 0.8, 0.65, 0.5]),
  SCALE_DROP_RATIO: 1.2,
  SCALE_RECOVER_RATIO: 0.72,
  SCALE_BAD_FRAMES: 45,
  SCALE_GOOD_FRAMES: 180,
  START_INDEX_HANDHELD: 0,
  LIGHT_FADE_SECONDS: 0.30,
  LIGHT_FADE_STEPS: 10,
});

const NOISE_VALUES = Object.freeze({
  WALK: 0.20,
  WADE: 0.30,
  SPRINT: 0.7,
  REPAIR: 0.85,
  BUMP_SPRINT: 0.55,
  BUMP_WALK: 0.3,
  RADAR: 0.5,
  DOOR: 1.8,
  BRUSH: 1.2,
  LOUD: 0.5,
  HEAR_BASE_TILES: 4,
  HEAR_GAIN_TILES_PER_POWER: 12,
  WALL_COST_TILES: 3.0,
});

/* Difficulty presets must not change hearing behavior. */
export const NOISE = Object.freeze({
  ...NOISE_VALUES,
  FULL_SCALE: NOISE_VALUES.REPAIR,
  POWERS: Object.freeze([
    NOISE_VALUES.WALK,
    NOISE_VALUES.WADE,
    NOISE_VALUES.SPRINT,
    NOISE_VALUES.REPAIR,
    NOISE_VALUES.BUMP_SPRINT,
    NOISE_VALUES.BUMP_WALK,
    NOISE_VALUES.RADAR,
    NOISE_VALUES.DOOR,
    NOISE_VALUES.BRUSH,
  ]),
});

/* Fictional contractor credits, not game currency. */
export const SCORE = Object.freeze({
  LEAK_PAY: 100,
  FLOOR_PAY: 50,
  // The most the early-completion premium can pay: the flood damage avoided by a fast shift.
  PREMIUM_MAX: 300,
  CASUALTY_COST: 150,
  // Charged once when a shift ends without clearing the last floor.
  BREACH_FEE: 300,
});