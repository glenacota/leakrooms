/* ============================================================
   LEAKROOMS
   2D top-down puzzle / stealth. JS + canvas only, no assets.

   Design contract:
   - There is ONE door: the one you came in through. You seal the pipes,
     then you get back to it before the clock runs out.
   - The radar is INFORMATION ONLY. It reveals the scrawled warnings.
     It never repels, never lies to the monster.
   - You see a 200 degree cone, stopped by walls, and only
     the room you are standing in is lit. The radar overrides
     both — for as long as the battery lasts, which is not long.
   - Noise is the entire stealth layer. Sprinting is fast and fatal.
   - The Lifeform: coiled black wire. Dormant = a pile of loops.
     It RISES when it hears you. That 1.4s animation is your window.
   ============================================================ */ 

/* ---------- deterministic RNG ---------- */
function mulberry32(a){
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- tuning ---------- */
const TILE   = 40;
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
const WALL_FACE = TILE*0.46;
const LS     = 4;                 // light samples per tile
const MAP_W  = 76;
const MAP_H  = 76;
const VIEW_T = 27;                // tiles across the viewport
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
const LEVELS = [
  { leaks:1, forms:1 },   // 1 — one pipe, one thing, learn the round trip
  { leaks:2, forms:2 },   // 2 — twice the work, the building starts paying attention
  { leaks:3, forms:2 },
  { leaks:4, forms:3 },
  { leaks:4, forms:4 }
];
const LEVELS_N = LEVELS.length;
/* How long you have on each level to seal every pipe and get back to the door
   you came in through. This is the whole pressure of a floor: the water is the
   clock's excuse, the walk back is what it actually spends. */
let FLOOR_CLOCK = 180;      // seconds; NORMAL

/* --- the door ---
   The one door on the floor is a leaf on a hinge, not a rectangle of colour,
   so these are the three numbers that describe how it behaves. */
const DOOR_HOLD = 1.5;      // seconds standing at it
const DOOR_AJAR = 0.34;     // the swing it rests at once the pipes are sealed
const DOOR_EASE = 6;        // per second; leaves the frame looking at a door

/* These are `let` rather than `const` because the settings modal drives
   them. Their initialisers are the NORMAL preset and are the documented
   tuning; applySettings() overwrites them at load. The noise table below is
   NOT among them, and deliberately so — see the difficulty note. */
let FLOORS      = LEVELS_N;       // every preset plays all five; see DIFFICULTIES
let HUNT_BASE   = 3.45;           // tiles/sec, a committed Lifeform on level 1
let HUNT_STEP   = 0.34;           // extra per level

const WALK   = 3.3;               // tiles/sec
const SPRINT = 6.0;
const R      = 0.33;              // player collision radius (tiles)
const RA     = 0.34;              // Lifeform collision radius (bulkier)

/* THE HIT ZONE. brush() kills at this distance, and the Stalker draws a disc
   of exactly this radius under itself, so the thing that can touch you is
   visible rather than implied. One constant, two readers: if the radius ever
   moves, the picture moves with it. */
const CATCH_R = 0.52;
/* How far in front of the body the character holds their gear, in tiles. This
   is both where the vision cone originates and where the device is drawn on
   the avatar, so the two can never disagree. */
const HAND_OFF = 0.135;

const BATT_MAX   = 100;
/* The radar is the only tool, and it is expensive. At 5.6/s a full battery is
   under 18 seconds of sweep — long enough to cross a floor or two, never long
   enough to leave it running. The torch it replaced drained 2.4/s and could be
   held indefinitely, which made the budget a formality rather than a decision;
   this one has to be switched off and thought about. */
const RADAR_DRAIN = 5.6;          // per second while sweeping
/* How far apart two pipes may be placed, in tiles. Without it the placement
   loop — which always takes the farthest candidate — stacks every burst in the
   same far corner of the floor, and four pipes become one pipes you seal four
   times in the same five seconds. The floor has to be a tour. */
const PIPE_GAP = 12;

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
const LEAK_SPREAD  = 3.2;    // s of travel per tile — the water front's speed, going OUT
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
const LEAK_RETREAT = 0.5;   // s of travel per tile — the water front's speed, going IN
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
const WET_RISE     = 14.0;   // s for a soaked tile to go 0 -> 1
const WET_FALL     = 5.0;    // s for an abandoned tile to go 1 -> 0
const LEAK_NOISE_BASE = 0.16;   // a quiet drip, heard ~6 tiles
const LEAK_NOISE_GAIN = 0.26;   // added as the floor drowns; still under LOUD
const LEAK_LURE    = 0.42;   // tiles: a SEARCHING entity drifts this close
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
const PIPE_FAR = [56, 48, 42, 38];
/* The pipe has been open for a while before you got here. Without this the
   floor starts bone dry and the first half-minute has no cue in it at all —
   you would have to wander blindly until water happened to reach you, which
   is the exact opposite of "follow the wet floor downhill". At LEAK_SPREAD this
   is a puddle about thirteen tiles across already standing around the break —
   enough to see from the next room, small enough that you are reading a
   waterline rather than surveying a lake. */
const LEAK_HEADSTART = 42;   // seconds of flood pre-warmed at level start

/* The repair itself. Five seconds is long enough that standing there is a
   commitment, and the commitment is the whole point of the mechanic: you are
   choosing to be immobile and loud in a building with something in it. */
let REPAIR_TIME    = 5.0;    // seconds of unbroken contact to seal the pipe
const REPAIR_REACH = 1.25;   // tiles from the pipe face
const REPAIR_DECAY = 2.6;    // whole-bars lost per second once you move
const REPAIR_NOISE = 0.85;   // LOUD. Louder than running. That is the point.

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
const SPRINT_NOISE = 0.72;

const WALL = 0, FLOOR = 1;

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
const DARK_ROOM      = 0.0;

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
const HOP_FALL = [1.0, 0.62, 0.40, 0.26, 0.17, 0.11];   // index = gates passed

/* Distance attenuation, applied ONLY to regions that are not your own. Without
   it a 40-tile corridor stays at 11% all the way to the far wall and reads as
   a lit tube rather than a corridor receding into the dark. Your own room gets
   no distance falloff at all: it is at most 12 tiles across, and dimming the
   far corner of the room you are standing in is the one thing this whole
   feature must never do. */
const VIEW_FADE_NEAR = 13;    // tiles, full brightness up to here
const VIEW_FADE_FAR  = 31;    // tiles, black from here

/* How fast the drawn mask chases the freshly traced one. The mask is per
   TILE, so even retraced every frame it is quantised — tiles enter and leave
   the fan one at a time as you walk and the boundary of vision chatters.
   Approaching the target exponentially turns that into sliding motion. */
const MASK_TAU = 0.055;       // s; much shorter than LIGHT_FADE on purpose

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
const BAKE_FLOOR     = 1.0;

const LIGHT_FADE     = 0.30;   // s, fluorescents coming up as you cross a threshold
const LIGHT_FADE_STEPS = 10;   // the fade is quantised: a repack per frame is 116k writes

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
const VIEW_DEG   = 200;
const VIEW_HALF  = VIEW_DEG*Math.PI/360;      // radians either side of facing
const VIEW_RAYS  = 240;                        // angular fan resolution
const VIEW_RANGE = 34;                         // hard stop; the distance fade ends first
/* VIEW_MID is how close a ray must pass to a tile's CENTRE for that tile to
   count as seen. It is a radius in tiles: 0.5 is the inscribed circle, 0.71
   the circumscribed one. Below 0.5 the tile goes black before its edge, which
   makes vision look eaten away at the walls; at 0.71 a corner sliver counts as
   seeing the tile, which is the leak this exists to stop. */
const VIEW_MID   = 0.48;

/* ---------- canvas ---------- */
const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d', { alpha:false });
let VW = 0, VH = 0, DPR = 1, SCALE = 1;

/* VHS_PASS and FLICKER_DEPTH used to be slider positions. They are constants
   now: the scanline crawl and the stuttering tubes are how the place is lit,
   and a preference for "less of the look" is not a preference the game can
   honour without becoming a different game. Everything that reads them reads
   these, so restoring a slider later is a matter of wiring the control, not
   of hunting the values back out of the renderer. */
const VHS_PASS = 0.7;
const FLICKER_DEPTH = 0.65;

function resize(){
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  VW = cvs.clientWidth; VH = cvs.clientHeight;
  cvs.width = Math.floor(VW * DPR);
  cvs.height = Math.floor(VH * DPR);
  SCALE = cvs.width / (VIEW_T * TILE);
  if (cvs.width > 0 && cvs.height > 0){ buildGrainFull(); buildVignette(); buildDangerWash(); }
  if (G) paintSplashPlan();
}
window.addEventListener('resize', resize);

/* ============================================================
   SETTINGS
   ============================================================ */

/* The water palette. The leak is the ONLY non-yellow hue in the world and it
   is the entire cue, so a player who cannot separate this from the carpet
   cannot play the mechanic at all. `damp` is what compositing wet carpet looks
   like; `deep` is the hue that finally wins. Every value here is chosen by
   solving for the composited tile, not by picking a colour that looks like
   water in isolation — see packWet().

   `grey` is the accessibility option: no hue at all, just a hard value
   difference, for anyone who cannot separate slate from olive. */
const WATER_TINTS = {
  slate:  { damp:[54,50,40],  deep:[32,76,112] },
  teal:   { damp:[44,52,46],  deep:[24,88,98]  },
  violet: { damp:[54,44,58],  deep:[78,50,114] },
  grey:   { damp:[40,40,40],  deep:[104,104,108] },
};

/* Difficulty. PRESETS, not a slider, and they move COUNTS AND SPACING only:
   lives, how long you get on the clock, how long the repair takes, and how fast
   the Lifeform commits. None of them touches the noise table, and that is the
   whole discipline here — walk/wading staying under LOUD is the design contract,
   and a difficulty control that could push a quiet noise over the line would let
   a player configure the stealth layer out of the game. The suite asserts this.

   Note what is NOT here any more: the level count. The five levels are the run,
   not a setting — a preset that gave you four of them meant the game had five
   endings depending on which menu you picked, and there is only one of those
   worth designing. */
const DIFFICULTIES = {
  relaxed: { lives:5, clock:240, repairTime:7.0, huntBase:2.90, huntStep:0.26,
             label:'RELAXED' },
  normal:  { lives:3, clock:180, repairTime:5.0, huntBase:3.45, huntStep:0.34,
             label:'NORMAL' },
  hard:  { lives:1, clock:150, repairTime:4.0, huntBase:4.05, huntStep:0.42,
             label:'HARD' },
};

const SETTINGS_DEFAULTS = {
  difficulty: 'normal',
  master: 0.7,
  /* M is a toggle, not a slider position, so it is stored as a bool and has no
     control in the modal — it is a hotkey, and the only place it is visible is
     the toast it raises when you press it. Persisted like everything else: a
     player who muted the game once is a player who has muted it five times. */
  muted: false,
  waterHue: 'slate',
  waterContrast: 1.0,
};

/* Every field, its type, and its allowed range. The store validates against
   this rather than trusting whatever is in localStorage: a stale blob from an
   older build, a hand-edited value, or a half-written one must degrade to the
   default for THAT FIELD and leave the rest alone. Validating per field is
   what makes that true. */
const SETTINGS_SCHEMA = {
  difficulty:     { type:'enum', values:Object.keys(DIFFICULTIES) },
  master:         { type:'range', min:0, max:1 },
  muted:          { type:'bool' },
  waterHue:       { type:'enum', values:Object.keys(WATER_TINTS) },
  waterContrast:  { type:'range', min:0.4, max:2 },
};

const SETTINGS_KEY = 'leakrooms.settings.v1';
let SETTINGS = Object.assign({}, SETTINGS_DEFAULTS);

function settingsValid(key, v){
  const s = SETTINGS_SCHEMA[key];
  if (!s) return false;
  if (s.type === 'enum') return s.values.indexOf(v) >= 0;
  if (s.type === 'bool') return typeof v === 'boolean';
  if (s.type === 'range') return typeof v === 'number' && Number.isFinite(v)
                            && v >= s.min && v <= s.max;
  return false;
}

/* Read the store. EVERY failure path returns defaults for the affected field
   and never throws: localStorage is absent in the headless suite, throws on
   some file:// origins, and can be disabled entirely in private browsing. A
   settings system is never allowed to be the reason the game does not start. */
function loadSettings(){
  /* Always load over DEFAULTS rather than over whatever is live. The first
     version overlaid onto the current SETTINGS, which meant the result
     depended on WHEN it was called: a field absent from the blob kept
     whatever value it happened to hold, so loading a partial blob after a
     Hard run left you Hard. Loading is a total function of the blob and
     nothing else. */
  SETTINGS = Object.assign({}, SETTINGS_DEFAULTS);
  let raw = null;
  try { raw = localStorage.getItem(SETTINGS_KEY); } catch(e){ return SETTINGS; }
  if (!raw) return SETTINGS;
  let obj = null;
  try { obj = JSON.parse(raw); } catch(e){ return SETTINGS; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return SETTINGS;
  for (const k of Object.keys(SETTINGS_SCHEMA)){
    if (Object.prototype.hasOwnProperty.call(obj, k) && settingsValid(k, obj[k])){
      SETTINGS[k] = obj[k];
    }
  }
  return SETTINGS;
}

function saveSettings(){
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS)); return true; }
  catch(e){ return false; }
}

function resetSettings(){
  SETTINGS = Object.assign({}, SETTINGS_DEFAULTS);
  /* Same reason as setOption's water keys: the default tint may differ from the
     one on screen, and reset writes SETTINGS without going through setOption. */
  waterDirty = true;
  applySettings();
  saveSettings();
}

/* Push the store into everything that reads a tuning value. Called on load and
   on every change from the modal, so a setting takes effect immediately rather
   than at the next run. */
function applySettings(){
  const d = DIFFICULTIES[SETTINGS.difficulty] || DIFFICULTIES.normal;
  FLOORS       = LEVELS_N;
  FLOOR_CLOCK  = d.clock;
  REPAIR_TIME  = d.repairTime;
  HUNT_BASE    = d.huntBase;
  HUNT_STEP    = d.huntStep;
  Audio_.setMaster(SETTINGS.master);
  /* Both of them, or the settings modal becomes a lie. M flips the stored flag
     through setOption, which lands here — and this used to push only the volume,
     so the mute persisted perfectly and changed nothing at all. A setting that
     saves, survives a reload, and has no effect is the worst kind of setting,
     because the reload appears to prove it worked. */
  Audio_.setMuted(SETTINGS.muted);
}

/* ============================================================
   AUDIO — synthesized, deliberately minimal.
   fluorescent hum, wet carpet footsteps, proximity drone, hiss
   ============================================================ */
const Audio_ = {
  ctx:null, ok:false,
  hum:null, humGain:null,
  hiss:null, hissGain:null,
  drone:null, droneGain:null, droneFilter:null,
  /* The two continuous noise beds. See noiseFloor() and leakBed(). */
  floorGain:null, floorFilter:null,
  leakGain:null, leakFilter:null,
  master:null, mute:null, masterVol:0.7, muted:false,
  amb:null, ambOn:false, _ambTimer:null, _ambNext:0,

  init(){
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const a = this.ctx;

    // 2s white-noise buffer, reused for hiss / steps / sting
    const len = a.sampleRate * 2;
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i=0;i<len;i++) d[i] = Math.random()*2-1;
    this.noise = buf;

    /* --- MASTER. Every voice below connects to this and not to destination.
       There is no other way to make a volume slider: each of the eleven voices
       used to wire itself straight to the speakers, so turning the game down
       meant editing eleven call sites. One node in front of all of them is the
       whole feature. It is also the node the settings modal drives, and it is
       created before anything connects to it.

       ...and it connects to the DESTINATION. This line read
       `connect(this.master)` — the master wired to itself — which builds a closed
       loop: every voice in the game chains up into a node that goes nowhere, and
       the result is total silence that behaves perfectly in every other
       respect. No voice is missing, no voice throws, the master gain tracks the
       slider; the graph simply terminates in a circle.

       It survived because the headless harness runs with no AudioContext at all,
       so every voice method returns on `if (!this.ok)` before it builds a node —
       a graph bug is only findable by building the graph, so the suite now does
       that too. */
    this.master = a.createGain();
    this.master.gain.value = SETTINGS.master;
    /* MUTE IS ITS OWN NODE, downstream of the volume slider. It used to be
       folded into the master by pushing the slider to zero, which reads as a
       game with no sound rather than a game you have turned the sound off, and
       — worse — makes the two settings fight: raise the volume while muted and
       the sound comes back by surprise. A separate gain means M is M, the slider
       is the slider, and unmuting restores exactly the volume you had. */
    this.mute = a.createGain();
    this.mute.gain.value = SETTINGS.muted ? 0 : 1;
    this.master.connect(this.mute);
    this.mute.connect(a.destination);

    // --- 60Hz fluorescent hum + its 2nd/3rd harmonics ---
    this.humGain = a.createGain();
    this.humGain.gain.value = 0.055;
    this.humGain.connect(this.master);
    [[60,0.55],[120,0.3],[180,0.12]].forEach(([f,g])=>{
      const o = a.createOscillator(); o.type='sine'; o.frequency.value=f;
      const gg = a.createGain(); gg.gain.value=g;
      o.connect(gg); gg.connect(this.humGain); o.start();
    });

    // --- tape hiss ---
    this.hissGain = a.createGain();
    this.hissGain.gain.value = 0.012;
    const hp = a.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=3800;
    const hs = a.createBufferSource(); hs.buffer=buf; hs.loop=true;
    hs.connect(hp); hp.connect(this.hissGain); this.hissGain.connect(this.master);
    hs.start();

    // --- proximity drone (Lifeform) ---
    this.droneGain = a.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter = a.createBiquadFilter();
    this.droneFilter.type='lowpass'; this.droneFilter.frequency.value=180;
    this.droneGain.connect(this.droneFilter); this.droneFilter.connect(this.master);
    const o1=a.createOscillator(); o1.type='sawtooth'; o1.frequency.value=41;
    const o2=a.createOscillator(); o2.type='sine';     o2.frequency.value=55.5;
    const g2=a.createGain(); g2.gain.value=0.6;
    o1.connect(this.droneGain); o2.connect(g2); g2.connect(this.droneGain);
    o1.start(); o2.start();

    /* --- THE NOISE FLOOR.
       A bandpassed noise layer whose gain IS the HUD's NOISE bar, plus a low
       sine under it that only comes up as the bar fills. This is the layer that
       makes the meter and the mix the same fact: every noise source in the game
       is a one-shot with a fixed peak, so a bar that fills and a mix that does
       not change are two different instruments reporting two different
       numbers. It ramps at 0.06s — fast enough to answer the bar, slow enough
       that a 0.26s sprint burst does not click. */
    this.floorGain = a.createGain();
    this.floorGain.gain.value = 0;
    this.floorFilter = a.createBiquadFilter();
    this.floorFilter.type='bandpass';
    this.floorFilter.frequency.value=520; this.floorFilter.Q.value=0.8;
    this.floorFilter.connect(this.floorGain);
    this.floorGain.connect(this.master);
    const fn=a.createBufferSource(); fn.buffer=buf; fn.loop=true;
    fn.playbackRate.value=1;
    fn.connect(this.floorFilter); fn.start();
    /* the pressure under it — inaudible while you walk, there when you wrench */
    const fr=a.createOscillator(); fr.type='sine'; fr.frequency.value=74;
    const frg=a.createGain(); frg.gain.value=0.55;
    fr.connect(frg); frg.connect(this.floorGain); fr.start();

    /* --- THE LEAK BED.
       What an open pipe actually sounds like: pressurised water, not a drip.
       One shared voice, gain driven by the pipes' TOTAL noise and pulled down
       with distance to the nearest open one, so a burst pipe is something you
       can walk toward with your ears. It is under the wrench by construction —
       the wrench has to stay the loudest decision in the game. */
    this.leakGain = a.createGain();
    this.leakGain.gain.value = 0;
    this.leakFilter = a.createBiquadFilter();
    this.leakFilter.type='bandpass';
    this.leakFilter.frequency.value=1400; this.leakFilter.Q.value=0.6;
    this.leakFilter.connect(this.leakGain);
    this.leakGain.connect(this.master);
    const ln=a.createBufferSource(); ln.buffer=buf; ln.loop=true;
    ln.playbackRate.value=1.25;
    ln.connect(this.leakFilter); ln.start();
    /* gurgle: the same noise, lowpassed and breathing slowly */
    const lg=a.createBiquadFilter(); lg.type='lowpass'; lg.frequency.value=260; lg.Q.value=2;
    lg.connect(this.leakGain);
    const ln2=a.createBufferSource(); ln2.buffer=buf; ln2.loop=true;
    ln2.playbackRate.value=0.55;
    ln2.connect(lg); ln2.start();
    const llfo=a.createOscillator(); llfo.frequency.value=0.7;
    const llg=a.createGain(); llg.gain.value=140;
    llfo.connect(llg); llg.connect(lg.frequency); llfo.start();

    /* The store is applied AFTER the graph exists rather than before, because
       applySettings() runs at boot and could not reach a node that had not been
       built yet — which is how a restored "muted" used to be silently ignored
       for the whole session. `ok` goes true first: both setters guard on it. */
    this.ok = true;
    this.setMaster(SETTINGS.master);
    this.setMuted(SETTINGS.muted);
  },

  /* How much louder a one-shot sounds for making more noise. Without it every
     voice had a fixed peak and the two loudest things in the game — a sprint at
     1.0 and a wrench at 0.85 — were only distinguishable by the HUD. Walking
     (0.22) comes out at 1.09x, sprinting at 2.0x, so the bar and the speakers
     finally agree. Applied to the peaks, never to the master: this is the mix,
     not the volume slider. */
  powerVol(p){ return 0.8 + Math.min(2, Math.max(0, p||0))*1.3; },

  step(vol, power){                 // wet carpet footstep
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const k=this.powerVol(power);
    const s=a.createBufferSource(); s.buffer=this.noise;
    s.playbackRate.value = 0.7 + Math.random()*0.4;
    const f=a.createBiquadFilter(); f.type='lowpass'; f.frequency.value=520;
    const g=a.createGain();
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(0.10*vol*k, t+0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.17);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t+0.2);
  },

  splash(vol, wet, power){         // footstep through standing water
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const k=this.powerVol(power);
    const s=a.createBufferSource(); s.buffer=this.noise;
    s.playbackRate.value = 1.1 + Math.random()*0.5;
    /* Deeper water is a lower, longer splash. Filtered LOW rather than high:
       the wet carpet step is already a lowpass, so a wet step has to move the
       other way to be distinguishable from a dry one at a glance. */
    const f=a.createBiquadFilter(); f.type='lowpass';
    f.frequency.value = 900 + wet*700;
    const g=a.createGain();
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(0.11*vol*k, t+0.010);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.22);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t+0.25);
  },

  drip(vol){                      // the leak, at range — a positional cue
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const o=a.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(900+Math.random()*700, t);
    o.frequency.exponentialRampToValueAtTime(180, t+0.09);
    const f=a.createBiquadFilter(); f.type='lowpass'; f.frequency.value=2600;
    const g=a.createGain();
    /* 0.08 rather than 0.035: the drip is the only cue that says WHICH pipe, and
       at the old peak it was under the tape hiss from two rooms away. */
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(0.08*vol, t+0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.13);
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); o.stop(t+0.15);
  },

  wrench(power){                   // working the pipe — loud, on purpose
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const k=this.powerVol(power);
    for (let i=0;i<3;i++){
      const st = t + i*0.16 + Math.random()*0.05;
      const o=a.createOscillator(); o.type='square';
      o.frequency.setValueAtTime(240+Math.random()*160, st);
      o.frequency.exponentialRampToValueAtTime(90, st+0.12);
      const f=a.createBiquadFilter(); f.type='bandpass';
      f.frequency.value=1500; f.Q.value=4;
      const g=a.createGain();
      g.gain.setValueAtTime(0.0001,st);
      g.gain.exponentialRampToValueAtTime(0.085*k, st+0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st+0.16);
      o.connect(f); f.connect(g); g.connect(this.master);
      o.start(st); o.stop(st+0.18);
    }
  },

  seal(){                          // the pipe stops
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const o=a.createOscillator(); o.type='sawtooth';
    o.frequency.setValueAtTime(320,t);
    o.frequency.exponentialRampToValueAtTime(52,t+0.9);
    const f=a.createBiquadFilter(); f.type='lowpass';
    f.frequency.setValueAtTime(3200,t);
    f.frequency.exponentialRampToValueAtTime(180,t+0.9);
    const g=a.createGain();
    g.gain.setValueAtTime(0.14,t);
    g.gain.exponentialRampToValueAtTime(0.0001,t+1.1);
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); o.stop(t+1.2);
  },

  /* THE KUDOS — what a sealed floor sounds like. seal() turned the right way
     round: the same saw and the same filter sweep, but climbing instead of
     falling, and the hiss-stop underneath it is the noise bed being pulled
     shut as the chord opens. The room goes QUIET on success, which is the one
     thing sting() never does, and the quiet is the reward — the whole level
     has been four pipes hissing and something walking toward them.

     A major triad a fifth and a fourth up, staggered by 90ms and detuned a
     hair each side, so it lands as a chime on a tape deck rather than as a
     chord from an instrument. Nothing here is tuned to a key; there is no
     music in this building and the win sting is not going to start one. */
  acclaim(){
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    this.silenceBeds();                  // the old floor stops gurgling behind the card

    /* the hiss-stop */
    const s=a.createBufferSource(); s.buffer=this.noise;
    s.playbackRate.value = 0.8;
    const hf=a.createBiquadFilter(); hf.type='highpass'; hf.frequency.value=1800;
    const hg=a.createGain();
    hg.gain.setValueAtTime(0.10,t);
    hg.gain.exponentialRampToValueAtTime(0.0001,t+0.45);
    s.connect(hf); hf.connect(hg); hg.connect(this.master);
    s.start(t); s.stop(t+0.5);

    /* the rising seal — filter and pitch climbing together, the opposite sweep */
    const o=a.createOscillator(); o.type='sawtooth';
    o.frequency.setValueAtTime(96,t);
    o.frequency.exponentialRampToValueAtTime(392,t+0.55);
    const f=a.createBiquadFilter(); f.type='lowpass';
    f.frequency.setValueAtTime(600,t);
    f.frequency.exponentialRampToValueAtTime(3800,t+0.55);
    const g=a.createGain();
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(0.11,t+0.05);
    g.gain.exponentialRampToValueAtTime(0.0001,t+0.8);
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); o.stop(t+0.9);

    /* the triad */
    const notes=[523.25, 659.25, 783.99];
    for(let i=0;i<3;i++){
      const n=a.createOscillator(); n.type='sine';
      n.frequency.value = notes[i] * (1 + (i-1)*0.0015);
      const ng=a.createGain();
      const st=t+i*0.09;
      ng.gain.setValueAtTime(0.0001,st);
      ng.gain.exponentialRampToValueAtTime(0.10/(i+1.4), st+0.02);
      ng.gain.exponentialRampToValueAtTime(0.0001, st+1.1);
      n.connect(ng); ng.connect(this.master);
      n.start(st); n.stop(st+1.2);
    }
  },

  rattle(vol){                     // wire shifting
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    for(let i=0;i<5;i++){
      const s=a.createBufferSource(); s.buffer=this.noise;
      s.playbackRate.value = 1.4 + Math.random();
      const f=a.createBiquadFilter(); f.type='bandpass';
      f.frequency.value = 1400+Math.random()*2600; f.Q.value=7;
      const g=a.createGain();
      const st=t+i*0.045+Math.random()*0.02;
      g.gain.setValueAtTime(0.0001,st);
      g.gain.exponentialRampToValueAtTime(0.05*vol, st+0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, st+0.07);
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start(st); s.stop(st+0.09);
    }
  },

  sting(){                         // caught
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const s=a.createBufferSource(); s.buffer=this.noise;
    const f=a.createBiquadFilter(); f.type='lowpass';
    f.frequency.setValueAtTime(5200,t);
    f.frequency.exponentialRampToValueAtTime(90,t+1.3);
    const g=a.createGain();
    g.gain.setValueAtTime(0.32,t);
    g.gain.exponentialRampToValueAtTime(0.0001,t+1.5);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t+1.6);
  },

  door(power){                    // heavy door cycling open
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const k=this.powerVol(power);
    const o=a.createOscillator(); o.type='sawtooth';
    o.frequency.setValueAtTime(70,t);
    o.frequency.exponentialRampToValueAtTime(28,t+1.1);
    const f=a.createBiquadFilter(); f.type='lowpass'; f.frequency.value=420;
    const g=a.createGain();
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(0.16*k, t+0.08);
    g.gain.exponentialRampToValueAtTime(0.0001,t+1.2);
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); o.stop(t+1.3);
  },

  /* ---------- THE TWO NOISE BEDS ----------
     Continuous voices: they move a gain that already exists rather than building
     one per call. Both are driven from tickAudio, which is the only place that
     knows the current noise level. */

  /* The HUD bar, in the speakers. `level` is G.noise/NOISE_FS, so the mix IS
     the meter rather than a mood running alongside it. Gain follows the square,
     because a bar a third full should sound like a third of the way to
     shouting, not a third of shouting. */
  noiseFloor(level){
    if (!this.ok) return;
    const t=this.ctx.currentTime;
    const l=Math.max(0, Math.min(1, level||0));
    this.floorGain.gain.setTargetAtTime(l*l*0.11, t, 0.06);
    this.floorFilter.frequency.setTargetAtTime(500 + l*2600, t, 0.1);
  },

  /* The open pipes. `total` is their summed noise — the same number the
     water-blue floor of the bar draws — and `dist` the distance to the nearest
     one. Attenuation is squared so the pipe is a direction you can walk toward
     rather than a level that is simply always on. */
  leakBed(total, dist){
    if (!this.ok) return;
    const t=this.ctx.currentTime;
    const l=Math.max(0, Math.min(1, total||0));
    const near=Math.max(0, 1 - Math.max(0, dist==null?99:dist)/20);
    this.leakGain.gain.setTargetAtTime(l*near*near*0.16, t, 0.12);
    this.leakFilter.frequency.setTargetAtTime(1100 + near*2400, t, 0.15);
  },

  /* Both beds off. For death and for leaving play, where update() stops running
     and would otherwise freeze them at whatever they last were told. */
  silenceBeds(){
    if (!this.ok) return;
    const t=this.ctx.currentTime;
    this.floorGain.gain.setTargetAtTime(0, t, 0.15);
    this.leakGain.gain.setTargetAtTime(0, t, 0.2);
  },

  drone(level){
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const g = level * 0.16;
    this.droneGain.gain.setTargetAtTime(g, t, 0.35);
    this.droneFilter.frequency.setTargetAtTime(140 + (1-level)*40 + 90*level, t, 0.4);
  },
  silence(){ if (this.ok) this.droneGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); },

  /* Live volume. Ramped rather than assigned, and clamped to a small floor
     rather than to zero: a mute slider that truly reaches 0 leaves the graph
     in a state where a later unmute has to re-prime it, and a 0.0001 gain is
     inaudible in practice. */
  setMaster(v){
    this.masterVol = Math.max(0.02, Math.min(1, v));
    if (this.ok && this.master) this.master.gain.setTargetAtTime(this.masterVol, this.ctx.currentTime, 0.05);
  },

  /* M. Separate from the slider by design — see the note where the node is
     built. Ramps rather than jumps, so toggling it mid-chord does not click. */
  setMuted(v){
    this.muted = !!v;
    if (this.ok && this.mute) this.mute.gain.setTargetAtTime(this.muted?0:1, this.ctx.currentTime, 0.04);
  },

  /* Browsers will not let an AudioContext start without a user gesture, so the
     context exists from boot and stays silent until the first key or click.
     Every interaction that can start the game already runs through one of the
     two entry points that call this, so there is nothing to add to the wiring. */
  unlock(){
    if (this.ctx && this.ctx.state==='suspended' && this.ctx.resume) this.ctx.resume();
  },

  /* A soft confirmation tone, so pressing M is never a guess. Deliberately not
     one of the game's own sounds: this is the shell talking, not the building,
     and reusing a footstep for a UI acknowledgement is how a control ends up
     sounding like it broke something. */
  blip(up){
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const o=a.createOscillator(); o.type='sine'; o.frequency.value = up?520:390;
    const g=a.createGain(); g.gain.value=0.0001;
    g.gain.exponentialRampToValueAtTime(0.05, t+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.22);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t+0.25);
  },

  /* ---------- THE SPLASH BED ----------
     A title screen with a noise floor and a held chord under it, so the first
     thing you hear is the building rather than a menu. Three layers, all
     synthesised, all very slow:

       ROOM   filtered noise, the band drifting under 0.04Hz. Air handling in an
              empty corridor. This is the "noise" half of the brief and it does
              most of the work — it is the layer you stop hearing, which is the
              point of putting it in.
       PAD    three detuned saws (A1, A1 a third of a semitone up, E2) through
              a lowpass whose cutoff is itself drifting at 0.02Hz. Low key,
              literally: nothing here is above 165Hz.
       NOTES  one triangle note every 7-14 seconds out of A minor pentatonic,
              two seconds of attack and six of release. "Very slow" here is a
              scheduling decision, not a tempo — there is no tempo.

     Notes are scheduled a second ahead from an interval rather than fired by a
     timeout at the moment they are due: setTimeout drifts by tens of
     milliseconds and an LFO with a twenty second period cares about that. */
  ambience(on){
    if (!this.ok || on===this.ambOn) return;
    this.ambOn = on;
    if (on) this._ambStart(); else this._ambStop();
  },
  _ambStart(){
    /* Guarded on the context as well as on `ok`: ambience() checks both, but a
       half-built bed is the kind of thing that leaves a setInterval running
       against a null context if anything ever reaches this directly. */
    if (!this.ok || !this.ctx) return;
    const a=this.ctx, t=a.currentTime;
    const out=a.createGain(); out.gain.value=0; out.connect(this.master);
    const live=[];
    /* up over about four seconds, so the bed is already there when the title is */
    out.gain.setTargetAtTime(0.85, t, 1.6);

    const n=a.createBufferSource(); n.buffer=this.noise; n.loop=true;
    const bp=a.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=420; bp.Q.value=0.7;
    const ng=a.createGain(); ng.gain.value=0.055;
    const lfo=a.createOscillator(); lfo.frequency.value=0.035;
    const lfoG=a.createGain(); lfoG.gain.value=170;
    lfo.connect(lfoG); lfoG.connect(bp.frequency);
    n.connect(bp); bp.connect(ng); ng.connect(out);
    n.start(t); lfo.start(t); live.push(n, lfo);

    const pad=a.createGain(); pad.gain.value=0.5;
    const lp=a.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=300; lp.Q.value=3;
    pad.connect(lp); lp.connect(out);
    const plfo=a.createOscillator(); plfo.frequency.value=0.021;
    const plfoG=a.createGain(); plfoG.gain.value=150;
    plfo.connect(plfoG); plfoG.connect(lp.frequency);
    plfo.start(t); live.push(plfo);
    for (const f of [55, 55.35, 82.4]){
      const o=a.createOscillator(); o.type='sawtooth'; o.frequency.value=f;
      const g=a.createGain(); g.gain.value=0.10;
      o.connect(g); g.connect(pad); o.start(t); live.push(o);
    }

    this.amb={ out, live };
    this._ambNext = t + 2;
    this._ambTimer = setInterval(()=>this._ambTick(), 120);
  },
  _ambTick(){
    if (!this.amb || !this.ok || !this.ctx) return;
    const now=this.ctx.currentTime;
    while (this._ambNext < now + 1.2){
      this._ambNote(this._ambNext);
      /* The gap runs from the NOTE, not from the tick. The tick fires up to a
         second and a bit before the note is due, so measuring from it shaves
         that lookahead off every single interval — which turned a 7-14 second
         spacing into a 6-13 second one without anything looking wrong. Advance
         from the note, and re-sync only if the tab was suspended long enough
         for the schedule to fall behind the wall clock. */
      this._ambNext += 7 + Math.random()*7;
      if (this._ambNext < now + 2) this._ambNext = now + 7 + Math.random()*7;
    }
  },
  _ambNote(t){
    if (!this.amb || !this.ok || !this.ctx) return;
    const a=this.ctx;
    const SCALE=[0,3,5,7,10,12,15];            // A minor pentatonic, plus the octave
    const deg=SCALE[(Math.random()*SCALE.length)|0];
    const oct=Math.random()<0.35 ? -12 : 0;   // now and then, the note below
    const f=110 * Math.pow(2, deg/12) * Math.pow(2, oct/12);
    const o=a.createOscillator(); o.type='triangle'; o.frequency.value=f;
    const lp=a.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=850;
    const g=a.createGain(); g.gain.value=0.0001;
    o.connect(lp); lp.connect(g); g.connect(this.amb.out);
    const dur=6 + Math.random()*4;
    g.gain.exponentialRampToValueAtTime(0.075, t+2.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    o.start(t); o.stop(t+dur+0.2);
  },
  _ambStop(){
    if (!this.amb) return;
    const t=this.ctx ? this.ctx.currentTime : 0;
    /* out over about a second and THEN stop the sources — not disconnected, not
       cut to zero, because a hard stop on a pad is an audible click and these
       nodes are cheaper than the click. */
    this.amb.out.gain.cancelScheduledValues(t);
    this.amb.out.gain.setTargetAtTime(0, t, 0.35);
    for (const n of this.amb.live){ try { n.stop(t+2.5); } catch(e){} }
    clearInterval(this._ambTimer);
    this._ambTimer=null; this._ambNext=0; this.amb=null;
  }
};

/* ============================================================
   TEXTURE PATTERNS — carpet speckle + wallpaper
   ============================================================ */
function hash2(x,y){ let h = x*374761393 + y*668265263; h = (h ^ (h>>13))*1274126177; return ((h ^ (h>>16))>>>0)/4294967296; }

let carpetPat, wallPat, ceilPat, scanPat;
/* The grain, pre-composited to the size of the viewport. The live loop tiled a
   160x160 tile ~40 times a frame at a random offset; this is one drawImage of
   the same noise at the same opacity, rebuilt only when the canvas changes
   size (resize, DPR change) rather than every frame. */
let grainFull;

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
const PAL = {
  bright:  '#e4e6a8',   // (228,230,168)
  pale:    '#e1e2bb',   // (225,226,187)
  mid:     '#d6dea7',   // (214,222,167)
  carpet:  '#c3cb6e',   // (195,203,110)
  wallTop: '#c6c58b',   // (198,197,139)
};

function buildPatterns(){
  // --- carpet: 64x64 speckled, seamless-ish ---
  let c = document.createElement('canvas'); c.width=c.height=64;
  let g = c.getContext('2d');
  g.fillStyle=PAL.carpet; g.fillRect(0,0,64,64);
  for(let i=0;i<2600;i++){
    const x=Math.random()*64, y=Math.random()*64;
    const v = Math.random();
    g.fillStyle = v<0.4 ? 'rgba(150,156,74,0.30)' : 'rgba(228,230,168,0.28)';
    g.fillRect(x,y,1.6,1.6);
  }
  for(let i=0;i<260;i++){           // faint tile seams
    g.fillStyle='rgba(150,156,74,0.14)';
    g.fillRect(Math.random()*64|0, Math.random()*64|0, 2,2);
  }
  carpetPat = ctx.createPattern(c,'repeat');

  // --- wallpaper on wall faces: vertical dotted motif ---
  c = document.createElement('canvas'); c.width=32; c.height=48;
  g = c.getContext('2d');
  const grd = g.createLinearGradient(0,0,0,48);
  grd.addColorStop(0,PAL.bright); grd.addColorStop(0.55,PAL.pale); grd.addColorStop(1,PAL.mid);
  g.fillStyle=grd; g.fillRect(0,0,32,48);
  g.fillStyle='rgba(195,203,110,0.55)';
  for(let y=6;y<48;y+=11) for(let x=(y/11|0)%2?4:12;x<32;x+=8) g.fillRect(x,y,2,2);
  g.fillStyle='rgba(228,230,168,0.16)'; g.fillRect(0,0,32,3);
  wallPat = ctx.createPattern(c,'repeat');

  // --- wall top (seen from directly above) ---
  c = document.createElement('canvas'); c.width=c.height=24;
  g = c.getContext('2d');
  g.fillStyle=PAL.wallTop; g.fillRect(0,0,24,24);
  for(let i=0;i<520;i++){
    g.fillStyle = Math.random()<0.5?'rgba(163,163,112,0.30)':'rgba(214,222,167,0.16)';
    g.fillRect(Math.random()*24, Math.random()*24, 2,2);
  }
  ceilPat = ctx.createPattern(c,'repeat');

  // --- VHS scanlines ---
  c = document.createElement('canvas'); c.width=1; c.height=4;
  g = c.getContext('2d');
  g.fillStyle='rgba(0,0,0,0)'; g.fillRect(0,0,1,4);
  g.fillStyle='rgba(0,0,0,0.28)'; g.fillRect(0,3,1,1);
  scanPat = ctx.createPattern(c,'repeat');
}

/* The viewport-sized grain. Same noise, same opacity — drawn once per frame as
   one image instead of ~40 tiled copies. Rebuilt when the canvas size changes
   (resize() calls it, and the renderer rebuilds lazily on the first frame
   after boot, which runs before the first resize event). */
function buildGrainFull(){
  grainFull = document.createElement('canvas');
  grainFull.width = cvs.width; grainFull.height = cvs.height;
  const g = grainFull.getContext('2d');
  const im = g.createImageData(cvs.width, cvs.height);
  for(let i=0;i<im.data.length;i+=4){
    const v = 118 + (Math.random()*74|0);
    im.data[i]=im.data[i+1]=im.data[i+2]=v; im.data[i+3]=255;
  }
  g.putImageData(im,0,0);
}

/* ---- full-screen overlays, baked once instead of evaluated per pixel ----
   The vignette and the awareness wash are both radial gradients covering the
   whole canvas, and both were rebuilt and re-filled EVERY frame. A gradient
   fill is evaluated per pixel; an image blit is not, and these two change only
   when the canvas does. Measured on the reference machine at 1038x1025, a
   full-screen gradient costs roughly twice a full-screen drawImage, and it was
   being paid sixty times a second for a picture that never moved.

   Neither is a new effect: the ramps are the same stops at the same radii. The
   danger wash additionally drops its per-frame `0.62*seen` alpha into
   globalAlpha, which is exactly what a gradient stop multiplied by a constant
   was doing, only without the arithmetic. */
let vigCv = null, dangerCv = null;

/* The vignette is canvas-sized: it is a fixed proportion of the frame. */
function buildVignette(){
  if (!cvs.width || !cvs.height) return;
  vigCv = document.createElement('canvas');
  vigCv.width = cvs.width; vigCv.height = cvs.height;
  const g = vigCv.getContext('2d');
  const vg = g.createRadialGradient(cvs.width/2, cvs.height/2, cvs.height*0.34,
                                    cvs.width/2, cvs.height/2, cvs.height*1.05);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.34)');
  g.fillStyle = vg; g.fillRect(0,0,cvs.width,cvs.height);
}

/* The awareness wash is HALF resolution. It is a smooth ramp with no edge in it
   anywhere near a pixel — the outer stop is 78% of the way out and everything
   inside that is a gradient anyway — so it is upscaled with smoothing into
   something no eye can separate from the full-res version. */
function buildDangerWash(){
  if (!cvs.width || !cvs.height) return;
  const w = Math.max(1, cvs.width>>1), h = Math.max(1, cvs.height>>1);
  dangerCv = document.createElement('canvas');
  dangerCv.width = w; dangerCv.height = h;
  const g = dangerCv.getContext('2d');
  const vg = g.createRadialGradient(w/2, h/2, h*0.18, w/2, h/2, h*0.78);
  vg.addColorStop(0, 'rgba(216,80,60,0)');
  vg.addColorStop(1, 'rgba(150,26,16,0.62)');
  g.fillStyle = vg; g.fillRect(0,0,w,h);
}

/* ---- the fixture glow sprite ----
   Every lit fixture filled a rect of side 2*r*TILE under 'lighter' from a
   gradient built on the spot — and r runs to 19 tiles, so that rect is bigger
   than the screen. One of those measured 9.5ms. A textured quad of the same
   size measured 1.4ms, and the sprite is built once at boot.

   The three stops are the fluorescents' own colours at the alphas the old
   gradient used, baked at full strength; the per-frame strength now rides in
   globalAlpha, which is what a gradient stop multiplied by `a` was doing. */
let glowSprite = null;
function buildGlowSprite(){
  const S = 128;
  glowSprite = document.createElement('canvas');
  glowSprite.width = S; glowSprite.height = S;
  const g = glowSprite.getContext('2d');
  const gr = g.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  gr.addColorStop(0,   'rgba(228,230,168,1)');
  gr.addColorStop(0.5, 'rgba(225,226,187,0.4)');
  gr.addColorStop(1,   'rgba(198,197,139,0)');
  g.fillStyle = gr; g.fillRect(0,0,S,S);
}

/* ============================================================
   MAZE — BSP room segmentation. "randomly segmented empty rooms"
   ============================================================ */
function genMaze(rng){
  const grid = new Uint8Array(MAP_W*MAP_H);       // 0 everywhere = solid
  const rooms = [];
  const doors = [];
  const idx = (x,y)=> y*MAP_W + x;

  const leaves = [];
  /* Subdivision is driven by SIZE, not by a depth counter. A fixed depth ran
     out of budget while cells were still ~18 tiles across, so every floor
     kept at least one room big enough to read as an empty field.
     MAXROOM is a real ceiling: the cut is clamped so a child is never wider
     than its parent, and splitting is refused only once the cell is too
     narrow to divide without producing a closet. Always cut the longer axis
     so children converge on the ceiling instead of drifting past it. */
  const MAXROOM = 12, MINCUT = 6;
  (function split(x,y,w,h,depth){
    const tooNarrow = (w < MINCUT*2 && h < MINCUT*2);
    if (depth <= 0 || tooNarrow){
      leaves.push({x,y,w,h,id:leaves.length});
      return;
    }
    if (w >= h){
      if (w < MINCUT*2){ leaves.push({x,y,w,h,id:leaves.length}); return; }
      if (w <= MAXROOM && h <= MAXROOM){ leaves.push({x,y,w,h,id:leaves.length}); return; }
      let cut = Math.round(w*(0.75 + rng()*0.5)/2);
      cut = Math.max(MINCUT, Math.min(w-MINCUT, cut));
      split(x,      y, cut, h, depth-1);
      split(x+cut, y, w-cut, h, depth-1);
      // vertical partition at column x+cut: a gate straddles COLUMNS at a row
      const gateRow = () => y + 1 + Math.floor(rng()*Math.max(1,h-2));
      doors.push({axis:'x', cut:x+cut, along:gateRow(), width:2});
      if (rng() < 0.45) doors.push({axis:'x', cut:x+cut, along:gateRow(), width:2});
    } else {
      if (h < MINCUT*2){ leaves.push({x,y,w,h,id:leaves.length}); return; }
      if (w <= MAXROOM && h <= MAXROOM){ leaves.push({x,y,w,h,id:leaves.length}); return; }
      let cut = Math.round(h*(0.75 + rng()*0.5)/2);
      cut = Math.max(MINCUT, Math.min(h-MINCUT, cut));
      split(x, y,      w, cut, depth-1);
      split(x, y+cut, w, h-cut, depth-1);
      // horizontal partition at row y+cut: a gate straddles ROWS at a column
      const gateCol = () => x + 1 + Math.floor(rng()*Math.max(1,w-2));
      doors.push({axis:'y', cut:y+cut, along:gateCol(), width:2});
      if (rng() < 0.45) doors.push({axis:'y', cut:y+cut, along:gateCol(), width:2});
    }
  })(1,1,MAP_W-2,MAP_H-2,12);

  /* Carve each leaf as a room, inset unevenly so the partitions read as
     temporary site walls rather than a regular grid. Insets are capped: with
     smaller cells an uncapped inset of 3+3 could produce a room wider than
     its cell, which spilled into the partition band and welded two
     neighbouring rooms into one big open space. */
  const MINROOM = 6;
  const inset = span => 1 + Math.floor(rng()*Math.min(2, Math.max(1, Math.floor((span-MINROOM)/2))));
  for (const L of leaves){
    const ix1 = inset(L.w), ix2 = inset(L.w);
    const iy1 = inset(L.h), iy2 = inset(L.h);
    const rx = L.x+ix1, ry = L.y+iy1;
    const rw = Math.max(MINROOM, L.w-ix1-ix2);
    const rh = Math.max(MINROOM, L.h-iy1-iy2);
    for (let y=ry; y<ry+rh; y++)
      for (let x=rx; x<rx+rw; x++) grid[idx(x,y)] = FLOOR;
    L.rx=rx; L.ry=ry; L.rw=rw; L.rh=rh;
    rooms.push(L);
  }

  /* Punch doorways through the partition bands.
     The band between two rooms is up to 6 tiles thick, so a 2-tile
     punch would dead-end inside the wall. Instead, tunnel along the
     door column in both directions until we actually break into a
     room floor on each side. */
  for (const d of doors){
    for (let k=0; k<d.width; k++){
      const a = d.along + k;
      if (d.axis === 'x'){
        // vertical partition: tunnel sideways through it, gate spans 2 rows
        for (let x=d.cut-1, g=0; g<14; x--, g++){
          if (x<1) break;
          grid[idx(x,a)] = FLOOR;
          if (grid[idx(x-1,a)]===FLOOR) break;
        }
        for (let x=d.cut, g=0; g<14; x++, g++){
          if (x>=MAP_W-2) break;
          grid[idx(x,a)] = FLOOR;
          if (grid[idx(x+1,a)]===FLOOR) break;
        }
      } else {
        // horizontal partition: tunnel vertically, gate spans 2 columns
        for (let y=d.cut-1, g=0; g<14; y--, g++){
          if (y<1) break;
          grid[idx(a,y)] = FLOOR;
          if (grid[idx(a,y-1)]===FLOOR) break;
        }
        for (let y=d.cut, g=0; g<14; y++, g++){
          if (y>=MAP_H-2) break;
          grid[idx(a,y)] = FLOOR;
          if (grid[idx(a,y+1)]===FLOOR) break;
        }
      }
    }
  }

  /* Extra partitions inside the larger rooms. The BSP alone still leaves
     some cells big enough to read as an empty field. These stubs add wall
     area and create alcoves WITHOUT dividing a room in two — a full split
     can strand one half, which the connectivity repair would then tunnel
     back through a visible hole in the partition. */
  for (const L of rooms){
    if (L.rw < 6 && L.rh < 6) continue;
    const cym = L.ry + L.rh/2;
    const cxm = L.rx + L.rw/2;
    const stubs = 1 + (rng() < 0.65 ? 1 : 0) + (rng() < 0.3 ? 1 : 0);
    for (let n=0; n<stubs; n++){
      if (L.rw >= L.rh){
        const sx = L.rx + 1 + Math.floor(rng()*Math.max(1, L.rw-2));
        const len = 2 + Math.floor(rng()*Math.max(1, L.rh-3));
        const y0 = rng() < 0.5 ? L.ry : L.ry + L.rh - len;
        const th2 = 1 + (rng() < 0.45 ? 1 : 0);
        for (let y=y0; y<y0+len; y++){
          if (y<L.ry || y>=L.ry+L.rh) continue;
          if (Math.abs((y+0.5)-cym) < 1.6) continue;   // leave the spawn clear
          for (let k=0;k<th2;k++){
            if (sx+k < L.rx+L.rw) grid[idx(sx+k,y)] = WALL;
          }
        }
      } else {
        const sy = L.ry + 1 + Math.floor(rng()*Math.max(1, L.rh-2));
        const len = 2 + Math.floor(rng()*Math.max(1, L.rw-3));
        const x0 = rng() < 0.5 ? L.rx : L.rx + L.rw - len;
        const th3 = 1 + (rng() < 0.45 ? 1 : 0);
        for (let x=x0; x<x0+len; x++){
          if (x<L.rx || x>=L.rx+L.rw) continue;
          if (Math.abs((x+0.5)-cxm) < 1.6) continue;
          for (let k=0;k<th3;k++){
            if (sy+k < L.ry+L.rh) grid[idx(x,sy+k)] = WALL;
          }
        }
      }
    }
  }

  /* --- guarantee a single connected region ---
     Belt and braces: flood fill from the biggest room, then tunnel
     from any orphaned region straight into the main one until the
     whole floor is one component. */
  const label = new Int32Array(MAP_W*MAP_H).fill(-1);
  const comps = [];
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    const i0 = idx(x,y);
    if (grid[i0]!==FLOOR || label[i0]>=0) continue;
    const cid = comps.length, stack=[i0], cells=[];
    label[i0]=cid;
    while(stack.length){
      const c = stack.pop(); cells.push(c);
      const cx=c%MAP_W, cy=(c/MAP_W)|0;
      const nb=[c+1,c-1,c+MAP_W,c-MAP_W];
      const ok=[cx<MAP_W-1, cx>0, cy<MAP_H-1, cy>0];
      for(let k=0;k<4;k++){
        if(!ok[k]) continue;
        const ni=nb[k];
        if(grid[ni]===FLOOR && label[ni]<0){ label[ni]=cid; stack.push(ni); }
      }
    }
    comps.push(cells);
  }
  if (comps.length > 1){
    let main=0;
    for (let c=1;c<comps.length;c++) if (comps[c].length>comps[main].length) main=c;
    const inMain = new Uint8Array(MAP_W*MAP_H);
    for (const c of comps[main]) inMain[c]=1;
    for (let cid=0; cid<comps.length; cid++){
      if (cid===main) continue;
      for (const c of comps[cid]){
        if (inMain[c]) continue;
        const cx=c%MAP_W, cy=(c/MAP_W)|0;
        // find the closest already-connected tile
        let best=null, bd=1e9;
        for (const m of comps[main]){
          const mx=m%MAP_W, my=(m/MAP_W)|0;
          const d=(mx-cx)**2+(my-cy)**2;
          if (d<bd){ bd=d; best=[mx,my]; }
          if (bd<=4) break;
        }
        if (!best) continue;
        // L-shaped tunnel from (cx,cy) to best
        let x=cx, y=cy;
        while (x!==best[0]){ grid[idx(x,y)]=FLOOR; inMain[idx(x,y)]=1; x+=Math.sign(best[0]-x); }
        while (y!==best[1]){ grid[idx(x,y)]=FLOOR; inMain[idx(x,y)]=1; y+=Math.sign(best[1]-y); }
        grid[idx(x,y)]=FLOOR; inMain[idx(x,y)]=1;
      }
      // refresh main membership with everything we just joined
      for (const c of comps[cid]) if (inMain[c]) comps[main].push(c);
    }
  }

  return { grid, rooms, leaves };
}

/* ============================================================
   FLOOR STATE
   ============================================================ */
let G = null;                // the whole floor lives on G — null until the first buildFloor

/* ---- HEADLESS SWITCHES ------------------------------------------------
   Two subsystems exist only to feed pixels to a canvas: packing the mask
   and the flood into images, and retracing the view cone frame by frame.
   Together they were 48% of this suite's CPU, because the headless
   harness drives update() as fast as it can and the tests that never
   look at a picture were paying full price for every frame.

   Both default ON. The game never turns them off; only the test harness
   does, and only for the stretches that assert on neither. A test that
   reads G.maskArr or G.wetCv pixels re-enables them, which is why the flags
   are settable at runtime rather than baked in at load. */
let wantPixels = true;      // packMask / packWet write an image nobody will read
let wantVision = true;      // traceViewCone + smoothMask retrace per frame
function setHeadless(px, vis){ wantPixels = !!px; wantVision = !!vis; }

/* ---------- THE FLOOD ----------
   G.wetArr is per TILE, 0..1, exactly like G.maskArr: it is state the simulation
   reads and the renderer reads, so there is one number and the wet patch you
   can see is the wet patch that slows your footsteps.

   G.waterDist is a BFS from the leak over walkable floor, recomputed when the
   leak is sealed, and it is the ONLY thing that decides how fast water spreads.
   Derived once per state change rather than simulated per tile per frame:
   water runs downhill, it does not meander, so distance-from-source is exactly
   the physics and a diffusion model would only add a parameter to get wrong. */
/* G.wetByDist is every reachable tile ORDERED BY DISTANCE FROM THE LEAK, and
   G.wetFront is how many of them are currently under water.

   This exists for a measured reason. The first version scanned all 5776 tiles
   every frame, which is correct and cheap-looking and made the headless suite
   take well over twenty minutes instead of seventy seconds — the end-to-end
   bot alone simulates hundreds of thousands of frames.

   But the shape of the problem does not need a scan at all. A tile's target
   wetness is exactly `dist <= front`, so the ONLY tiles whose target differs
   from last frame are the ones in the band the front just moved through. Those
   are contiguous in this ordering, which turns an O(map) pass into an
   O(perimeter of the waterline) pass — a handful of tiles a frame instead of
   six thousand. The ordering is stable because the leak does not move. */

/* G.wetEdgeD is the furthest distance from the nearest pipe at which ANY tile is
   still visibly wet — and it is the bound the per-frame pass actually uses.

   It is not `G.wetFront`, and the difference is the whole recession. `G.wetFront` is
   where the waterline is; the moment the line starts coming back in, every ring
   it has already vacated is still soaking and drying, and those rings are OUTSIDE
   the front. Iterating to the front leaves them stranded at full wetness —
   permanently, because the bound only ever shrinks from there, so a tile dropped
   once is never revisited. The front would walk back to zero on schedule and the
   carpet would not change by a pixel.

   It is also what keeps the pass cheap. A tile at or inside the front is wet, so
   the front is a lower bound on this, and the extra distance it covers is exactly
   the still-drying band — a handful of rings. An unflooded level costs one
   iteration.

   WET_EDGE has to sit BELOW the cut at which a tile stops being drawn (WET_DRAW
   in packWet), or the last few percent of wetness is left on the carpet
   forever: the tile falls out of the pass, stops integrating, and freezes just
   above the threshold where it is still a visible damp patch. It cannot be zero
   either — a tile approaching zero asymptotically would hold the bound open for
   ever — so it is the draw cut times a margin, and the two are written together
   so they cannot drift apart. */
const WET_DRAW = 0.015;          // packWet: below this a tile is fully transparent
const WET_EDGE = WET_DRAW*0.8;    // ...so below THIS the simulation may stop caring
/* waterDirty means "the packed water image may not match G.wetArr any more". The
   image used to be repacked on EVERY draw, which is a 5776-tile write plus a
   putImageData per frame whether or not the water had moved — the single most
   expensive thing in the renderer. Now only the three places that can change
   G.wetArr (initFlood, seedSplash, tickFlood) and the one setting that changes
   what a tile packs to (the tint) raise it, and the update loop packs once and
   clears it. Rendering still reads G.wetArr directly for the sheen, so a frame
   with no repack is still a frame that draws the water correctly. */
let waterDirty = false;

/* ============================================================
   LEVEL STAGES
   Four pure stages. Each takes the level (or just an rng) and
   either returns data or fills the G fields documented on it.
   None of them reads or writes module-level mutable state, so a
   level can be generated, lit, labelled and cast without a floor
   existing yet — buildFloor is now only the assembly.
   ============================================================ */
function genLevel(rng, floorNum=0){
  const maze = genMaze(rng);
  const grid = maze.grid;
  const at = (x,y)=> grid[y*MAP_W+x];
  const inB = (x,y)=> x>=0 && y>=0 && x<MAP_W && y<MAP_H;

  const INTERIOR = (x,y)=> x>0 && y>0 && x<MAP_W-1 && y<MAP_H-1;
  const touchesFloor = (tx,ty)=>
    (inB(tx+1,ty)&&at(tx+1,ty)===FLOOR)||(inB(tx-1,ty)&&at(tx-1,ty)===FLOOR)||
    (inB(tx,ty+1)&&at(tx,ty+1)===FLOOR)||(inB(tx,ty-1)&&at(tx,ty-1)===FLOOR);

  /* Which way the door opens. */
  const FACINGS = [['S',0,1],['N',0,-1],['E',1,0],['W',-1,0]];
  function wallFacing(tx, ty, r){
    const open = [];
    for (const [dir,dx,dy] of FACINGS)
      if (inB(tx+dx,ty+dy) && at(tx+dx,ty+dy)===FLOOR) open.push({dir,dx,dy});
    if (!open.length) return 'S';            // unreachable: the slot touches floor
    /* South is not merely a tie-break winner, it is the answer whenever south is
       on the list. A wall with floor both south and east of it is a pillar
       corner that satisfies the slot rule, and the door art has to agree with
       the wall the renderer painted — which is always the south face. Reading
       the corner as an east-facing door put the leaf ninety degrees out of step
       with the lit band behind it. The room-centre sort stays for the case the
       slot rule cannot reach. */
    if (open.some(o=>o.dir==='S')) return 'S';
    if (open.length>1 && r){
      const cx=r.rx+r.rw/2, cy=r.ry+r.rh/2;
      open.sort((a,b)=>Math.hypot(tx+a.dx-cx, ty+a.dy-cy)-Math.hypot(tx+b.dx-cx, ty+b.dy-cy));
    }
    return open[0].dir;
  }

  /* A slot is only usable if it is a wall with floor DIRECTLY SOUTH of it.
     That is not an aesthetic preference with a geometry excuse attached: it is
     the one orientation the building actually lights. bakeTiles paints a single
     face per wall tile — the south one, sitting in the carpet tile below it
     (game.js:1674) — so a door anywhere else is a door standing on a dark
     ceiling top with no lit wall behind it, which reads as a frame painted on
     the floor rather than as a door in a wall. Restricting the slot keeps every
     door in the one place the renderer already knows how to light.

     touchesFloor alone is not enough. A ring tile on the east side of a room
     touches floor to its west, satisfies it, and has no face at all. */
  const southFacing = (tx,ty)=> INTERIOR(tx,ty) && at(tx,ty)===WALL
                                     && INTERIOR(tx,ty+1) && at(tx,ty+1)===FLOOR;

  /* With a dense BSP the ring just outside a room is often another room's floor
     rather than wall, so the ring alone is not enough — hence three escalating
     fallbacks before we give up on a slot. */
  function wallSlotFor(r){
    // 1. the ring immediately around the room
    const ring = [];
    for (let x=r.rx; x<r.rx+r.rw; x++){ ring.push([x,r.ry-1]); ring.push([x,r.ry+r.rh]); }
    for (let y=r.ry; y<r.ry+r.rh; y++){ ring.push([r.rx-1,y]); ring.push([r.rx+r.rw,y]); }
    let cand = ring.filter(([tx,ty]) => southFacing(tx,ty));

    // 2. any interior wall tile with floor south of it, near THIS room
    if (!cand.length){
      const near = [];
      for (let y=r.ry-1; y<=r.ry+r.rh; y++) for (let x=r.rx-1; x<=r.rx+r.rw; x++){
        if (southFacing(x,y)) near.push([x,y]);
      }
      cand = near;
    }
    // 3. any such wall tile anywhere — keeps the level winnable even if the room
    //    is fully walled in by other rooms. Sorted before the slice, so the cap
    //    keeps the nearest USABLE tiles rather than the nearest wall tiles, which
    //    under this rule are not interchangeable.
    if (!cand.length){
      const any = [];
      for (let y=1;y<MAP_H-1 && any.length<4000;y++) for (let x=1;x<MAP_W-1;x++){
        if (southFacing(x,y)) any.push([x,y]);
      }
      // prefer one reasonably near the room it belongs to
      const cx=r.rx+r.rw/2, cy=r.ry+r.rh/2;
      any.sort((a,b)=>Math.hypot(a[0]-cx,a[1]-cy)-Math.hypot(b[0]-cx,b[1]-cy));
      cand = any.slice(0,60);
    }
    return cand;
  }

  /* THE DOOR. One tile, found from the spawn room, and KNOWN from the first
     frame — there is no hunt for it, because you walked through it. The old
     three-exit economy was a search, and a search cannot survive being given
     a deadline: what this rule replaces is a hunt you spend battery on, and what
     it puts in its place is a journey you spend CLOCK on. You know exactly
     where the door is and the whole question is whether you can get back to it
     in time, which is a question about the floor and not about your radar. */
  const candidates = maze.rooms.filter(r=>r.rw>=6 && r.rh>=6);
  const pool = candidates.length>=6 ? candidates : maze.rooms;
  const entryRoom = pool[0];
  /* The spawn, needed before anything that is placed relative to it — the pipes
     go as far from here as the geometry allows. */
  const spawn = { x: entryRoom.rx + entryRoom.rw/2, y: entryRoom.ry + entryRoom.rh/2 };

  const exitTiles = [];
  {
    let cand = wallSlotFor(entryRoom);
    if (!cand.length) cand = wallSlotFor(maze.rooms[(rng()*maze.rooms.length)|0] || entryRoom);
    if (cand.length){
      const [bx,by] = cand[(rng()*cand.length)|0];
      exitTiles.push({x:bx, y:by, open:0, facing:wallFacing(bx,by,entryRoom)});
    }
  }
  /* Unreachable in practice on a 76x76 BSP: every room has interior wall around
     it. It is here because the alternative is a crash on the level the player
     cannot finish, and there is a clock on that now.

     The old version was a hardcoded (1,1). Under the south-facing rule that tile
     is not guaranteed to be a wall any more — and a door on carpet is worse than
     no door, because everything downstream (the descent, the prompt, the leaf)
     would then be operating on a tile that is not a doorway. So the last resort
     is a whole-map scan for a tile that satisfies the same rule the slot does,
     and only if that comes back empty — which on a map this size cannot happen —
     does the hardcoded tile stand in. */
  if (!exitTiles.length){
    let fb = null;
    outer: for (let y=1; y<MAP_H-1 && !fb; y++)
      for (let x=1; x<MAP_W-1; x++)
        if (southFacing(x,y)){ fb = [x,y]; break outer; }
    if (!fb) fb = [1,1];
    exitTiles.push({x:fb[0], y:fb[1], open:0, facing:'S'});
  }

  /* --- the pipes ------------------------------------------------------
     Each is a single wall tile, as far from the spawn as the floor allows. It
     has to be a WALL and it has to touch walkable floor — you cannot wrench a
     pipe that opens onto solid rock, and you cannot walk to one that opens onto
     nowhere. If the extreme corner turns out to be unusable the search walks
     back toward the spawn rather than failing, because a level with an
     unreachable pipe is unwinnable and every repair is mandatory.

     Preferring the FARTHEST tile and only then falling back means the common
     case is a genuine trek and the rare case is merely a shorter one. With more
     than one pipe the farthest-first rule is applied with PIPE_GAP between
     picks, and the tie broken by the seeded RNG, so four pipes are four corners
     of the building rather than four faces of the same wall. */
  const faceTiles = [];
  for (let y=1;y<MAP_H-1;y++) for (let x=1;x<MAP_W-1;x++){
    if (at(x,y)!==WALL) continue;
    if (!touchesFloor(x,y)) continue;
    faceTiles.push({x, y, d: Math.hypot(x+0.5-spawn.x, y+0.5-spawn.y)});
  }
  faceTiles.sort((a,b)=> b.d - a.d);

  const standSpot = (c) => {
    /* the repair spot: floor the player can actually stand on, flush against
       the pipe. Reachable AND not inside geometry, so the five seconds of the
       repair are physically possible rather than merely intended. */
    for (const [nx,ny] of [[c.x+1,c.y],[c.x-1,c.y],[c.x,c.y+1],[c.x,c.y-1]]){
      if (!inB(nx,ny) || at(nx,ny)!==FLOOR) continue;
      /* The standing spot is the CENTRE of the floor tile beside the pipe.
         The first version of this nudged the position flush against the wall
         face — which is precisely where the player's collision disc already
         puts them, so every candidate was inside its own radius and every
         level fell through to the hardcoded fallback. Standing ON the tile is
         the only legal place to be; how close that counts as "at the pipe" is
         REACH's job, not this function's.

         Checked against the LOCAL grid, not blocked(), because G does not exist
         yet at this point in the level build and blocked() reads G.grid. */
      const px = nx + 0.5, py = ny + 0.5;
      let inside = false;
      for (let ty=Math.floor(py-R); ty<=Math.floor(py+R) && !inside; ty++)
        for (let tx=Math.floor(px-R); tx<=Math.floor(px+R); tx++){
          if (!inB(tx,ty) || at(tx,ty)!==WALL) continue;
          const cx = px<tx?tx:(px>tx+1?tx+1:px);
          const cy = py<ty?ty:(py>ty+1?ty+1:py);
          if ((px-cx)**2 + (py-cy)**2 < R*R){ inside=true; break; }
        }
      if (inside) continue;
      return {x:nx, y:ny};
    }
    return null;
  };
  /* The room a standing spot sits in, for the pickup guarantee below. A pipe is
     a wall tile and belongs to no rect; the floor you stand on to reach it does,
     and that is the cell you want beside it. */
  const roomAt = (tx,ty) =>
    maze.rooms.find(r=>tx>=r.rx&&tx<r.rx+r.rw&&ty>=r.ry&&ty<r.ry+r.rh) || null;

  /* The pipes for THIS level. How many is a fixed property of the level, not a
     tuning knob — see LEVELS. */
  const spec = LEVELS[Math.min(floorNum, LEVELS_N-1)];
  const want = spec.leaks;
  const leaks = [];
  const reach = PIPE_FAR[Math.min(want, PIPE_FAR.length)-1];
  const capped = faceTiles.filter(c=>c.d <= reach);
  const shortlist = (capped.length ? capped : faceTiles);
  /* Shallow-to-deep scan of the far half of the level: the first PIPE_GAP-
     separated pick wins, so the pipes come out spread across the building
     while each is still comfortably out of sight of the door.

     The gap is measured between the two STANDING SPOTS, not between the two
     wall tiles. They are not the same question: the wall tile decides where
     the pipe is, and the standing spot is where the player's collision disc
     has to be for the repair to fire at all. Two pipes three wall tiles apart
     can have standing spots 1.0 tile apart, which is inside REPAIR_REACH — and
     then a single five-second hold seals both of them, which is the one thing
     four separate repairs must never be. */
  for (let gap of [PIPE_GAP, Math.max(4, PIPE_GAP>>1), 0]){
    for (const c of shortlist){
      if (leaks.length >= want) break;
      const spot = standSpot(c);
      if (!spot) continue;
      if (leaks.some(L=>Math.hypot(L.sx-spot.x, L.sy-spot.y) < gap+REPAIR_REACH)) continue;
      const L = { x:c.x, y:c.y, sx:spot.x, sy:spot.y,
                  fixed:false, repair:0, fixedAt:0 };
      L.room = roomAt(spot.x, spot.y);
      leaks.push(L);
    }
    if (leaks.length >= want) break;
  }
  /* A 76x76 BSP level always has interior walls, so this is unreachable in
     practice. It is here because the alternative is a crash on a level the
     player cannot finish, and a soft failure is not acceptable for a mandatory
     objective. */
  while (leaks.length < want){
    const L = { x:1, y:1, sx:1, sy:1, fixed:false, repair:0, fixedAt:0 };
    L.room = entryRoom;
    leaks.push(L);
  }

  /* Pick a floor tile inside a room. Rooms now contain partition stubs, so a
     plain random pick can land inside a wall. `away`/`minD` keep a pickup off
     the player's spawn: a cell sitting under the door you walk in through is
     free battery handed over for nothing, and it was handed over silently
     because nothing about "a battery was collected" looks wrong in isolation. */
  const floorTileIn = (r, pad=1, away=null, minD=0) => {
    const w = r.rw-2*pad, h = r.rh-2*pad;
    if (w > 0 && h > 0){
      for (let i=0;i<16;i++){
        const tx = r.rx+pad + Math.floor(rng()*w);
        const ty = r.ry+pad + Math.floor(rng()*h);
        if (maze.grid[ty*MAP_W+tx]!==FLOOR) continue;
        if (away && Math.hypot(tx+0.5-away.x, ty+0.5-away.y) < minD) continue;
        return {x:tx, y:ty};
      }
    }
    /* The fallback is the room's centre, which for the room the player spawns
       in is the spawn itself — so a pickup would land under their boots and be
       collected on frame one, with nothing in the log to say why. Better to
       place no cell than to place one on the player's head. */
    const fb = { x: r.rx + (r.rw>>1), y: r.ry + (r.rh>>1) };
    if (away && Math.hypot(fb.x+0.5-away.x, fb.y+0.5-away.y) < minD) return null;
    return fb;
  };

  /* --- fixtures: ~18% of rooms unlit, some with two panels --- */
  const fixtures = [];
  for (const r of maze.rooms){
    if (r.rw<4 || r.rh<4) continue;
    if (rng() < 0.18) continue;
    const n = (r.rw*r.rh > 260 && rng()<0.4) ? 2 : 1;
    for (let i=0;i<n;i++){
      // radius follows the room, so no room ends up a black hole
      const rad = Math.max(9, Math.min(19, Math.hypot(r.rw, r.rh)*0.62));
      const sp = floorTileIn(r);
      fixtures.push({
        x: sp.x + 0.5,
        y: sp.y + 0.5,
        r: rad * (0.85 + rng()*0.3),
        i: 0.85 + rng()*0.2,
        flicker: rng() < 0.16 ? (0.5 + Math.random()*2.4) : 0,
        phase: rng()*Math.PI*2
      });
    }
  }

  /* --- battery pickups ---
     One is GUARANTEED inside the room the door is in, and one inside the room
     each pipes stands in. The pipe is what the water leads you to, so the cell
     that powers the radar is standing next to the work — with four pipes and
     three minutes you will sweep more than once, and a budget that can run dry
     between the pipe and the pipe is a budget you cannot plan around. */
  const batteries = [];
  const litRooms = maze.rooms.filter(r=>fixtures.some(f=>f.x>=r.rx&&f.x<=r.rx+r.rw&&f.y>=r.ry&&f.y<=r.ry+r.rh));
  const battRooms = new Set();
  for (const b of [{room:entryRoom, away:spawn, d:3}, ...leaks.map(L=>({room:L.room, away:{x:L.sx+0.5,y:L.sy+0.5}, d:1.5}))]){
    const r = b.room;
    if (!r || r.rw<5 || r.rh<5) continue;
    /* Two pipes can share a room, and a stacked pair of cells reads as a bug
       rather than as generosity. One per room. */
    if (battRooms.has(r)) continue;
    battRooms.add(r);
    /* Never within reach of the spawn, and never sitting on the repair spot of
       the pipe this cell belongs to: both are battery you did not have to walk
       for, and the clock is the point of the level. */
    const sp = floorTileIn(r, 1, b.away, b.d);
    if (!sp) continue;
    batteries.push({ x: sp.x+0.5, y: sp.y+0.5, taken:false });
  }
  for (let i=0;i<6+floorNum*2;i++){
    const src = (rng()<0.6 && litRooms.length) ? litRooms : maze.rooms;
    const r = src[(rng()*src.length)|0];
    if (!r || r.rw<4||r.rh<4) continue;
    /* The scatter cells respect the spawn exclusion too. A random pick that
       lands on the player's feet is a pickup they were handed for walking
       through a door, which is worse than no cell at all. */
    const sp = floorTileIn(r, 1, spawn, 3);
    if (!sp) continue;
    batteries.push({ x: sp.x+0.5, y: sp.y+0.5, taken:false });
  }

  /* --- scrawled warnings on the carpet --- */
  const NOTES = [
    'it only hears you when you move',
    'the lights are always on. always on. always on.',
    'six hundred million square miles. i counted for a while.',
    'don\'t run. running is how it finds you.',
    'the radar shows you nothing about plumbing',
    'it was a pile of wire when i walked past it',
    'left foot. right foot. left foot. right fo',
    'you are not the first thing here to have come back for the door',
    'if you can hear it, it already knows where you are',
    'the hum is not coming from the ceiling',
    /* The rules of the shift, in the hands of people who did not get them
       either. They are placed like every other note — random rooms, revealed
       by the radar — so they are found rather than delivered. */
    'the wet floor runs downhill. it runs AWAY from the break.',
    'wrench takes five seconds. it is the loudest thing you will do here.',
    'don\'t stand still anywhere except the pipe',
    'seal every pipe. the door does not open for a wet floor.',
    'three minutes. then the water has the room you are standing in.',
    'the door is behind you. it will still be behind you.'
  ];
  const graffiti = [];
  for (let i=0;i<9+floorNum*2;i++){
    const r = maze.rooms[(rng()*maze.rooms.length)|0];
    if (!r || r.rw<5||r.rh<5) continue;
    const sp = floorTileIn(r);
    graffiti.push({ x: sp.x+0.5, y: sp.y+0.5,
                    text:NOTES[(rng()*NOTES.length)|0], seen:false });
  }

  return { grid, rooms: maze.rooms, leaves: maze.leaves, spawn, exit: exitTiles,
           leaks, fixtures, batteries, graffiti, spec, rng };
}

/* Fills G.lightArr and the packed G.lightCv/G.lightCtx/G.lightImg from the
   level's fixtures and grid. Pure apart from those G fields. */
function bakeLighting(level){
  const grid = level.grid;
  const at = (x,y)=> grid[y*MAP_W+x];
  const inB = (x,y)=> x>=0 && y>=0 && x<MAP_W && y<MAP_H;

  /* --- line of sight (Bresenham, walls block) --- */
  function los(x0,y0,x1,y1){
    x0=Math.floor(x0); y0=Math.floor(y0); x1=Math.floor(x1); y1=Math.floor(y1);
    let dx=Math.abs(x1-x0), dy=Math.abs(y1-y0);
    let sx=x0<x1?1:-1, sy=y0<y1?1:-1, err=dx-dy;
    let guard=0;
    while(guard++ < 400){
      if(x0===x1 && y0===y1) return true;
      const e2 = 2*err;
      if (e2 > -dy){ err -= dy; x0 += sx; }
      if (e2 <  dx){ err += dx; y0 += sy; }
      if (x0===x1 && y0===y1) return true;
      if (!inB(x0,y0) || at(x0,y0)===WALL) return false;
    }
    return false;
  }

  /* --- bake ambient light --- */
  G.lightArr = new Float32Array(MAP_W*MAP_H);
  for (const f of level.fixtures){
    const R2 = f.r*f.r;
    const x0=Math.max(0,Math.floor(f.x-f.r)), x1=Math.min(MAP_W-1,Math.ceil(f.x+f.r));
    const y0=Math.max(0,Math.floor(f.y-f.r)), y1=Math.min(MAP_H-1,Math.ceil(f.y+f.r));
    for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){
      const d2=(x+0.5-f.x)**2 + (y+0.5-f.y)**2;
      if (d2>R2) continue;
      if (at(x,y)===WALL) continue;
      if (!los(f.x,f.y,x+0.5,y+0.5)) continue;
      const fall = 1 - Math.sqrt(d2)/f.r;
      const v = Math.min(1, f.i * fall * fall * 1.95);
      const i0 = y*MAP_W+x;
      if (v > G.lightArr[i0]) G.lightArr[i0] = v;
    }
  }
  // 3x3 blur for soft falloff (a wider kernel dilutes single lit tiles
  // into nothing, which leaves the floor pitch black between fixtures)
  const tmp = new Float32Array(G.lightArr);
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    let s=0,n=0;
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){
      const nx=x+dx, ny=y+dy;
      if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) continue;
      s+=tmp[ny*MAP_W+nx]; n++;
    }
    G.lightArr[y*MAP_W+x] = s/n;
  }
  /* The ambient floor is high, and that is a change of what this number
     MEANS. It used to be 0.42 because the bake was the only thing deciding
     brightness, so a floor had to stop the darkest corner of a lit room
     collapsing into black. Darkness is now the MASK's job — a room you cannot
     see is multiplied by zero regardless of what its fluorescents are doing.
     So the bake only describes LIT SURFACES, and its floor is set high enough
     that a room you can see shows the palette essentially at full strength,
     with the fixtures as bright pools on top rather than as the only light. */
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    const i=y*MAP_W+x;
    if (at(x,y)===FLOOR && G.lightArr[i] < BAKE_FLOOR) G.lightArr[i] = BAKE_FLOOR;
  }
  // walls catch light from adjacent floor (their face is visible).
  // This MUST read the post-blur, post-floor values. It used to read `tmp`
  // (pre-blur and pre-ambient-floor), so a wall beside unlit floor got ~0
  // light, multiplied to near-black, and every partition read as a hole in
  // the ground rather than a wall.
  const wallSrc = new Float32Array(G.lightArr);
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    const i=y*MAP_W+x;
    if (at(x,y)!==WALL) continue;
    let m=0;
    if (inB(x+1,y)&&at(x+1,y)===FLOOR) m=Math.max(m,wallSrc[i+1]);
    if (inB(x-1,y)&&at(x-1,y)===FLOOR) m=Math.max(m,wallSrc[i-1]);
    if (inB(x,y+1)&&at(x,y+1)===FLOOR) m=Math.max(m,wallSrc[i+MAP_W]);
    if (inB(x,y-1)&&at(x,y-1)===FLOOR) m=Math.max(m,wallSrc[i-MAP_W]);
    // a wall deep inside a block still catches some bounce from its room
    G.lightArr[i] = Math.max(m*0.95, BAKE_FLOOR*0.80);
  }

  /* Pack the BAKE — pure, unchanged. Every viewer-side term (room scope, cone of
     vision, radar) is folded into a single mask on a separate canvas, so there
     is exactly one multiply and the mask can only ever remove light the bake
     put there. */
  G.lightCv = document.createElement('canvas');
  G.lightCv.width = MAP_W*LS; G.lightCv.height = MAP_H*LS;
  G.lightCtx = G.lightCv.getContext('2d');
  G.lightImg = G.lightCtx.createImageData(G.lightCv.width, G.lightCv.height);
  /* The canvas dimensions and the pixel buffer are DOM-backed reads: they are
     resolved once here instead of per iteration, and every write below goes
     through the local buffer reference. Same pixels, same order. */
  const LW = G.lightCv.width, LH = G.lightCv.height, LD = G.lightImg.data;
  for (let y=0;y<LH;y++){
    const ty=(y/LS)|0, row=ty*MAP_W;
    for (let x=0;x<LW;x++){
      /* NEUTRAL, not mono-yellow. This used to be tinted (255,246,186) plus a
         warm +18 lift, which existed to stop unlit floor going black. Now that
         darkness is the mask's job, tinting the bake would double-count it:
         a lit room would come out green-yellow a second time on top of a
         palette that is already the right colour. The bake is now a pure
         brightness, and the hue comes from the surfaces themselves. */
      const b = Math.min(1, G.lightArr[row + ((x/LS)|0)]);
      const v = Math.round(255*b);
      const k=(y*LW+x)*4;
      LD[k]=v; LD[k+1]=v; LD[k+2]=v;
      LD[k+3] = 255;
    }
  }
  G.lightCtx.putImageData(G.lightImg, 0, 0);

  /* The static tile layer, baked in the same stage: sections 1-3 of the
     renderer are entirely static. The carpet, the hash2 tonal variation, the
     wall faces, the wall tops and their edge highlights depend on nothing but
     the grid, which never changes while a floor is played. Painting them per
     viewport per frame was ~980 fillRect calls of unchanged pixels, so they
     are drawn into two world-sized canvases here and the renderer samples the
     viewport out of them with one drawImage each.

     TWO canvases, not one: the flood has to land BETWEEN the carpet and the
     wall faces — a partition standing in a flooded room stays dry — so the
     carpet and the walls cannot share a single layer.

     The patterns are anchored to the world grid here. The live code filled
     them under the camera transform, which tied their phase to the camera
     position, so the speckles swam as the view panned; baked, they are part
     of the building, which is what they always looked like they were. */
  bakeTiles();
}

/* Paint the static tile layer: carpet + tonal variation into G.tilesCv, wall
   faces + tops into G.wallsCv. Runs once per floor, from bakeLighting, with G
   and its grid already in place. Every pixel below is byte-for-byte the same
   drawing the renderer used to do per frame — same patterns, same coordinates,
   same order — over the whole map instead of the viewport. */
function bakeTiles(){
  G.tilesCv = document.createElement('canvas');
  G.tilesCv.width = MAP_W*TILE; G.tilesCv.height = MAP_H*TILE;
  G.tilesCtx = G.tilesCv.getContext('2d');
  {
    const g = G.tilesCtx;
    g.setTransform(1,0,0,1,0,0);
    /* ---------- carpet ---------- */
    g.fillStyle = carpetPat;
    g.fillRect(0, 0, MAP_W*TILE, MAP_H*TILE);
    // per-tile tonal variation
    for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
      const h=hash2(x,y);
      if (h<0.14){
        g.fillStyle = h<0.05 ? 'rgba(163,163,112,0.16)' : 'rgba(228,230,168,0.10)';
        g.fillRect(x*TILE, y*TILE, TILE, TILE);
      }
    }
  }

  G.wallsCv = document.createElement('canvas');
  G.wallsCv.width = MAP_W*TILE; G.wallsCv.height = MAP_H*TILE;
  G.wallsCtx = G.wallsCv.getContext('2d');
  {
    const g = G.wallsCtx;
    g.setTransform(1,0,0,1,0,0);
    /* ---------- wall faces + contact shadow ---------- */
    // The face is the vertical side of a partition, drawn into the floor tile
    // below it. A soft shadow on the carpet under it sells the height, which is
    // what makes a top-down maze read as a photographed room instead of a
    // colour-coded grid.
    const FACE = WALL_FACE;
    for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
      if (G.grid[y*MAP_W+x]!==WALL) continue;
      if (y+1>=MAP_H || G.grid[(y+1)*MAP_W+x]!==FLOOR) continue;
      const fx=x*TILE, fy=(y+1)*TILE;

      // shadow cast onto the carpet
      const sh=g.createLinearGradient(0, fy, 0, fy+TILE*0.5);
      sh.addColorStop(0,'rgba(12,10,4,0.30)');
      sh.addColorStop(1,'rgba(12,10,4,0)');
      g.fillStyle=sh;
      g.fillRect(fx, fy, TILE, TILE*0.5);

      // wallpapered face
      g.fillStyle = wallPat;
      g.fillRect(fx, fy, TILE, FACE);
      // hard line where the face meets the ceiling
      g.fillStyle='rgba(40,38,24,0.55)';
      g.fillRect(fx, fy, TILE, 2);
      // skirting shadow at the base
      g.fillStyle='rgba(48,46,30,0.42)';
      g.fillRect(fx, fy+FACE-2, TILE, 2);
    }

    /* ---------- wall tops ---------- */
    // Seen from directly above, so they read as the top of a partition: cooler
    // and clearly darker than the carpet. Deliberately NO per-tile banding —
    // a lip/edge/seam on every tile made a solid wall block look like decking.
    // Edges are drawn only where wall actually meets carpet.
    for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
      if (G.grid[y*MAP_W+x]!==WALL) continue;
      g.fillStyle = ceilPat;
      g.fillRect(x*TILE, y*TILE, TILE, TILE);
    }
    g.fillStyle='rgba(28,26,16,0.55)';
    for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
      if (G.grid[y*MAP_W+x]!==WALL) continue;
      const below = (y+1<MAP_H && G.grid[(y+1)*MAP_W+x]===FLOOR);
      if (below){ g.fillRect(x*TILE, y*TILE+TILE-2, TILE, 2); }
      if (x>0      && G.grid[y*MAP_W+x-1]===FLOOR) g.fillRect(x*TILE, y*TILE, 2, TILE);
      if (x<MAP_W-1 && G.grid[y*MAP_W+x+1]===FLOOR) g.fillRect(x*TILE+TILE-2, y*TILE, 2, TILE);
      if (y>0      && G.grid[(y-1)*MAP_W+x]===FLOOR) g.fillRect(x*TILE, y*TILE, TILE, 2);
      if (y<MAP_H-1 && G.grid[(y+1)*MAP_W+x]===FLOOR) g.fillRect(x*TILE, y*TILE+TILE-2, TILE, 2);
    }
  }
}

/* Fills G.regionOf, G.regionAdj and G.regionCount from the level's grid and
   rooms. Pure apart from those G fields. */
function labelRegions(level){
  const grid = level.grid;
  const at = (x,y)=> grid[y*MAP_W+x];
  const inB = (x,y)=> x>=0 && y>=0 && x<MAP_W && y<MAP_H;

  /* --- room regions -------------------------------------------------
     A region is one lit space: a BSP room, or a run of band floor between
     rooms (a gate tunnel). Labelling them is what lets "the room you are in"
     be a well-defined thing at all — the maze is one connected component,
     so a flood fill from the player would light the entire floor and the
     feature would be a no-op.

     Room rects come from disjoint BSP leaves, so they never overlap. The
     partition bands between them are not in any rect, and those tiles are
     flood filled into their own regions: a gate tunnel is a lit space of its
     own, which is exactly right — standing in a doorway lights the doorway,
     not the room behind you. */
  G.regionOf = new Int32Array(MAP_W*MAP_H).fill(-1);
  level.rooms.forEach((r, ri)=>{
    /* FLOOR TILES ONLY. Labelling the whole rect swept up the stub
       partitions that rooms are carved with, and a stub wall then carried its
       room's scope directly and skipped the brightest-neighbour pass below —
       so a wall standing in the middle of your own room rendered darker than
       the floor it bordered. Walls are not lit spaces; they are lit BY the
       spaces around them. Note this also keeps a stub from splitting a room
       into two lit regions, which is what we want: a partition stub is
       furniture, not a doorway. */
    for (let y=r.ry; y<r.ry+r.rh; y++)
      for (let x=r.rx; x<r.rx+r.rw; x++)
        if (at(x,y) === FLOOR) G.regionOf[y*MAP_W+x] = ri;
  });
  let nRegions = level.rooms.length;
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    const i0=y*MAP_W+x;
    if (at(x,y)!==FLOOR || G.regionOf[i0]>=0) continue;
    const id = nRegions++;
    const stack=[i0]; G.regionOf[i0]=id;
    while (stack.length){
      const c=stack.pop(), cx=c%MAP_W, cy=(c/MAP_W)|0;
      for (const [nx,ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]){
        if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) continue;
        const ni=ny*MAP_W+nx;
        if (at(nx,ny)!==FLOOR || G.regionOf[ni]>=0) continue;
        G.regionOf[ni]=id; stack.push(ni);
      }
    }
  }
  /* adjacency: regions that share a 4-connected floor edge. Two rooms can
     also be neighbours through a band, and a room with two gates has two
     different neighbours — the BFS has to see the real graph, not just
     "the next room over". */
  const regAdj = Array.from({length:nRegions}, ()=>[]);
  const regSeen = new Set();
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    const a=G.regionOf[y*MAP_W+x];
    if (a<0) continue;
    for (const [nx,ny] of [[x+1,y],[x,y+1]]){
      if (nx>=MAP_W||ny>=MAP_H) continue;
      const b=G.regionOf[ny*MAP_W+nx];
      if (b<0 || a===b) continue;
      const key = a<b ? a+','+b : b+','+a;
      if (regSeen.has(key)) continue;
      regSeen.add(key);
      regAdj[a].push(b); regAdj[b].push(a);
    }
  }
  G.regionAdj = regAdj;
  G.regionCount = nRegions;
}

/* Returns the cast for the level: one walker as far from the door as the
   geometry allows, the rest dormant coils spread across rooms. Pure. */
function spawnAgents(level){
  const spawn = level.spawn;
  const spec = level.spec;
  const rng = level.rng;
  /* the room farthest from the door — where the walker starts, so nothing is
     standing in the room you walk into */
  let far = null, fd = -1;
  for (const r of level.rooms){
    const cx=r.rx+r.rw/2, cy=r.ry+r.rh/2;
    const d = Math.hypot(cx-spawn.x, cy-spawn.y);
    if (d>fd){ fd=d; far=r; }
  }
  /* --- entities ---
     How many there are is a property of the LEVEL, not of the depth: level 1 is
     one thing in the building with you and level 5 is four, and the difference
     between them is entirely in what is walking around while you work.

     The first is a WALKER and spawns as far from the door as the geometry
     allows, so the level never opens with something standing in it. The rest are
     dormant coils, spread across rooms and never in the one you spawn in — a
     coil pile in the doorway is not difficulty, it is an ambush with no tell. */
  const agents = [];
  const agentRooms = new Set();
  const firstFar = far && far.rw>=5 && far.rh>=5
    ? far
    : level.rooms.reduce((b,r)=>{
        const d = Math.hypot(r.rx+r.rw/2-spawn.x, r.ry+r.rh/2-spawn.y);
        return (!b || d>b.d) ? {r,d} : b;
      }, null)?.r;
  if (spec.forms > 0 && firstFar){
    agentRooms.add(firstFar);
    agents.push({
      x: firstFar.rx+firstFar.rw/2, y: firstFar.ry+firstFar.rh/2,
      state:'WALK', t:0, rise:0, target:null, face:Math.random()*6.28,
      wakeCd:0, stepT:0, born:3.5
    });
  }
  const coilRooms = level.rooms.filter(r=>r.rw>=5&&r.rh>=5 && !agentRooms.has(r));
  for (let i=0; coilRooms.length && agents.length<spec.forms; i++){
    const r = coilRooms[(rng()*coilRooms.length)|0];
    const cx = r.rx+r.rw/2, cy = r.ry+r.rh/2;
    /* Not in the spawn room, and not on top of a pipe: a coil sharing a tile
       with the only place you can stand to repair would make that pipe's five
       seconds unsurvivable by accident rather than by choice. */
    if (Math.hypot(cx-spawn.x, cy-spawn.y) < 9) continue;
    if (level.leaks.some(L=>Math.hypot(cx-(L.sx+0.5), cy-(L.sy+0.5)) < 4)) continue;
    agents.push({
      x: r.rx+1+Math.floor(rng()*(r.rw-2)),
      y: r.ry+1+Math.floor(rng()*(r.rh-2)),
      state:'DORMANT', t:0, rise:0, target:null, face:0,
      wakeCd:0, stepT:0, born:0
    });
  }
  return agents;
}

function buildFloor(floorNum, seed){
  const rng = mulberry32(seed + floorNum*7919);
  const level = genLevel(rng, floorNum);

  const grid = level.grid;
  const at = (x,y)=> grid[y*MAP_W+x];
  const inB = (x,y)=> x>=0 && y>=0 && x<MAP_W && y<MAP_H;

  /* --- line of sight (Bresenham, walls block) --- */
  function los(x0,y0,x1,y1){
    x0=Math.floor(x0); y0=Math.floor(y0); x1=Math.floor(x1); y1=Math.floor(y1);
    let dx=Math.abs(x1-x0), dy=Math.abs(y1-y0);
    let sx=x0<x1?1:-1, sy=y0<y1?1:-1, err=dx-dy;
    let guard=0;
    while(guard++ < 400){
      if(x0===x1 && y0===y1) return true;
      const e2 = 2*err;
      if (e2 > -dy){ err -= dy; x0 += sx; }
      if (e2 <  dx){ err += dx; y0 += sy; }
      if (x0===x1 && y0===y1) return true;
      if (!inB(x0,y0) || at(x0,y0)===WALL) return false;
    }
    return false;
  }

  /* The floor object is created HERE, before the bakes below write into it.
     Every per-floor buffer — light, vision, mask, cone, regions, flood — is a
     field of G, so building the next floor replaces them all at once and
     nothing floor-scoped can outlive the floor it describes. The buffers are
     preallocated because the bakes write through G from their first line;
     the fields the placement code decides are assigned after it runs. */
  G = {
    floor: floorNum,
    seed,
    grid, at, inB, los,
    rooms: level.rooms,
    exitTiles: level.exit,
    leaks: level.leaks,
    fixtures: level.fixtures,
    batteries: level.batteries,
    graffiti: level.graffiti,
    /* The three numbers the HUD and the door gate read, derived once here so
       nothing has to walk the array to answer "is this level finished". */
    leaksOpen: level.leaks.length,
    pipes: level.leaks.length,
    lightArr: new Float32Array(MAP_W*MAP_H),
    lightCv: null, lightCtx: null, lightImg: null,
    visArr: new Float32Array(MAP_W*MAP_H).fill(DARK_ROOM),
    visFrom: new Float32Array(MAP_W*MAP_H).fill(DARK_ROOM),
    visTgt: new Float32Array(MAP_W*MAP_H).fill(DARK_ROOM),
    visScratch: new Float32Array(MAP_W*MAP_H),
    maskArr: new Float32Array(MAP_W*MAP_H),
    maskTgt: new Float32Array(MAP_W*MAP_H),
    coneArr: new Float32Array(MAP_W*MAP_H),
    maskCv: null, maskCtx: null, maskImg: null,
    /* the static tile layer: carpet + tonal variation, and wall faces + tops.
       Two layers because the flood lands between them. */
    tilesCv: null, tilesCtx: null, wallsCv: null, wallsCtx: null,
    regionOf: new Int32Array(MAP_W*MAP_H).fill(-1),
    regionAdj: null, regionCount: 0,
    visRegion: -1, visStep: 0, visFadeT: 0,
    coneX: NaN, coneY: NaN, coneFace: NaN, coneRadar: null,
    scopeDirty: false,
    wetArr: new Float32Array(MAP_W*MAP_H),
    waterDist: null, wetByDist: [], wetFront: 0, wetMaxDist: 0, wetSum: 0,
    wetEdgeD: -1, wetIndexAtDist: null,
    wetCv: null, wetCtx: null, wetImg: null,
    postCv: null
  };

  bakeLighting(level);
  labelRegions(level);
  /* The mask is a SEPARATE canvas at 1 sample per tile rather than another
     term folded into the light bake. It changes every frame the character
     turns, and folding it into the lightmap would mean repacking 116k pixels
     on every small movement instead of 5.8k. */
  G.maskCv = document.createElement('canvas');
  G.maskCv.width = MAP_W; G.maskCv.height = MAP_H;
  G.maskCtx = G.maskCv.getContext('2d');
  G.maskImg = G.maskCtx.createImageData(MAP_W, MAP_H);
  G.agents = spawnAgents(level);
  G.player = { x: level.spawn.x, y: level.spawn.y, face:-Math.PI/2, stepT:0, stepDur:0.46, moving:false };
  G.batt = BATT_MAX;
  G.radar = false;
  G.noise = 0; G.noisePeak = 0; G.selfNoise = 0;
  G.descend = 0;
  /* THE CLOCK. Full at the moment you step through the door, counting down
     the whole level, and the only reason the level has a shape. */
  G.clock = FLOOR_CLOCK;
  G.time = 0;
  G.seenBy = 0;
  G.nearest = 99;
  G.stat = { noises:0, deaths:0, sealed:0 };
  /* how many floor tiles the water can ever reach — the denominator for
     "how flooded is this level". Counted from the distance field rather than
     guessed, so it is exactly the set of tiles that can ever go wet. */
  G.wetFloor = 0;
  G.wet = 0; G.floodCover = 0; G.atLeak = false; G.leakPower = 0;
  G.leakTotal = 0; G.leakDist = 99;
  /* Light the room the player spawned in. After this point it follows them:
     G exists, so regionAt(G.player) is meaningful. */
  scopeRoomLight(0, true);
  snapMask();

  initFlood();
}


/* ============================================================
   THE FLOOD
   Water spreads from every open pipe at a fixed rate along walkable floor.
   Nothing else: no pressure model, no pooling, no per-tile diffusion. A distance
   field is the whole physics because water runs downhill, and re-deriving it
   on every state change (rather than advancing a front every frame) means the
   spread can never depend on frame timing — two machines at different frame
   rates flood identically.

   MULTI-SOURCE, and that is a one-word change to the model rather than a
   rewrite: the field is distance to the NEAREST burst, seeded from all of them
   at once, so a tile's target wetness is still exactly `dist <= front` and
   everything downstream — the ordering, the incremental sum, the waterline
   bound — is untouched. Four pipes do not mean four overlapping floods with
   four fronts to reconcile; they mean one flood that started in four places,
   which is what standing water in a building with four burst pipes does.
   ============================================================ */

/* BFS distance in tiles from the NEAREST pipe across walkable floor. Derived
   once at level build; during play it is read-only. */
function floodField(){
  const d = new Int32Array(MAP_W*MAP_H).fill(-1);
  const q = [];
  for (const L of G.leaks){
    const s = L.sy*MAP_W + L.sx;
    if (d[s] >= 0) continue;
    d[s] = 0;
    q.push(s);
  }
  /* q comes out of a BFS in non-decreasing distance order already — that is
     what a BFS is — so it IS the G.wetByDist ordering and there is no reason to
     sort it. Carrying that out of the traversal instead of rediscovering it
     later is the whole optimisation. */
  for (let h=0; h<q.length; h++){
    const c = q[h], cx = c%MAP_W, cy = (c/MAP_W)|0;
    for (const [nx,ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]){
      if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) continue;
      const ni = ny*MAP_W+nx;
      if (G.grid[ni]!==FLOOR || d[ni]>=0) continue;
      d[ni] = d[c]+1;
      q.push(ni);
    }
  }
  return { dist:d, order:q };
}

function initFlood(){
  G.wetArr = new Float32Array(MAP_W*MAP_H);      // 0 dry .. 1 standing water
  const ff = floodField();
  G.waterDist = ff.dist;
  G.wetByDist = ff.order;                      // BFS order == sorted by distance
  G.wetMaxDist = G.wetByDist.length ? G.waterDist[G.wetByDist[G.wetByDist.length-1]] : 0;
  /* Distance -> first index at or past it. BFS order is sorted, so this is one
     linear pass, and afterwards the waterline bound is an array read. */
  G.wetIndexAtDist = new Int32Array(G.wetMaxDist+2).fill(G.wetByDist.length);
  for (let n=G.wetByDist.length-1; n>=0; n--){
    const d = G.waterDist[G.wetByDist[n]];
    if (d < G.wetIndexAtDist.length) G.wetIndexAtDist[d] = n;
  }
  for (let d=G.wetMaxDist-1; d>=0; d--){
    if (G.wetIndexAtDist[d] > G.wetIndexAtDist[d+1]) G.wetIndexAtDist[d] = G.wetIndexAtDist[d+1];
  }
  G.wetFront = 0;
  G.wetSum = 0;
  G.wetEdgeD = -1;
  G.wetFloor = G.wetByDist.length;
  G.wetCv = document.createElement('canvas');
  G.wetCv.width = MAP_W; G.wetCv.height = MAP_H;
  G.wetCtx = G.wetCv.getContext('2d');
  G.wetImg = G.wetCtx.createImageData(MAP_W, MAP_H);
  for (let i=0;i<MAP_W*MAP_H;i++) G.wetImg.data[i*4+3] = 255;
  /* Start the room the player spawns in already damp. Otherwise the first
     seconds of a floor are a pristine yellow carpet with no cue at all, and
     the water reads as a thing that switched on rather than a thing that has
     been running for as long as you have been here. */
  seedSplash(G.player.x, G.player.y, 0.30);

  /* Pre-warm the flood so there is a trail to follow from the first second.
     This is a direct assignment rather than a simulated fast-forward because
     the alternative is stepping tickFlood thousands of times per floor at
     floor build, and the end state is exactly "everything inside the front is
     fully wet", which is what the integration converges to anyway. G.wetSum is
     computed from the same pass, so the incremental sum and the array cannot
     disagree about where they started. */
  {
    const front = Math.min(G.wetMaxDist, LEAK_HEADSTART/LEAK_SPREAD);
    G.wetFront = front;
    let sum = 0;
    /* Every wet tile is at distance <= front, so the edge is known exactly here
       rather than by scanning: this pass is walking them anyway. */
    const hi  = Math.min(G.wetByDist.length-1,
                  G.wetIndexAtDist[Math.min(Math.ceil(front), G.wetIndexAtDist.length-1)]);
    for (let n=0; n<=hi; n++){
      const i = G.wetByDist[n];
      if (G.waterDist[i] <= front){ G.wetArr[i] = 1; sum += 1; }
    }
    G.wetSum = sum;
    /* seedSplash already ran, so the spawn puddle may reach past the pre-warmed
       front — take whichever reaches further. */
    G.wetEdgeD = Math.max(G.wetEdgeD, Math.floor(front));
  }

  G.floodCover = G.wetFloor ? G.wetSum/G.wetFloor : 0;
  /* Packed HERE as well as flagged. initFlood runs inside buildFloor, and
     buildFloor can run in the MIDDLE of a frame — the door rebuilds the floor
     from update() — so the render that follows in that same frame has no pack
     of its own any more, and the fresh G.wetImg (alpha 255, RGB 0) would paint
     black over the new carpet for one frame. */
  packWet();
  waterDirty = true;
}

/* Drop a blob of water. Used to seed the floor at spawn and — the reason this
   exists as a function — to ripple outward from the player while they wade,
   so moving through water leaves something behind them. */
function seedSplash(wx, wy, amount){
  if (!G.wetArr) return;
  const cx = Math.floor(wx), cy = Math.floor(wy);
  for (let y=cy-1;y<=cy+1;y++) for (let x=cx-1;x<=cx+1;x++){
    if (x<0||y<0||x>=MAP_W||y>=MAP_H) continue;
    const i = y*MAP_W+x;
    if (G.grid[i]!==FLOOR) continue;
    const dd = Math.hypot(x+0.5-wx, y+0.5-wy);
    const w = Math.min(1, Math.max(0, amount * (1 - dd/1.8)));
    if (w > G.wetArr[i]){
      G.wetSum += w - G.wetArr[i]; G.wetArr[i] = w;
      waterDirty = true;
      /* A splash can wet a tile further out than the flood has reached — the
         player wading a puddle throws it a tile or two past the waterline. The
         pass is bounded by the wet edge, so a tile raised without moving the
         edge would be one the next tickFlood never looks at: a permanent wet
         spot the player made and cannot dry. */
      if (w > WET_EDGE && G.waterDist[i] > G.wetEdgeD) G.wetEdgeD = G.waterDist[i];
    }
  }
}

/* Wetness under a world point, 0..1. Sampled by the movement code and the
   renderer so "how deep is the water here" is one number, not two. */
function wetAt(wx, wy){
  if (!G.wetArr) return 0;
  const x=Math.floor(wx), y=Math.floor(wy);
  if (x<0||y<0||x>=MAP_W||y>=MAP_H) return 0;
  return G.wetArr[y*MAP_W+x];
}

/* How much of the reachable floor is currently wet, 0..1. Divided by a FLOOR
   count taken once, not by MAP_W*MAP_H: most of the map is solid rock, and
   dividing by the whole map would report a floor as barely damp when the only
   room in it was underwater. */
/* Sum every wet tile. This is the slow, obviously-correct version and the game
   does NOT call it — tickFlood maintains the same number incrementally as it
   moves the band and leaves it on G.floodCover. It stays because it is the
   ORACLE that the incremental sum is checked against in the test suite, which
   is the only way to know the incremental version has not quietly drifted. */
function floodCover(){
  if (!G.wetArr || !G.wetFloor) return 0;
  let s=0;
  for (let i=0;i<G.wetArr.length;i++) s += G.wetArr[i];
  return s/G.wetFloor;
}

/* Is the player close enough to an OPEN pipe to work on it? Measured against
   the standing spot, not the tile the face was picked from, because the whole
   interaction is "put your hands on the pipe" and a repair you can trigger
   from a diagonal tile away is not that. Returns the pipe itself so the
   caller does not have to search again. */
function leakAt(x, y){
  for (const L of G.leaks){
    if (L.fixed) continue;
    if (Math.hypot(L.sx+0.5-x, L.sy+0.5-y) < REPAIR_REACH) return L;
  }
  return null;
}
function leakReach(x, y){
  return !!leakAt(x, y);
}

/* Seal one pipe. Permanent, once per pipe — the flag is checked before the
   progress bar is ever allowed to advance, so this cannot be double-applied
   and cannot leave the pipe flooded with a full progress bar. */
function sealLeak(L){
  if (!L || L.fixed) return;
  L.fixed = true;
  L.fixedAt = G.time;
  /* The bar goes with it. Leaving a full progress bar on a sealed pipe is
     harmless today because the ring is gated on !fixed — but it is a number
     that means "work in progress" sitting at 100% forever, and the first thing
     that reads it as something else will be wrong. */
  L.repair = 0;
  G.leaksOpen = Math.max(0, G.leaksOpen-1);
  Audio_.seal();
  /* The recession only starts when the LAST pipe is closed, so the water keeps
     advancing between the first repair and the fourth. That is deliberate: it
     means sealing one pipe out of four is progress and not relief, and the floor
     does not stop drowning the moment you feel good about yourself. */
  flash(G.leaksOpen
    ? `PIPE SEALED \u2014 ${G.leaksOpen} STILL OPEN`
    : 'EVERY PIPE SEALED \u2014 GET BACK TO THE DOOR');
  G.stat.sealed++;
  runStat.sealed++;
  /* Recompute the distance field from the seal point so the recession runs
     outward from where the work happened rather than from the pipe. It is a
     visual difference, but it is the difference between water receding from
     the thing you fixed and water receding from somewhere off screen. */
  /* The recession runs off the EXISTING distance field, not a new one from the
     seal point. That was the first version and it was wrong: re-deriving the
     field re-sorts the ordering, which resets the front to "nothing is wet"
     and the level would snap from flooded to dry on the frame you fixed the
     pipe — the single most visible bug available in this feature. The field is
     already the right answer: water recedes from where it spread. */
  packWet();
}

/* Advance the water one frame.
   The front is at (elapsed / LEAK_SPREAD) tiles from the sources, so a tile's
   target wetness is exactly `dist <= front`. G.wetByDist is sorted by distance,
   so "every tile at or inside the front" is a PREFIX of it.

   Wetness is integrated toward the target with a time constant rather than
   assigned, so the waterline creeps rather than teleporting a tile at a time,
   and a tile the front has just passed is only part wet. */
function tickFlood(dt){
  if (!G.leaks.length || !G.wetArr) return;

  /* RISING while any pipe is open, FALLING once all are sealed — and NOT at the
     same pace. The waterline goes back out at one tile per LEAK_RETREAT second,
     nearly three times the rate it came in at. That asymmetry is deliberate: the
     flood runs to the far side of the building (G.wetMaxDist is 82-148 tiles out
     depending on the floor), so a symmetric recession is a five to eight minute
     mop-up — longer than FLOOR_CLOCK, and it means walking home through standing
     water for minutes after the objective is already done.

     It used to run at one tile per WET_FALL (7s against an arrival of 3.2), and
     then at exactly LEAK_SPREAD once the two were unified. Both were slower than
     the clock allows. What has to survive any of that is that the recession stays
     RADIAL — derived from the front, not a separate "drain everything" pass — so
     water recedes from the edges inward, away from the pipes, which is what you
     would see on a real level and not what a uniform fade gives you. */
  const prev = G.wetFront;
  const front = G.leaksOpen > 0
    ? Math.min(G.wetMaxDist, prev + dt/LEAK_SPREAD)
    : Math.max(0, prev - dt/LEAK_RETREAT);
  G.wetFront = front;
  /* A STILL FRONT IS NOT SETTLED WATER. The fade is a time constant, so it
     approaches zero without ever arriving, and the only true "nothing to do" is
     an empty edge. Gating the pass on the front alone ended the simulation the
     instant the recession reached the pipes, leaving the last ring or two of
     tiles parked at a few percent wet for the rest of the level — and because
     the front had stopped, nothing would ever come back for them.

     It cost nothing while the water was RISING: the front only stands still
     once it has hit G.wetMaxDist, and by then the whole floor is under water
     anyway. It costs one pass over a shrinking prefix while the floor drains,
     and then the edge empties and this is a single comparison again. */
  if (front === prev && G.wetEdgeD < 0) return;

  /* Every tile at or inside the front still has to integrate toward its
     target — a tile keeps darkening for WET_RISE seconds AFTER the front has
     passed it. The first version updated only the band the front swept, on the
     reasoning that a tile's target only changes there. That reasoning is true
     and the implementation was still wrong: it left every tile stranded at
     about 10% wetness forever, and the floor looked permanently damp rather
     than flooded. The target changes in the band; the approach to it does not.

     What IS worth exploiting is the ordering: everything wet is a contiguous
     PREFIX of G.wetByDist, and nothing past its edge can change. Iterating the
     prefix is bounded by how flooded the level is, and an unflooded one costs
     one iteration. The edge is `G.wetEdgeD` — see the note there for why it is
     not the front, and what it cost to get that wrong. */
  const boundD = Math.max(G.wetEdgeD, Math.ceil(Math.max(prev, front)));
  const hi = G.wetIndexAtDist[Math.min(boundD+1, G.wetIndexAtDist.length-1)] - 1;
  if (hi < 0) return;
  const tau = G.leaksOpen>0 ? WET_RISE : WET_FALL;
  const k = 1 - Math.exp(-dt/tau);
  /* A front sitting at zero is no water at all — including on the pipe's own
     standing spot. `dist <= front` says otherwise for distance 0, which pinned
     one tile at full wetness for the rest of the level: a permanent damp patch
     under the pipe you just fixed, in the one place on the floor where the
     player has spent five seconds looking at it. */
  const anyWater = front > 0;
  let sum = G.wetSum;
  let changed = false;
  /* The new edge, computed in the pass that is already walking the tiles rather
     than by a second scan. This is the only place the edge moves, and it moves
     DOWN monotonically once the water starts going out, which is what lets the
     next frame's prefix be smaller than this one's. */
  let edge = -1;
  for (let n=0; n<=hi; n++){
    const i = G.wetByDist[n];
    const cur = G.wetArr[i];
    const target = (anyWater && G.waterDist[i] <= front) ? 1 : 0;
    /* Deliberately not `continue`d on an unchanged tile: the edge has to be
       re-derived from every tile in the prefix, not only from the ones that
       moved this frame. */
    if (cur !== target){
      const next = cur + (target-cur)*k;
      /* A tile that has faded below the edge goes to EXACTLY zero rather than
         parking just under it. It is invisible either way, but a thousand tiles
         left at 1.2% are a thousand tiles the flood gauge never stops counting,
         and a floor that has finished draining would sit at "01" for ever. */
      const snapped = target===0 ? (next <= WET_EDGE ? 0 : next)
                                 : ((1-next) < 0.004 ? 1 : next);
      /* G.wetSum is maintained INCREMENTALLY rather than by re-summing the array
         every frame. It is the numerator of the flood gauge, which is read by
         the leak's own noise level and by the HUD, so it is read a lot; summing
         5776 floats to answer it each time is the same mistake as the scan this
         function used to do, wearing a different hat. */
      sum += snapped - cur;
      G.wetArr[i] = snapped;
      changed = true;
    }
    if (G.wetArr[i] > WET_EDGE) edge = G.waterDist[i];
  }
  G.wetEdgeD = edge;
  if (!changed) return;
  G.wetSum = sum;
  waterDirty = true;
  G.floodCover = G.wetFloor ? Math.max(0, sum/G.wetFloor) : 0;
}

/* ============================================================
   FLOOD FIELD -> IMAGE
   One RGBA image at one pixel per tile, drawn scaled up with smoothing. The
   water is a MULTIPLY-STYLE tint rather than an opaque fill, so it reads as
   the same carpet under water instead of a blue card laid on top of it — the
   yellow is still there underneath, darkened and shifted, which is what wet
   carpet actually does.
   ============================================================ */
/* One pixel per tile, then upscaled with bilinear smoothing. The smoothing is
   not cosmetic: at one pixel per tile a hard-edged square waterline crawls
   along the tile grid as it advances and reads as a rendering fault, the same
   way the cone boundary used to. Bilinear across the tile grid turns the front
   into a soft irregular edge for free, and costs nothing per frame.

   Dry tiles are written with alpha 0, NOT with alpha 255 and black RGB. That
   is the bug this shape of the loop exists to prevent: the image is opaque, so
   an untouched tile is black and paints black over the carpet it is drawn on.

   The ramp is a straight lerp between the two ends of the selected tint, and
   the ends are picked by SOLVING for what the composited tile should look like
   over the carpet — see WATER_TINTS. Picking a colour that looks like water in
   isolation is what produced two wrong versions: one that read as glowing ice,
   and one so dark it was indistinguishable from an unlit floor, which defeats
   the mechanic entirely. */
function packWet(){
  if (!wantPixels) return;
  const T = WATER_TINTS[SETTINGS.waterHue] || WATER_TINTS.slate;
  const contrast = SETTINGS.waterContrast;
  const d = G.wetImg.data;
  for (let i=0;i<MAP_W*MAP_H;i++){
    const a = G.wetArr[i];
    const k = i*4;
    if (a <= WET_DRAW){ d[k+3] = 0; continue; }
    const t = Math.min(1, a);
    const blue = Math.max(0, (t-0.35)/0.65);
    d[k]   = Math.round(T.damp[0] + (T.deep[0]-T.damp[0])*blue);
    d[k+1] = Math.round(T.damp[1] + (T.deep[1]-T.damp[1])*blue);
    d[k+2] = Math.round(T.damp[2] + (T.deep[2]-T.damp[2])*blue);
    d[k+3] = Math.round(255*Math.min(0.94, (0.34 + t*0.48)*contrast));
  }
  G.wetCtx.putImageData(G.wetImg, 0, 0);
}

/* ============================================================
   ROOM SCOPED VISIBILITY
   The bake answers "how bright is this tile under its own
   fluorescents". These answer "which of those tiles can the
   player see right now" — the room they are standing in, plus
   whatever spills through a gate they can see down.

   A BFS over REGIONS, not tiles. Tile distance would light the
   next room anyway, because a gate tunnel is only 2 tiles wide:
   the far side of a doorway is 3 tiles away, which is closer than
   the far corner of the room you are standing in. Region distance
   is what makes "the room you are in" mean a room.
   ============================================================ */

/* Region visibility level: how much of the room's own light survives the
   number of gates between you and it. See HOP_FALL. */
function scopeFor(hops){
  if (hops < 0) return 0;
  return HOP_FALL[Math.min(hops, HOP_FALL.length-1)];
}

function regionAt(x,y){
  const tx=Math.floor(x), ty=Math.floor(y);
  if (tx<0||ty<0||tx>=MAP_W||ty>=MAP_H) return -1;
  return G.regionOf[ty*MAP_W+tx];
}

/* Is this world point inside the rectangle the renderer is drawing?
   Derived from the PLAYER, not from render()'s camera object. update() must
   not read render's mutable state — the headless suite drives update() with no
   renderer at all, and reading a camera that only moves during render would
   silently make the reveal depend on whether a frame had been drawn. The clamp
   is replicated here for exactly that reason: at the edges of the floor the
   camera stops rather than following, and seeing what is genuinely off-screen
   would be worse than a one-frame difference from the smoothing. */
function onScreen(wx, wy){
  const T = TILE*SCALE;
  const halfW = cvs.width /(2*T), halfH = cvs.height /(2*T);
  let cx = G.player.x, cy = G.player.y;
  if (MAP_W > halfW*2) cx = Math.max(halfW, Math.min(MAP_W-halfW, cx));
  if (MAP_H > halfH*2) cy = Math.max(halfH, Math.min(MAP_H-halfH, cy));
  return Math.abs(wx-cx) <= halfW && Math.abs(wy-cy) <= halfH;
}

/* How visible a fixture is right now: the visibility of the tile it hangs
   over, from the combined mask. Sampled from the CURRENT mask, not from a
   target, so a tube does not pop to full brightness the instant you turn. */
function fixtureVis(f){
  const tx=Math.floor(f.x), ty=Math.floor(f.y);
  if (tx<0||ty<0||tx>=MAP_W||ty>=MAP_H) return 0;
  return G.maskArr[ty*MAP_W+tx];
}

/* ============================================================
   WHAT THE CHARACTER CAN SEE
   One mask, and only one place in the program decides it:

     radar on      everything, full brightness, no cone and no scope
     radar off     room scope x distance x cone

   The radar used to be a torch: a narrow beam that was its own term in this
   mask, because an additive pass drawn after the multiply revealed nothing once
   dark rooms were BLACK — there was no geometry left underneath it. A tool that
   reveals the whole floor does not need to be a beam at all, so it is not one.
   ============================================================ */

/* Fan of rays from (ox,oy) within halfAngle radians of `facing`, stopping at
   the first wall. `gain` scales the result; `fall` is how much brightness is
   lost at maximum range (0 = none). The cone calls it with `fall` of 0 — the
   cone is a statement about angles and occlusion only, and brightness falloff
   is a separate term so the radar can have one and your own room cannot.

   Traversal is an exact voxel walk (Amanatides-Woo), one step per tile
   crossed, NOT a fixed-distance sample. Sampling was subtly wrong in a way
   that only showed up as an assertion failure: a ray stepping every 0.35
   tiles skipped a wall it was clipping for a 0.4-tile sliver, and lit the
   pocket behind it. Fifteen tiles out of 1722 occluded ones, invisible in any
   aggregate brightness number, and exactly the "the cone stops at a wall"
   claim being false. It is also cheaper: one step per tile instead of 2.9. */
function castFan(out, ox, oy, facing, halfAngle, range, rays, gain, fall){
  const grid=G.grid;
  for (let r=0; r<rays; r++){
    const a = facing - halfAngle + (rays===1 ? 0 : (r/(rays-1))*halfAngle*2);
    const dx=Math.cos(a), dy=Math.sin(a);
    let ix=Math.floor(ox), iy=Math.floor(oy);
    if (ix<0||iy<0||ix>=MAP_W||iy>=MAP_H) continue;
    if (grid[iy*MAP_W+ix]===WALL) continue;    // eye inside a wall: see nothing
    const stepX = dx>0?1:-1, stepY = dy>0?1:-1;
    const invX = dx!==0 ? 1/Math.abs(dx) : Infinity;
    const invY = dy!==0 ? 1/Math.abs(dy) : Infinity;
    let tMaxX = dx!==0 ? (dx>0 ? (ix+1-ox) : (ox-ix)) * invX : Infinity;
    let tMaxY = dy!==0 ? (dy>0 ? (iy+1-oy) : (oy-iy)) * invY : Infinity;
    const tDeltaX = invX, tDeltaY = invY;
    let t = 0;
    while (t <= range){
      if (ix<0||iy<0||ix>=MAP_W||iy>=MAP_H) break;
      const i = iy*MAP_W+ix;
      if (grid[i]===WALL) break;                // the wall occludes; stop
      /* Only light the tile if the ray passes NEAR ITS CENTRE, not if it
         clips the corner. A voxel walk marks every tile the ray enters, which
         includes the ones it grazes by a few pixels — so you could see a
         one-tile sliver of floor around the far side of a wall corner, a tile
         that is geometrically behind the wall. Requiring the ray to come
         within VIEW_MID of the tile centre makes "visible" mean "there is a
         clear line to the middle of it", which is both what the eye means and
         what the occlusion oracle checks. */
      const cx=ix+0.5-ox, cy=iy+0.5-oy;
      const tc = cx*dx + cy*dy;                 // closest approach along the ray
      if (tc>=0 && tc<=range){
        const miss2 = cx*cx + cy*cy - tc*tc;    // |d| is 1, so this is the squared miss
        if (miss2 <= VIEW_MID*VIEW_MID){
          const v = gain*(1 - fall*Math.min(1, tc/range));
          if (v > out[i]) out[i] = v;
        }
      }
      /* Exact corner: the ray passes precisely through a vertex. Step both
         axes and refuse if both tiles it stepped past are solid, so it cannot
         thread the diagonal pinch between two partition stubs. */
      if (Math.abs(tMaxX-tMaxY) < 1e-9){
        const ax=ix+stepX, ay=iy;
        const bx=ix, by=iy+stepY;
        const sa=(ax<0||ay<0||ax>=MAP_W||ay>=MAP_H)||grid[ay*MAP_W+ax]===WALL;
        const sb=(bx<0||by<0||bx>=MAP_W||by>=MAP_H)||grid[by*MAP_W+bx]===WALL;
        if (sa && sb) break;
        t=tMaxX; tMaxX+=tDeltaX; tMaxY+=tDeltaY; ix=ax; iy=ay;
      } else if (tMaxX < tMaxY){
        t=tMaxX; tMaxX+=tDeltaX; ix+=stepX;
      } else {
        t=tMaxY; tMaxY+=tDeltaY; iy+=stepY;
      }
    }
  }
}

/* Rebuild G.coneArr, then fold everything into maskTarget.
   Called only when the pose moved, so standing still costs nothing at all.

   The pose test is on the player's POSITION, not their tile. It used to be on
   the tile, which meant the cone was recomputed about three times a second
   while walking and held still in between — so the boundary of vision jumped a
   whole tile at a time and the world flickered as you crossed each boundary.
   Retracing on any movement costs the same per frame (it was going to run on
   every frame anyway) and the edge now tracks you continuously. */
function traceViewCone(force){
  const p = G.player;
  const tx=Math.floor(p.x), ty=Math.floor(p.y);
  /* Radar state is part of the pose: pressing R while standing still must
     retrace, or the sweep only appears once you next move. */
  if (!force && p.x===G.coneX && p.y===G.coneY && p.face===G.coneFace && G.radar===G.coneRadar)
    return false;
  G.coneX=p.x; G.coneY=p.y; G.coneFace=p.face; G.coneRadar=G.radar;

  G.coneArr.fill(0);

  const ex = p.x + Math.cos(p.face)*HAND_OFF;
  const ey = p.y + Math.sin(p.face)*HAND_OFF;

  /* The cone has NO distance falloff. It is a statement about ANGLES and
     OCCLUSION only: inside 100 degrees of facing, until a wall. It used to
     fade with range like a light, which put the far corner of a 12-tile room
     at 0.6 while the tile underfoot was at 1.0 — so the room you are standing
     in was a gradient from bright to dim, which is the one thing this feature
     must never do. What you can see is bright; what you cannot is black. */
  castFan(G.coneArr, ex, ey, p.face, VIEW_HALF, VIEW_RANGE, VIEW_RAYS, 1, 0);

  /* One tile of guaranteed visibility under the player. Without it the avatar
     can back into a corner where every ray exits before reaching its own tile
     and the figure renders inside a black hole. */
  if (tx>=0&&ty>=0&&tx<MAP_W&&ty<MAP_H) G.coneArr[ty*MAP_W+tx]=1;

  /* Walls: a wall you can see the face of is visible, and it takes the
     brightest floor it touches — no dimming factor. The mask dimmed walls by
     10% "so they would read as walls", which is backwards: they already read
     as walls because they are a different texture AND the bake floors them at
     80% of the carpet. Dimming them twice in the mask as well left them
     measurably darker than the floor in front, which is the signature of a
     hole rather than a wall. A wall deep inside a block with nothing lit
     around it stays black, which is what you want — you should not be able to
     see the inside of the building. */
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    const i=y*MAP_W+x;
    if (G.grid[i]!==WALL) continue;
    let m = 0;
    if (x+1<MAP_W   && G.grid[i+1]===FLOOR)   m=Math.max(m, G.coneArr[i+1]);
    if (x>0        && G.grid[i-1]===FLOOR)   m=Math.max(m, G.coneArr[i-1]);
    if (y+1<MAP_H  && G.grid[i+MAP_W]===FLOOR) m=Math.max(m, G.coneArr[i+MAP_W]);
    if (y>0        && G.grid[i-MAP_W]===FLOOR) m=Math.max(m, G.coneArr[i-MAP_W]);
    G.coneArr[i] = Math.max(G.coneArr[i], m);
  }

  /* Fold the three terms into the target mask. The radar short-circuits all of
     them — sweeping lights the whole floor, so there is nowhere left dark.

     The distance term is skipped for the player's own region (scope 1.0), so
     the room you are standing in is uniformly bright no matter which corner
     you are in. Everywhere else it is what turns a long corridor into a
     corridor instead of a lit pipe.

     Split out of traceViewCone because it also has to run when only the ROOM
     SCOPE moved (the crossfade), when the cone itself did not change at all. */
  combineMask();
  return true;
}

/* Fold scope, distance and cone into the target mask.

   The radar short-circuits all of it: sweeping lights the whole floor, so
   every tile is visible and there is nowhere left to hide. That is the entire
   tool. It is handled here rather than at draw time so there is exactly one
   place in the program where "what can the player see" is decided. */
function combineMask(){
  if (G.radar){ G.maskTgt.fill(1); return; }
  const px2=G.player.x, py2=G.player.y;
  for (let i=0; i<G.maskTgt.length; i++){
    const sc = G.visArr[i], cn = G.coneArr[i];
    let v = 0;
    if (sc > 0 && cn > 0){
      if (sc >= 0.999){
        v = cn;                                   // your own room: no falloff
      } else {
        const dx=(i%MAP_W)+0.5-px2, dy=((i/MAP_W)|0)+0.5-py2;
        const d=Math.sqrt(dx*dx+dy*dy);
        let f = d<=VIEW_FADE_NEAR ? 1
              : d>=VIEW_FADE_FAR  ? 0
              : (VIEW_FADE_FAR-d)/(VIEW_FADE_FAR-VIEW_FADE_NEAR);
        v = sc*f*cn;
      }
    }
    G.maskTgt[i] = v;
  }
  /* Deliberately NOT blurred. There was a 3x3 pass here and it quietly broke
     the centre of vision: an average of the player's own fully-lit tile with
     the dark tiles around it measured 0.55 underfoot, so the character stood
     in a dimple in the middle of a lit room. Any blur of a field with hard
     zeros in it eats into the lit side of every edge. The mask canvas is
     drawn with bilinear upscaling from 76x76 to full screen, which already
     softens edges across about a tile, and it does it without leaking. */
}

/* Recompute the target visibility field for the region the player is in.
   `instant` skips the crossfade (floor start, retry). */
function scopeRoomLight(dt, instant){
  const p = G.player;
  const here = regionAt(p.x, p.y);
  if (here === G.visRegion && !instant) return false;

  // snapshot the current field so the change crossfades instead of popping
  G.visFrom.set(G.visArr);
  G.visRegion = here;
  G.visFadeT  = instant ? 1 : 0;
  G.visStep   = instant ? LIGHT_FADE_STEPS : 0;

  if (here < 0){
    // off the map (only possible in a degenerate state): everything dark,
    // walls included — there is nothing to borrow light from
    G.visTgt.fill(DARK_ROOM);
  } else {
    const hops = new Int32Array(G.regionCount).fill(-1);
    const q = [here];
    hops[here] = 0;
    for (let h=0; h<q.length; h++){
      const r = q[h];
      for (const nb of G.regionAdj[r]) if (hops[nb] < 0){ hops[nb] = hops[r]+1; q.push(nb); }
    }
    for (let i=0; i<G.regionOf.length; i++){
      const r = G.regionOf[i];
      G.visTgt[i] = r < 0 ? -1 : scopeFor(hops[r] < 0 ? 99 : hops[r]);
    }
    /* Solid rock has no region, so scoping by region alone would multiply
       every partition down to DARK_ROOM — including the wall you are standing
       against, whose face and top would read as a black hole punched through
       a lit room. The bake already lights walls from adjacent floor; scope
       them the same way, brightest neighbour wins. A wall deep inside a block
       with no lit neighbour stays dark, which is correct. */
    const src = G.visScratch;
    src.set(G.visTgt);
    for (let y=0; y<MAP_H; y++) for (let x=0; x<MAP_W; x++){
      const i = y*MAP_W+x;
      if (src[i] >= 0) continue;
      let m = DARK_ROOM;
      if (x+1<MAP_W   && src[i+1]   >= 0) m = Math.max(m, src[i+1]);
      if (x>0        && src[i-1]   >= 0) m = Math.max(m, src[i-1]);
      if (y+1<MAP_H  && src[i+MAP_W]>= 0) m = Math.max(m, src[i+MAP_W]);
      if (y>0        && src[i-MAP_W]>= 0) m = Math.max(m, src[i-MAP_W]);
      G.visTgt[i] = m;
    }
  }
  if (instant){
    G.visArr.set(G.visTgt);
    snapMask();
  }
  return true;
}

/* The bake is packed ONCE, at floor build. The viewer mask is repacked per
   pose change; see traceViewCone. */

/* Advance the crossfade. Quantised: LIGHT_FADE_STEPS repacks over LIGHT_FADE
   seconds, so a room change costs 10 repacks and not one per frame forever. */
function fadeRoomLight(dt){
  if (G.visStep >= LIGHT_FADE_STEPS) return;
  G.visFadeT = Math.min(1, G.visFadeT + dt/LIGHT_FADE);
  const step = Math.max(G.visStep, Math.ceil(G.visFadeT*LIGHT_FADE_STEPS));
  if (step !== G.visStep){
    G.visStep = step;
    const k = step/LIGHT_FADE_STEPS;
    for (let i=0; i<G.visArr.length; i++) G.visArr[i] = G.visFrom[i] + (G.visTgt[i]-G.visFrom[i])*k;
    /* The mask bakes in the room scope, so it has to be recombined — but only
       on fade steps, not every frame. The easing in smoothMask then tracks it. */
    G.scopeDirty = true;
  }
}

/* Mask -> image. 5776 writes on a turn, nothing at all while standing still.
   Pure luminance: this is a visibility gate, not a colour. */
function packMask(){
  if (!wantPixels) return;
  const d = G.maskImg.data;
  for (let i=0; i<MAP_W*MAP_H; i++){
    const b = Math.min(255, G.maskArr[i]*255);
    const k = i*4;
    d[k]=b; d[k+1]=b; d[k+2]=b; d[k+3]=255;
  }
  G.maskCtx.putImageData(G.maskImg, 0, 0);
}

/* Ease the drawn mask toward the freshly traced one.
   The mask is per TILE, so even retraced every frame it is still quantised:
   as you walk, tiles enter and leave the fan one at a time and the boundary of
   vision would chatter. Exponentially approaching the target turns that chatter
   into motion — the edge slides rather than flickers.

   MASK_TAU is deliberately much shorter than LIGHT_FADE. The room crossfade
   is a deliberate 0.3s and is animated in G.visArr; this is only here to take
   the stair-stepping out of a per-frame quantity, so at 55ms it tracks the
   scope closely instead of lagging behind it by a visible amount.

   Returns whether the mask moved enough to be worth re-uploading. */
function smoothMask(dt){
  const k = 1 - Math.exp(-dt/MASK_TAU);
  let moved = false;
  for (let i=0; i<G.maskArr.length; i++){
    const d = G.maskTgt[i]-G.maskArr[i];
    if (d > 0.0025 || d < -0.0025){ G.maskArr[i] += d*k; moved = true; }
    else if (d !== 0){ G.maskArr[i] = G.maskTgt[i]; moved = true; }
  }
  return moved;
}

/* Skip the easing entirely — floor start, retry, and every test assertion.
   Anything that reads the mask needs the settled value, not a value 55ms
   behind. */
function snapMask(){
  traceViewCone(true);
  G.maskArr.set(G.maskTgt);
  packMask();
}

/* NOTE: x/y here may be FRACTIONAL world coords (collision), so they MUST be
   floored before indexing the tile array. Without this, G.grid[y*MAP_W+x]
   is a fractional index -> undefined -> undefined===WALL is false -> walls
   become permeable at their edges. */
const solid = (x,y)=>{
  x = Math.floor(x); y = Math.floor(y);
  return !(x>=0 && y>=0 && x<MAP_W && y<MAP_H) || G.grid[y*MAP_W+x]===WALL;
};

/* Circle vs tile-AABB.
   A 8-point sample ring is close enough to a box that diagonal wall corners
   snag you even when a clear circular path exists — movement feels sticky.
   This is the exact test, and it lets you slide around corners smoothly. */
function blocked(x,y,r){
  const tx0=Math.floor(x-r), tx1=Math.floor(x+r);
  const ty0=Math.floor(y-r), ty1=Math.floor(y+r);
  for (let ty=ty0; ty<=ty1; ty++){
    for (let tx=tx0; tx<=tx1; tx++){
      if (!solid(tx,ty)) continue;
      const px = x < tx   ? tx : (x > tx+1 ? tx+1 : x);
      const py = y < ty   ? ty : (y > ty+1 ? ty+1 : y);
      const dx = x-px, dy = y-py;
      if (dx*dx + dy*dy < r*r) return true;
    }
  }
  return false;
}

/* Safety net: if an entity's circle is overlapping geometry, every direction
   is blocked and it is wedged for good. Slide it to the nearest free spot.
   Reached by axis-separated sliding into a wall edge, so it is rare — but a
   soft-lock you cannot walk out of is unacceptable. */
/* Slide out of geometry. `force` skips the "already legal" early-out and is
   used when an entity is legal but immobile (both axes blocked at once), which
   an overlap test alone cannot detect. Local only — never teleports. */
function unstick(e, r){
  // Test with the entity's OWN radius. A hardcoded 0.34 here made a player
  // resting flush against a wall (gap 0.335, comfortably clear at R=0.33)
  // read as overlapping, so every wall contact nudged it ~0.08 tiles sideways.
  if (!blocked(e.x, e.y, r)) return false;
  let bx=null, by=null, bd=Infinity;
  for (let a=0; a<24; a++){
    const ang = a/24*Math.PI*2;
    const cx = Math.cos(ang), cy = Math.sin(ang);
    for (let d=0.08; d<=0.9; d+=0.08){
      const nx = e.x+cx*d, ny = e.y+cy*d;
      if (!blocked(nx, ny, r)){ if (d<bd){ bd=d; bx=nx; by=ny; } break; }
    }
  }
  if (bx!==null){ e.x=bx; e.y=by; return true; }
  return false;
}

/* Escape a genuine pocket: both requested axes are blocked, so the entity is
   legal but immobile. Walks a short ring biased toward the direction actually
   being asked for, and never moves more than 0.45 tiles — this is a nudge out
   of a wedge, not a teleport. */
function depenetrate(e, r, dx, dy){
  const want = Math.atan2(dy, dx);
  let bx=null, by=null, bd=Infinity;
  for (let a=-3; a<=3; a++){
    const ang = want + a*(Math.PI/12);          // try straight on first, then fan out
    const cx = Math.cos(ang), cy = Math.sin(ang);
    for (let d=0.08; d<=0.45; d+=0.08){
      const nx = e.x+cx*d, ny = e.y+cy*d;
      if (!blocked(nx, ny, r)){ if (d<bd){ bd=d; bx=nx; by=ny; } break; }
    }
  }
  if (bx!==null){ e.x=bx; e.y=by; return true; }
  return false;
}

/* Move: try the full step, then slide on each axis, then depenetrate.
   No perpendicular "corner assist". That used to nudge sideways whenever an
   axis was blocked, and it tried the perpendicular in a FIXED order (+1 before
   -1) — so holding up against a wall always picked +x and walked you right
   until you left the screen. If your circle overlaps a wall corner then
   stopping is the correct answer; you round the corner by also pressing the
   other direction, which the axis-only fallback already handles. */
function moveEnt(e, dx, dy, r){
  if (dx===0 && dy===0) return [0,0];

  // full step (diagonal input moves on both axes)
  if (!blocked(e.x+dx, e.y+dy, r)){ e.x+=dx; e.y+=dy; return [dx,dy]; }
  // slide along the wall
  if (dx!==0 && !blocked(e.x+dx, e.y, r)){ e.x+=dx; return [dx,0]; }
  if (dy!==0 && !blocked(e.x, e.y+dy, r)){ e.y+=dy; return [0,dy]; }
  /* Only a DIAGONAL press into a concave corner counts as wedged. Being
     unable to move while pressing straight into a wall is the normal resting
     state, not a trap — depenetrating there just nudged the avatar sideways
     every frame, which read as drift. */
  if (dx!==0 && dy!==0) depenetrate(e, r, dx, dy);
  return [0,0];
}

/* ============================================================
   NOISE — the whole stealth layer.

   Power is a LEVEL, not a per-frame increment:
     walk 0.22 -> ~6.6 tiles   sprint 1.0 -> ~16
     bump 0.55 -> ~10.6       door cycling 1.8 -> ~26
   Previously movement passed power*dt*4, which made every frame's contribution
   ~0.06 and therefore made sprinting only marginally louder than walking —
   the entire risk decision was flattened. Walls muffle by 2.6 tiles each. */
const hearRadius = power => 4 + power*12;

/* Walls between a noise and a listener cost 3 tiles of hearing each. Sampled as
   a staircase along the straight line between them, which is a cheap
   approximation of a path. The sampler stops BEFORE the destination, so a source
   standing in a doorway is heard through it rather than muffled by it — which is
   the right answer for a pipe broken in a wall and the reason the leak emits
   from the floor beside it. */
function wallSteps(ax, ay, x, y){
  let steps = 0, guard=0;
  const sx=Math.floor(ax), sy=Math.floor(ay);
  const ex=Math.floor(x), ey=Math.floor(y);
  while (guard++<200){
    const px=sx+Math.sign(ex-sx)*steps, py=sy+Math.sign(ey-sy)*steps;
    if (px===ex&&py===ey) break;
    if (solid(px,py)) steps++;
    if (steps>6) break;
  }
  return steps;
}

function alertAgents(baseR, power, x, y){
  for (const a of G.agents){
    if (a.state==='WALK' && a.born>0) continue;
    const d = Math.hypot(a.x-x, a.y-y);
    if (d > baseR) continue;
    // walls muffle
    const eff = baseR - wallSteps(a.x, a.y, x, y)*3.0;
    if (d > eff) continue;
    alert(a, x, y, power);
  }
}

/* One-shot noise (cycling a door, hitting a wall):
   updates the meter, the stats, and alerts.

   `mine` says the noise came from something the player did. It changes nothing
   about what the Lifeform hears — that is identical either way, because the
   rules of the game are about power and distance, not about blame. What it
   changes is the READOUT: G.selfNoise is the player's own contribution and
   G.noise is the loudest thing in earshot, so standing still beside a burst pipe
   shows a bar full of somebody else's noise and none of your own. */
function emitNoise(power, x, y, mine){
  G.noise = Math.max(G.noise, power);
  G.noisePeak = Math.max(G.noisePeak, power);
  if (mine) G.selfNoise = Math.max(G.selfNoise, power);
  G.stat.noises++;
  runStat.noises++;
  alertAgents(hearRadius(power), power, x, y);
}

/* Continuous noise (footsteps): alerts at full strength every frame, but does
   not inflate the stats or fight the meter decay. */
function sustainedNoise(power, x, y, mine){
  G.noise = Math.max(G.noise, power);
  G.noisePeak = Math.max(G.noisePeak, power);
  if (mine) G.selfNoise = Math.max(G.selfNoise, power);
  alertAgents(hearRadius(power), power, x, y);
}

/* Loud = sprinting, hitting a wall, cycling a door.
   Quiet = walking.
   Quiet noise only makes it CURIOUS. Only loud noise — or being seen —
   commits it to a full hunt. That is what makes walking survivable and
   sprinting a real decision, and it means you can walk right past a sleeping
   coil pile, while sprinting near one makes it stand up. */
const LOUD = 0.5;

/* NOISE_FS is what a full HUD bar means: the loudest sustained thing you can do
   on a floor, which is the WRENCH. It is the number that makes the meter read,
   and it is deliberately NOT BATT_MAX — the bar used to divide the noise level
   by the battery maximum, so a sprint drew 1% of it and the door 1.8%, while
   the `hot` class still fired and turned the bar red at a level it could not
   show. A meter whose scale is borrowed from a different quantity is not a
   meter.

   Against it: walk 0.22 -> 26%, wading 0.30 -> 35%, sprint 0.72 -> 85%, the
   standing hiss of four open pipes -> 14-56%, the wrench -> 100%, LOUD at 59%.
   The door clamps, which is correct: past full scale is past the end of the
   instrument, and the audio bed keeps reporting the unclamped level. */
const NOISE_FS = REPAIR_NOISE;

/* The two powers that live outside the normal range, named so the meter, the mix
   and the AI all read the same number: the door is the loudest thing in the
   building and the bar clamps on it, and being brushed is loud enough to be
   heard across the floor. */
const DOOR_NOISE = 1.8;
const BRUSH_NOISE = 1.2;

/* Contact. Dying to something you never saw, in a corridor, because it
   happened to be idling there is a gotcha rather than tension. Brushing a
   LOITERING entity does not kill: it startles, commits to a hunt, and makes a
   great deal of noise. You get the chase, not the cheap death. Only contact
   with something already hunting is fatal. */
function brush(a, p){
  if (a.state==='HUNT'){ caught(); return; }
  a.state='HUNT'; a.target={x:p.x, y:p.y}; a.t=0;
  a.rise=Math.max(a.rise, 0.85);
  emitNoise(BRUSH_NOISE, p.x, p.y);
  flash('IT TOUCHED YOU');
  Audio_.rattle(1);
}

function alert(a, x, y, power){
  const loud = (power||0) >= LOUD;

  if (a.state==='DORMANT'){
    if (!loud) return;               // walking past a sleeping coil is safe
    a.state='RISING'; a.rise=0; a.target={x,y};
    a.stepT = 0;
    Audio_.rattle(a.born>0 ? 1 : 0.55);
    return;
  }
  if (a.born>0) return;              // the hunter's opening grace period

  if (loud || a.state==='HUNT'){ a.state='HUNT'; a.target={x,y}; a.t=0; }
  else if (a.state==='WALK'){ a.state='SEARCH'; a.t=4.5; a.target={x,y}; }
}

/* ============================================================
   UPDATE
   ============================================================ */
const keys = {};

/* ENTER is the confirm key for whichever modal is up: start, resume, rewind,
   run again. It also fires when a button already has focus, so guard against
   the click landing twice. */
const MODAL_ACTION = {
  splash: ()=>advanceSplash(),
  order:  ()=>advanceSplash(),
  /* The pause ticket has no resume button — ESC is the resume, and the things
     under it are the ticket's own pages and controls. Pointing ENTER at a
     button that is not on the screen is how a modal ends up with a dead
     confirm key. */
  pause:  ()=>togglePause(),
  clear:  ()=>dismissClear(),
  dead:   ()=>document.getElementById('btn-retry').click(),
  win:    ()=>document.getElementById('btn-again').click(),
};

window.addEventListener('keydown', e=>{
  const k = e.key.toLowerCase();
  keys[k] = true;

  /* Every key is a user gesture, and the AudioContext cannot start without
     one. This is the single place the game hears about input, so it is the one
     place the unlock has to live. */
  Audio_.unlock();

  /* M, anywhere, at any time. Not just during play: a player who wants the
     sound off usually wants it off BEFORE the title screen finishes its four
     second fade-in, and a hotkey that only works once you are in a level is a
     hotkey that arrives too late to be useful.

     It RETURNS rather than falling through, which is load-bearing. On the
     splash chain any unmodified key advances, so without this the mute key
     doubles as "skip intro" — the title vanishes under the finger of someone
     who is trying to turn the music off. It also drops the key state for the
     same reason ENTER does: a held M would otherwise still be down when the run
     starts, and M is not a movement key but the discipline is the same. */
  if (k==='m'){
    if (!e.repeat) toggleMute();
    delete keys[k];
    e.preventDefault();
    return;
  }

  /* ESC on the work order dismisses the terms chooser before it walks the
     splash chain. The chooser is the top layer of the order screen, and a
     player who folded it open to change the terms should not fall out of the
     ticket and onto the riser for one mistimed press. This has to run BEFORE
     backSplash, or the chain claims the key first. */
  if (e.key==='Escape' && STATE==='order' && termsOpen){
    setTermsOpen(false);
    delete keys[k];
    return;
  }

  /* ESC walks the splash chain backwards: from the work order to the pipe.
     It does nothing on splash 03, which is the first frame — there is nothing
     behind it, and a key that silently does nothing is worse than no key. */
  if (e.key==='Escape'){
    if (backSplash()){ delete keys[k]; return; }
  }

  /* ESC steps the pause ticket's pages backwards before it leaves the ticket:
     the briefing page returns to the settings page, and only the settings
     page resumes. Same shape as backSplash, applied to the pages instead of
     the screens, so a player who opened the briefing to re-read a control
     cannot lose the run to one mistimed press. */
  if (e.key==='Escape' && STATE==='pause' && pausePage!=='settings'){
    setPausePage('settings');
    delete keys[k];
    return;
  }

  if (k==='enter'){
    const act = STATE==='splash' ? MODAL_ACTION.splash
              : STATE==='order'  ? MODAL_ACTION.order
              : STATE==='clear'  ? MODAL_ACTION.clear
              : STATE==='pause'  ? MODAL_ACTION.pause
              : STATE==='dead'   ? MODAL_ACTION.dead
              : STATE==='win'    ? MODAL_ACTION.win
              : null;
    /* Auto-repeat is blocked, same as below: holding ENTER down would blow
       through the splash and start a second run behind the first. */
    if (act && !e.repeat){
      const focused = document.activeElement;
      const onButton = focused && focused.tagName === 'BUTTON';
      /* ENTER folds the terms chooser shut rather than clocking in. The pick
         is already made — every term button commits on click — so starting
         the run from the key that dismissed the chooser is how a player clocks
         in on terms they were still reading. preventDefault keeps the browser
         from also activating the focused term button. */
      if (STATE==='order' && termsOpen){
        setTermsOpen(false);
        delete keys[k];
        e.preventDefault();
        return;
      }
      /* The ticket carries real controls now. A focused tab or button answers
         ENTER itself: the key falls through to the browser and activates the
         control, instead of resuming the run over the top of the click. */
      if (STATE==='pause' && onButton
          && focused.closest && focused.closest('#screen-pause')) return;
      act();                                  // close the modal
      if (onButton) focused.blur();           // no second activation via Enter
      /* The key that dismissed the splash must not carry into the run: the
         same keydown set keys[k] above, and a held W would otherwise walk the
         player out of the door they just came through. */
      delete keys[k];
    }
    e.preventDefault();
    return;
  }

  /* On the splash chain, any unmodified key advances. Sprint and the arrow
     keys are movement, so holding one through the splash should move the
     player the instant the run starts — advance once per press, not per
     repeat, and drop the key state with it. Escape is excluded: it walks
     backwards, and on splash 03 it means "stay here".

     One exception, and it is the work order while the terms chooser is open:
     the frame is a form at that moment, and a form that starts a run on a
     stray keystroke is a form nobody fills in. */
  if ((STATE==='splash'||STATE==='order') && e.key!=='Escape'
      && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat
      && !(STATE==='order' && termsOpen)){
    advanceSplash();
    delete keys[k];
    if (STATE==='play') e.preventDefault();
    return;
  }

  /* A key the open chooser swallowed is dropped, not held: it did nothing on
     this screen, and a key that did nothing must not walk the player out of
     the door the moment the run starts. The splash chain already drops the
     key that advances it; this is the same discipline for the one branch that
     does not advance. */
  if (STATE==='order' && termsOpen) delete keys[k];

  /* The chooser owns the number row and the left/right arrows while it is
     open: 1-3 are the three terms in DIFFICULTIES order, and the arrows cycle
     the same way the segmented row does with a mouse. */
  if (STATE==='order' && termsOpen){
    const list = Object.keys(DIFFICULTIES);
    const at = Math.max(0, list.indexOf(String(SETTINGS.difficulty)));
    if (['1','2','3'].includes(k) && +k <= list.length){
      setOption('difficulty', list[+k-1]);
      e.preventDefault();
      return;
    }
    if (e.key==='ArrowLeft' || e.key==='ArrowRight'){
      const step = e.key==='ArrowRight' ? 1 : -1;
      setOption('difficulty', list[(at + step + list.length) % list.length]);
      e.preventDefault();
      return;
    }
  }

  if (k==='r' && G && STATE==='play'){
    if (G.radar) G.radar = false;
    else if (G.batt<=0) flash('NO POWER — THE RADAR IS DEAD');
    else { G.radar = true; Audio_.rattle(0.4); }
  }
  if (e.key==='Escape' && (STATE==='play'||STATE==='pause')) togglePause();
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)){
    /* One exception: the ticket's own controls. Arrows drag the focused slider
       and SPACE activates a focused button, so those keys belong to the pause
       screen while the pause screen has focus. Everywhere else they are
       movement, and a held arrow through the splash must not scroll anything. */
    if (STATE==='pause'){
      const el = document.activeElement;
      if (el && el.closest && el.closest('#screen-pause')
          && (el.tagName==='INPUT' || el.tagName==='BUTTON')) return;
    }
    e.preventDefault();
  }
});
window.addEventListener('keyup', e=>{
  const k=e.key.toLowerCase();
  keys[k] = false;
});

/* --- THE CLOCK ---
   Runs before everything, and it is the only thing on this level that cannot
   be argued with. It does not stop while you wrench, it does not stop while
   something is standing over you, and it does not reset because you sealed a
   pipe. Three minutes to find the work, do the work, and walk all the way back
   to the door you came in through — and every second of it is spent on the
   return trip, which is why the return trip is the part the level is about.

   The last thirty seconds are announced once, loudly, because a clock that is
   only ever visible in a corner of the HUD is a clock most players will watch
   the ceiling instead.

   Returns false when the clock has run out: the level is over and the caller
   must stop the frame there, exactly as it did when this code sat inline. */
function tickClock(dt){
  G.time += dt;
  G.noise = Math.max(0, G.noise - dt*1.55);
  /* The player's own share decays on exactly the same curve as the total, so the
     yellow part of the bar empties at the rate the building's hiss appears
     under it rather than at a rate of its own invention. */
  G.selfNoise = Math.max(0, G.selfNoise - dt*1.55);

  G.clock = Math.max(0, G.clock - dt);
  if (G.clock <= 0){ outOfTime(); return false; }
  if (G.clock <= 30 && !G.clockAnnounced){
    G.clockAnnounced = true;
    flash('THIRTY SECONDS \u2014 THE WATER IS AT YOUR FEET');
    Audio_.sting();
  }
  return true;
}

/* --- battery --- */
function tickBattery(dt){
  const p = G.player;
  if (G.radar){
    G.batt -= RADAR_DRAIN*dt;
    if (G.batt<=0){ G.batt=0; G.radar=false; flash('NO POWER — THE RADAR IS DEAD'); }
  }
  for (const b of G.batteries){
    if (b.taken) continue;
    if (Math.hypot(b.x-p.x,b.y-p.y)<0.85){ b.taken=true; G.batt=Math.min(BATT_MAX,G.batt+50); flash('+50 BATTERY'); }
  }
}

/* --- movement ---
   Returns the frame's movement facts for the stages that run after it:
   whether the player moved, bumped, is sprinting, and how wet the tile they
   ENDED the frame on is. */
function tickMovement(dt){
  const p = G.player;
  let ix=0, iy=0;
  if (keys['a']||keys['arrowleft'])  ix--;
  if (keys['d']||keys['arrowright']) ix++;
  if (keys['w']||keys['arrowup'])    iy--;
  if (keys['s']||keys['arrowdown'])  iy++;

  /* Wading is slower than dry walking. Sampled at the position BEFORE the move,
     not after: sampling after would use last frame's tile at the boundary,
     which reads as the speed changing a step after you leave the water rather
     than as you entering it. */
  const preWet = wetAt(p.x, p.y);

  const sprinting = keys['shift'] && (ix||iy);
  const wade = preWet > 0.25 ? 0.80 : 1;       // knee-deep costs you a fifth
  const spd = (sprinting ? SPRINT : WALK) * wade;
  let moving=false, bumped=false;

  unstick(p, R);

  if (ix||iy){
    const len=Math.hypot(ix,iy); ix/=len; iy/=len;
    const before=[p.x,p.y];
    const [dx,dy]=moveEnt(p, ix*spd*dt, iy*spd*dt, R);
    moving = (dx!==0 || dy!==0);
    p.face = Math.atan2(iy,ix);
    if (!moving && (ix!==0||iy!==0)) bumped=true;   // walked into a partition
  }

  /* Wet at the position the frame ENDS on. This is the sample G.wet carries and
     the one the stages after movement should read: the tile you are standing
     in now, not the tile you left. The wading speed above deliberately still
     uses preWet — the two answers are different questions. */
  const wet = wetAt(p.x, p.y);

  /* Wet walking is also louder than dry walking. It stays under LOUD on purpose
     — wet boots must not wake anything, or following the water would be
     strictly worse than sweeping, and the trail has to be the cheap option or
     nobody follows it at all. */
  if (moving){
    const inWater = preWet > 0.25;
    /* One power, three consumers: the meter, what the agents hear, and how
       loud the footstep is. Passing it to the voice as well is what makes a
       sprinting step sound like a sprinting step instead of a louder walk. */
    const stepPow = sprinting ? SPRINT_NOISE : (inWater ? 0.30 : 0.22);
    sustainedNoise(stepPow, p.x, p.y, true);
    p.stepT -= dt;
    if (p.stepT<=0){
      p.stepT = sprinting ? 0.26 : 0.46;
      p.stepDur = p.stepT;
      if (inWater) Audio_.splash(sprinting?1:0.5, preWet, stepPow);
      else       Audio_.step(sprinting?1:0.5, stepPow);
    }
    p.moving = moving;
    /* Waking pushes a ripple ahead of you. It is a readable trace of where you
       have been, which is a second cue on top of the noise you already made. */
    if (preWet > 0.3){
      p.rippleT = (p.rippleT||0) - dt;
      if (p.rippleT <= 0){ p.rippleT = 0.22; seedSplash(p.x, p.y, preWet*0.55); }
    }
  }
  /* Walking into a partition is the player's doing, so it is the player's noise
     on the meter — the sharp little spike above whatever you were already
     making. */
  if (bumped && sprinting) emitNoise(0.55, p.x, p.y, true);
  else if (bumped) sustainedNoise(0.3, p.x, p.y, true);

  return { moving, bumped, sprinting, wet };
}

/* --- the pipes ---
   Every open one is a continuous emitter at the pipe, not a repeating one-shot.
   sustainedNoise rather than emitNoise: a burst every few frames would inflate
   the noise stats and fight the meter decay, and what this needs to be is a
   standing sound the Lifeform can walk toward, not a series of events. */
function tickLeakNoise(dt){
  const p = G.player;
  /* The building's total standing noise: what the open pipes are making right
     now, everywhere, summed. The HUD draws it as the water-blue floor under the
     bar and the leak bed plays it, so the number the Lifeform hears is the
     number the player can see. */
  G.leakTotal = 0;
  G.leakDist  = 99;
  if (G.leaksOpen > 0){
    /* Power rises with how much of the level is under water, so the leak gets
       louder as the floor drowns — but it is clamped below LOUD no matter how
       bad it gets. Above LOUD this stops being a lure and becomes a level-wide
       hunt trigger, and the repair would have nothing left to be tense
       against.

       FOUR OPEN PIPES MUST NOT BE FOUR LOUD PIPES. The share each one gets is
       divided by how many are open, so the building's total background hiss
       still tops out under LOUD: it stays a lure you can hide behind rather than
       a hunt trigger you cannot switch off, and it keeps the wrench the single
       loudest thing you can do — which is the deal the whole stealth layer rests
       on. Above LOUD you would be sealing pipes with a floor-wide hunt running,
       which is a different game and a worse one.

       G.floodCover is the incremental sum maintained by tickFlood, NOT a fresh
       pass over the tile array. Recomputing it here instead — which the first
       version did — re-adds a 5776-element loop to every frame of every level
       for a number that was already sitting on G, and it is the difference
       between the suite finishing in seventy seconds and not finishing. */
    const each = Math.min(LEAK_NOISE_BASE + LEAK_NOISE_GAIN*G.floodCover,
                          (LOUD-0.02)/G.leaksOpen);
    G.leakPower = each;
    G.leakTotal = each * G.leaksOpen;
    for (const L of G.leaks){
      if (L.fixed) continue;
      /* FROM THE STAND TILE, not from the wall the pipe is broken in. L.x/L.y
         is the masonry and L.sx/L.sy is the floor you stand on to wrench it, and
         the noise used to be emitted from the masonry: the distance was measured
         to a wall, and — the part that actually mattered — alert() hands that
         coordinate straight to the entity as its target, so a Lifeform curious
         about a pipe was told to walk to the inside of a wall and stood there
         bumping its own collision disc against brick. LEAK_LURE and leakAt both
         read sx,sy: the pipe has exactly one address, and it is the floor. */
      sustainedNoise(each, L.sx+0.5, L.sy+0.5);
    }

    /* Dripping, audible near the pipes. This is the find-confirmation cue and
       it is deliberately a SOUND and not a marker: the water is the visual
       cue and the drip is the audio one, so a player who has been squinting
       at wet carpet for two minutes gets a second channel at the moment the
       visual channel has already done its job. Rate scales with closeness so
       "it is over there somewhere" and "it is here" are distinguishable
       without looking up. Only the NEAREST open pipe drips — four of them
       chattering at once is a wall of sound with no position in it. */
    let ld = Infinity, near = null;
    for (const L of G.leaks){
      if (L.fixed) continue;
      const d = Math.hypot(p.x-(L.x+0.5), p.y-(L.y+0.5));
      if (d < ld){ ld = d; near = L; }
    }
    if (near && ld < 14){
      G.leakDist = Math.min(G.leakDist, ld);
      p.dripT = (p.dripT||0) - dt;
      if (p.dripT <= 0){
        /* The floor on the interval is 0.28s. It used to reach 0.10 at the pipe
           itself — ten drips a second, a machine gun with no pitch and no room
           in it, which is the opposite of the positional cue it exists to be.
           Loud and slow reads as "a pipe"; fast and loud reads as a texture. */
        p.dripT = Math.max(0.28, 0.28 + Math.min(1, ld/14)*1.5);
        Audio_.drip(1 - Math.min(1, ld/14));
      }
    }
  } else {
    G.leakPower = 0;
  }
}

/* --- the repair ---
   Hold still next to the pipe for five seconds. Moving decays the bar rather
   than freezing it, so a panic step costs real progress instead of just
   costing you the second — the failure has to cost something or the five
   seconds are free and the whole mechanic is a formality.

   The wrench is LOUD, which is the deal. You are choosing to stand immobile
   and announce yourself, next to the noisiest thing on the floor, with
   something already on its way. */
function tickRepair(dt, moving, bumped){
  const p = G.player;
  const L = leakAt(p.x, p.y);
  G.atLeak = !!L;
  if (L){
    if (!moving && !bumped){
      if (L.repair === 0) Audio_.wrench(REPAIR_NOISE);
      L.repair = Math.min(REPAIR_TIME, L.repair + dt);
      sustainedNoise(REPAIR_NOISE, L.sx+0.5, L.sy+0.5, true);
      if (L.repair >= REPAIR_TIME){
        sealLeak(L);
      }
    } else {
      /* Decays at REPAIR_DECAY whole bars per second: leaving after four
         seconds throws away the lot, because 2.6/s means you are gone in under
         half a second. That is deliberate. Hesitating at the pipe is not a
         strategy, it is a mistake you have to pay for. */
      L.repair = Math.max(0, L.repair - dt*REPAIR_DECAY*REPAIR_TIME);
      if (L.repair > 0 && L.repair <= 0.001) L.repair = 0;
    }
    if (L.repair > 0) p.stepT = Math.min(p.stepT, dt);
  } else {
    /* Off the pipe entirely: every bar still on any pipe starts bleeding. */
    for (const o of G.leaks){
      if (o.fixed || o.repair <= 0) continue;
      o.repair = Math.max(0, o.repair - dt*REPAIR_DECAY*REPAIR_TIME);
    }
  }
}

/* --- the radar reveals ---
   The agent loop plus the sight check that feeds G.seenBy and G.nearest:
   what can see you, how close the nearest pipe of it is, and whether
   anything is allowed to start hunting this frame. */
function tickAgents(dt){
  const p = G.player;
  let seenBy = 0, nearest = 99;
  for (const a of G.agents){
    updateAgent(a, dt, p);
    const d = Math.hypot(a.x-p.x, a.y-p.y);
    if (a.state!=='DORMANT' && a.rise>0.5) nearest = Math.min(nearest, d);
    // line of sight check
    if (a.rise>0.5 && d < 8){
      const vx=Math.cos(a.face), vy=Math.sin(a.face);
      const dot = ((p.x-a.x)*vx + (p.y-a.y)*vy) / (d||1);
      if (dot > 0.28 && G.los(a.x,a.y,p.x,p.y)){
        /* What it can see you by is the BAKE times the VISIBILITY, not the
           bake alone. Reading the bake would let it see you standing in a
           room whose lights are, as far as the screen is concerned, off. */
        const pi = Math.floor(p.y)*MAP_W+Math.floor(p.x);
        const amb = (G.lightArr[pi] || 0) * (G.visArr[pi] || 0);
        if (amb > 0.30){
          seenBy = Math.max(seenBy, 1);
          if (a.born<=0){ a.state='HUNT'; a.target={x:p.x,y:p.y}; a.t=0; }
        }
      }
    }
  }
  G.seenBy = Math.max(0, G.seenBy + (seenBy?dt*6:-dt*2.5));
  G.nearest = nearest;
}

/* --- the radar reveals ---
   Sweeping lights the whole level, so "can you see it" stops being a question
   about angles and walls and becomes exactly what it says: is it on your
   screen. That is checked against the same rectangle the renderer draws
   into, so a thing is revealed on the frame it appears, not a frame before.

   There is nothing in the world that NEEDS finding any more — the door is
   where you came in and you know it — so the radar is down to what it was
   always honestly good for: reading the carpet. The scrawls are the only
   thing it surfaces, and they are worth a battery because they are free
   information about a building that lies to you. */
function tickRadarReveal(){
  if (!G.radar) return;
  for (const gr of G.graffiti){
    if (gr.seen) continue;
    if (!onScreen(gr.x+0.5, gr.y+0.5)) continue;
    gr.seen=true; flash(gr.text);
  }
}

/* --- the door ---
   Hold at it for 1.5s and it cycles open. Step away and the progress drains
   fast, so committing to the door is a real decision — and with a clock
   running it is the last decision of the level.

   Returns false when the door cycled: nextFloor() has already rebuilt the
   floor and the frame must stop there, as it did when this code sat inline. */
function tickDoor(dt){
  const p = G.player;
  const leakDone = G.leaksOpen === 0;
  let onExit=false;
  if (leakDone){
    for (const e of G.exitTiles){
      // 1.25 tiles: a door in a 1-wide alcove is still reachable with the
      // player's 0.33 collision radius, without demanding pixel precision.
      if (Math.hypot(e.x+0.5-p.x, e.y+0.5-p.y) < 1.25){ onExit=true; break; }
    }
    if (onExit){
      if (G.descend===0) Audio_.door(DOOR_NOISE);
      G.descend += dt;
      sustainedNoise(DOOR_NOISE, p.x, p.y, true);
      if (G.descend>=DOOR_HOLD){ nextFloor(); return false; }
    } else {
      G.descend = Math.max(0, G.descend - dt*2.5);
    }
  } else if (G.descend > 0){
    /* Backing off: if the door was open and a pipe is still open, the cycle
       drains rather than holding. You cannot sit in a doorway with the
       progress bar frozen waiting for something that has not happened. */
    G.descend = Math.max(0, G.descend - dt*2.5);
  }

  /* THE LEAF.
     `e.open` was set to 0 when the door was placed and never written again, so
     every door on every floor rendered permanently shut: the renderer read a
     value that could not change, and the entire open/shut difference was
     stroke alpha on the word DOOR. This is the field it was always waiting
     for — the swing itself, derived from the same two facts the HUD reads.

     It runs even when the frame is about to end (nextFloor above returns
     before this, and that is correct: the floor is being torn down, not
     rendered one more time). Eased rather than assigned, because a leaf that
     teleports between three positions is an animation, and this is a door. */
  const swing = leakDone
    ? (onExit ? DOOR_AJAR + (1-DOOR_AJAR)*(G.descend/DOOR_HOLD) : DOOR_AJAR)
    : 0;
  for (const e of G.exitTiles)
    e.open += (swing - e.open) * Math.min(1, dt*DOOR_EASE);
  return true;
}

/* --- the mix --- */
function tickAudio(){
  const prox = Math.max(0, 1 - G.nearest/13);
  Audio_.drone(prox * (0.35 + G.seenBy*0.65));
  /* The two beds. The floor is the NOISE bar itself, so a filling bar is a
     filling room: this is the line that makes the meter true rather than
     decorative. The leak bed is the pipes' total, pulled down by how far the
     nearest one is — the standing hiss you can walk toward. */
  /* The bed follows the loudest thing in earshot — which is what the bar's
     NUMBER shows — while the bar's yellow fill is the player's own share. The
     mix and the meter are both readings of the same frame, neither of them a
     separate mood. */
  Audio_.noiseFloor(G.noise/NOISE_FS);
  Audio_.leakBed(G.leakTotal/NOISE_FS, G.leakDist);
}

function update(dt){
  /* ORDER IS THE DESIGN. The clock first because it can end the frame, then
     the battery, then movement — and everything after movement reads what the
     movement produced: the mask the room you walked into, the flood you are
     standing in, the repair bar that decays because you walked, the things
     that saw you move, and the door you are cycling. Each stage is a function
     with the comment it was written next to; this is only the sequence. */
  if (!tickClock(dt)) return;
  tickBattery(dt);
  const mv = tickMovement(dt);
  G.wet = mv.wet;                  // the tile the player is standing on now

  /* --- room-scoped light ---
     Runs AFTER movement, so the room you just walked into is the room that
     lights up this frame. Checked before, it would lag a frame behind and
     read as the fluorescents chasing you. */
  scopeRoomLight(dt, false);
  fadeRoomLight(dt);
  /* Retrace on any movement, then EASE toward it. Both halves matter: the
     retrace alone still steps a tile at a time, and the easing alone still
     quantises to when the retrace happens.

     Skipped wholesale when the harness has switched vision off. G.scopeDirty is
     deliberately left alone: it is pending work, not stale state, so the first
     frame after vision comes back on recombines whatever the room crossfade
     moved while it was off rather than dropping it. */
  if (wantVision){
    if (traceViewCone(false) || G.scopeDirty){ combineMask(); G.scopeDirty = false; }
    if (smoothMask(dt)) packMask();
  }

  /* --- the flood ---
     Runs after movement so the water you are standing in this frame is the
     water you walked into this frame. One pass over the tile array, and only
     over tiles that are within the reachable radius of the leak — the front
     cannot be further than LEAK_SPREAD seconds of travel from the source, so
     the outer ring is skipped entirely instead of being tested and rejected. */
  tickFlood(dt);
  if (waterDirty){ packWet(); waterDirty = false; }

  tickLeakNoise(dt);
  tickRepair(dt, mv.moving, mv.bumped);
  tickAgents(dt);
  tickRadarReveal();
  if (!tickDoor(dt)) return;
  tickAudio();
}


function updateAgent(a, dt, p){
  a.born = Math.max(0, a.born-dt);
  unstick(a, RA);

  if (a.state==='DORMANT'){ a.rise += (0-a.rise)*Math.min(1,dt*3); return; }

  if (a.state==='RISING'){
    a.rise = Math.min(1, a.rise + dt/1.4);
    a.wakeCd = Math.max(0, a.wakeCd-dt);
    if (a.rise>=1){ a.state='HUNT'; a.t=0; }
    return;
  }

  if (a.state==='WALK'){
    a.rise = Math.min(1, a.rise + dt/1.0);
    if (!a.target || Math.hypot(a.x-a.target.x, a.y-a.target.y)<0.5 || a.t<=0){
      a.target = randomFloorNear(a.x,a.y, 14);
      a.t = 2.6 + Math.random()*3;
    }
    a.t -= dt;
    const spd = 1.5 + G.floor*0.1;
    const ang = Math.atan2(a.target.y-a.y, a.target.x-a.x);
    a.face = ang;
    moveEnt(a, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, RA);
    return;
  }

  if (a.state==='HUNT'){
    a.rise = Math.min(1, a.rise + dt*2.4);
    a.t -= dt;
    const spd = HUNT_BASE + G.floor*HUNT_STEP;
    const tgt = a.target || {x:p.x,y:p.y};
    const ang = Math.atan2(tgt.y-a.y, tgt.x-a.x);
    a.face = ang;
    const [dx,dy] = moveEnt(a, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, RA);
    if (Math.hypot(dx,dy)<0.001){
      // blocked — sidestep along the wall
      moveEnt(a, Math.cos(ang+1.57)*spd*dt, Math.sin(ang+1.57)*spd*dt, RA);
    }
    if (Math.hypot(a.x-p.x,a.y-p.y) < CATCH_R) brush(a, p);
    if (a.t < -8){ a.state='SEARCH'; a.t=6; a.target=randomFloorNear(a.x,a.y,9); }
    return;
  }

  if (a.state==='SEARCH'){
    a.t -= dt;

    /* THE LURE. An open pipe is a standing noise source, and something already
       searching will go and stand next to it. This is what makes the leak a
       shield as well as a hazard: while one is open, anything curious in the
       building is being pulled to a pipe rather than to you, so the five seconds
       at the pipe are not spent with a hunter closing from wherever it
       happened to be — they are spent with one closing from a known place.

       With four of them the NEAREST open one takes it, which is the correct
       reading: a thing standing at a pipe you have not reached yet is a shield
       you have not got yet, and it should not walk across the building to a pipe
       four rooms away just to be somewhere else.

       It only applies to SEARCH, never to HUNT. If a hunting Lifeform were
       also diverted it would abandon a chase you caused by sprinting, which
       would delete the sprint decision the entire noise layer exists for. */
    for (const L of G.leaks){
      if (L.fixed) continue;
      const ld = Math.hypot(a.x-(L.sx+0.5), a.y-(L.sy+0.5));
      if (ld < LEAK_LURE && (!a.target || Math.hypot(a.x-a.target.x,a.y-a.target.y)<0.6)){
        a.target = {x:L.sx+0.5, y:L.sy+0.5};
        break;
      }
    }
    if (!a.target || Math.hypot(a.x-a.target.x,a.y-a.target.y)<0.5){
      a.target = randomFloorNear(a.x,a.y,7);
    }
    const ang = Math.atan2(a.target.y-a.y, a.target.x-a.x);
    a.face = ang;
    moveEnt(a, Math.cos(ang)*2.3*dt, Math.sin(ang)*2.3*dt, RA);
    if (Math.hypot(a.x-p.x,a.y-p.y) < CATCH_R) brush(a, p);
    if (a.t<=0){
      a.state = 'DORMANT'; a.rise=0.3; a.target=null;
      if (a.born<=0){ a.state='WALK'; }
    }
  }
}

function randomFloorNear(x,y,rad){
  for (let i=0;i<60;i++){
    const a=Math.random()*6.28, d=Math.random()*rad;
    const nx=x+Math.cos(a)*d, ny=y+Math.sin(a)*d;
    if (!blocked(nx,ny,0.4)) return {x:nx,y:ny};
  }
  return {x,y};
}

/* ============================================================
   THE SPLASH SCREENS
   Two frames before the run: 03 PIPE (title, rising water) then
   04 WORK ORDER 88-D (the ticket, which is also the controls list).
   One advance function drives both, so ENTER, any key, and a click
   all land in the same place and cannot disagree with each other.
   ============================================================ */

/* The bed follows STATE, not the individual screens. It is keyed off the names
   rather than off `show()` because `show()` is also how the pause screen comes
   up, and a title drone leaking into a pause menu is the sort of thing nobody
   reports and everybody notices.

   The floor-clear card is a menu like the other two: the room hum keeps
   running under it. What stops there is the FLOOR — acclaim() kills the leak
   and noise beds, which belong to the level that just ended. */
function syncAmbience(){
  Audio_.ambience(STATE==='splash' || STATE==='order' || STATE==='clear');
}

function advanceSplash(){
  Audio_.unlock();
  if (STATE==='splash'){
    STATE='order';
    /* The seed goes on the stub so each run's ticket reads as authored
       rather than generated. It is RUN_SEED — the same number that builds
       the floor when the player clocks in — so it is not decoration. */
    const seedEl = document.getElementById('order-seed');
    if (seedEl) seedEl.textContent = '#88D-' + (RUN_SEED>>>0).toString(16).toUpperCase().slice(-4);
    show('order');
  } else if (STATE==='order'){
    /* The chooser folds itself shut on the way in: the next time this ticket
       is seen — after a death, or a finished run — it should show the stamped
       terms, not last boot's open fold. */
    setTermsOpen(false);
    document.getElementById('btn-start').click();
  }
  syncAmbience();
}
function backSplash(){
  Audio_.unlock();
  if (STATE==='order'){ STATE='splash'; show('splash'); syncAmbience(); return true; }
  return false;                       // nothing behind splash 03: it is the first frame
}

/* ------------------------------------------------------------
   THE PLAN ON THE SPLASH
   The blueprint behind the title is the level the run is about to be built
   from — the same G the player is seconds away from standing in, drawn from
   the same RUN_SEED. It is faded to the point of being unreadable on purpose:
   a splash that handed over a legible map would be a tutorial, and a tutorial
   here would give away the only thing the player earns, which is finding the
   pipes by following water downhill.
   ------------------------------------------------------------ */
function paintSplashPlan(){
  const cv = document.getElementById('splash-plan');
  if (!cv || !G || !G.grid || !cv.getContext) return;
  const far = document.getElementById('splash-plan-far');
  const W = Math.max(320, Math.floor(cv.clientWidth  || VW || 1280));
  const H = Math.max(240, Math.floor(cv.clientHeight || VH || 720));
  /* One period of the painting has to be exactly the frame width, or the -50%
     roll leaves a visible seam. Scaling by width does that for free, and the
     plan is a cropped texture anyway — nobody sees the top and the bottom. */
  const cell = W / MAP_W;
  const pw = Math.ceil(W * 2), ph = Math.ceil(H);
  for (const c of [cv, far]){
    if (!c) continue;
    c.width = pw; c.height = ph;
  }
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, pw, ph);

  const px = (v)=> Math.floor(v*cell);
  for (let pass=0; pass<2; pass++){
    const ox = pass*W;
    /* The corridors are drawn and the walls are left empty, not the other way
       round. A 76-wide BSP level is mostly wall, so filling the walls paints
       large slabs and the splash turns into a checkerboard; lighting the walkable
       tiles instead gives the thin lattice that reads as a plan. */
    for (let y=0; y<MAP_W; y++) for (let x=0; x<MAP_W; x++){
      if (G.grid[y*MAP_W+x] === FLOOR){
        ctx.fillStyle = 'rgba(228,230,168,0.55)';
        ctx.fillRect(ox+px(x), px(y), Math.ceil(cell), Math.ceil(cell));
      }
    }
    /* the survey grid, one hairline every four tiles */
    ctx.strokeStyle = 'rgba(228,230,168,0.16)';
    ctx.lineWidth = 1;
    for (let x=0; x<=MAP_W; x+=4){
      ctx.beginPath(); ctx.moveTo(ox+px(x)+0.5, 0); ctx.lineTo(ox+px(x)+0.5, ph); ctx.stroke();
    }
    for (let y=0; y<=MAP_W; y+=4){
      ctx.beginPath(); ctx.moveTo(ox, px(y)+0.5); ctx.lineTo(ox+W, px(y)+0.5); ctx.stroke();
    }
    /* the marks that are the run: the door you came in by, and every pipe.
       Water-blue, because water is the only hue in this place and these two
       things are both water problems. */
    ctx.fillStyle = 'rgba(143,196,204,1)';
    const dz = Math.max(3, cell*0.34);
    for (const L of (G.leaks || [])){
      ctx.fillRect(ox+px(L.x+0.5)-dz/2, px(L.y+0.5)-dz/2, dz, dz);
    }
    const p = G.player;
    if (p){
      ctx.strokeStyle = 'rgba(143,196,204,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ox+px(p.x), px(p.y), Math.max(4, cell*1.1), 0, 6.284); ctx.stroke();
    }
  }
  /* the far layer is the same painting, not a second generation of it */
  if (far && far.getContext){
    const f = far.getContext('2d');
    if (f){ f.clearRect(0,0,pw,ph); f.drawImage(cv, 0, 0); }
  }
}

/* A new run gets a new plan, and the splash is repainted to match even though
   nobody is looking at it yet: the win screen's RUN IT AGAIN button leads back
   through here, and a title screen showing the level you just finished would be
   the sort of small mistake that makes a procedural game feel hand-authored in
   the wrong direction. */
function rollRunSeed(){
  RUN_SEED = (Math.random()*1e9)|0;
  buildFloor(0, RUN_SEED);
  paintSplashPlan();
}

/* ============================================================
   FLOW
   ============================================================ */
let STATE='splash';      // splash | order | clear | play | pause | dead | win
/* Every screen the shell can show, in one list, because show()/hideAll() all
   enumerate them and they used to drift apart the moment a screen was added.
   The settings had a screen in this list once; they are pages of the pause
   ticket now, so the ticket is the only menu and there is no second list.
   Every entry has a #screen-<name> div — 'play' is a STATE but not a screen,
   because the run is the canvas with the HUD on it and nothing to show(). */
const SCREENS = ['splash','order','clear','pause','dead','win'];
let RUN_SEED = (Math.random()*1e9)|0;
let lives = 3, floorIdx = 0, runTime = 0;
/* The life pips are drawn from this, not from a hardcoded three. The naive
   version maps over [0,1,2], so RELAXED would render five pips with the fifth
   always spent and HARD would render three for a one-life run. */
let runLives = 3;
/* The run's own totals. G.stat is thrown away and rebuilt by buildFloor, so
   everything it counted died with the floor it was counted on: the win card
   read the LAST level's numbers and called them the run's. runStat lives as
   long as the run does, is bumped beside every G.stat bump, and is cleared
   only where a run starts — the CLOCK IN button. */
let runStat = { noises:0, deaths:0, sealed:0 };
function livesHTML(){
  return Array.from({length:Math.max(1,runLives)},
    (_,i)=> `<span class="${i<lives?'':'gone'}">&#9679;</span>`).join('');
}
function renderLives(){
  const el = document.getElementById('val-lives');
  if (!el) return;
  el.innerHTML = livesHTML();
}

/* THE FLOOR CLEAR.
   Between one level and the next there is a card: the clock you finished with,
   and the shape of the floor you are about to walk into. It exists for two
   reasons and neither of them is vibes — a level transition that silently
   restarts a running clock is the single most unfair thing this game could do,
   and a player who does not know the next floor carries four pipes and four
   things is walking into it with the wrong amount of caution.

   THE FLOOR IS ALREADY BUILT when this comes up. nextFloor() does its usual
   floorIdx++ / buildFloor in the same frame the door cycles, and 'clear' only
   holds the PLAYER out of it. Nothing about the state depends on the card being
   dismissed, and the tests that watch floorIdx move on the descent frame keep
   working without knowing this screen exists. */
let clearCard = { floor:0, clock:0, leaks:0, forms:0 };
function showClear(){
  const el = id => document.getElementById(id);
  el('clear-clock').textContent = clockText(clearCard.clock);
  el('clear-floor').textContent  = clearCard.floor+1;
  el('clear-leaks').textContent  = clearCard.leaks;
  el('clear-forms').textContent  = clearCard.forms;
  /* The praise scales with the clock, and only with the clock. Nailing a floor
     on the last few seconds gets the warm line; scraping back in does not, and
     the game does not congratulate you for the version where you nearly died. */
  el('clear-sub').textContent =
    clearCard.clock >= FLOOR_CLOCK*0.34 ? 'GOOD WORK. MANAGEMENT NOTICES.'
                                      : 'SEALED. MANAGEMENT HAS NO COMMENT.';
  STATE='clear';
  document.getElementById('hud').classList.remove('on');
  show('clear');
  syncAmbience();
  Audio_.acclaim();
}
/* ENTER, and the button, and nothing else. There is no clock on this card and
   no way back into it — the floor behind it is sealed and the floor in front of
   it is already running. ESC deliberately does nothing here: backSplash() only
   walks the title chain, so the key falls through to the play/pause toggle,
   which is also inert while STATE is 'clear'. */
function dismissClear(){
  if (STATE!=='clear') return;
  STATE='play';
  hideAll();
  document.getElementById('hud').classList.add('on');
  /* Every key down to nothing. The player is almost certainly holding W — they
     walked to the door — and that keydown is still set, so the first frame of
     the new floor would walk them back through it. Same reason the splash chain
     drops the key that dismissed it. */
  for (const k in keys) delete keys[k];
  syncAmbience();
}

function nextFloor(){
  floorIdx++;
  if (floorIdx >= FLOORS){ STATE='win'; show('win'); document.getElementById('win-stats').innerHTML =
      `You sealed <b>${runStat.sealed}</b> pipes and got back through the door on all <b>${FLOORS}</b> levels.<br>Deaths: <b>${runStat.deaths}</b> &nbsp; Noise made: <b>${runStat.noises}</b><br>Time: <b>${Math.floor(runTime/60)}:${String(Math.floor(runTime%60)).padStart(2,'0')}</b>`;
    document.getElementById('hud').classList.remove('on');
    return;
  }
  /* The clock is read off the OLD floor, before the rebuild — G is replaced
     wholesale by buildFloor and the leftover seconds of the floor you just
     finished are the whole point of the card. */
  const clockLeft = G ? G.clock : FLOOR_CLOCK;
  buildFloor(floorIdx, RUN_SEED);
  /* The briefing reads the same table buildFloor reads, through the same
     clamp, so the numbers on the card are the numbers on the floor. */
  const spec = LEVELS[Math.min(floorIdx, LEVELS_N-1)];
  clearCard = { floor:floorIdx, clock:clockLeft, leaks:spec.leaks, forms:spec.forms };
  showClear();
}

/* Every way a run can end badly costs a life, rewinds the level and says why.
   Two causes, one exit: something found you, or the clock ran out. They are
   the same shape because they are the same decision — you did not get back to
   the door in time — and one screen for both means the player is never left
   guessing which rule they broke. */
function lose(cause){
  if (STATE!=='play') return;
  G.stat.deaths++;
  runStat.deaths++;
  lives--;
  Audio_.sting(); Audio_.silence(); Audio_.silenceBeds();
  STATE='dead';
  renderLives();
  document.getElementById('hud').classList.remove('on');
  const sub = document.getElementById('dead-sub');
  if (lives>0) sub.textContent = `${lives} LIVES REMAINING \u2014 ${cause}`;
  else sub.textContent = 'SIGNAL LOST';
  show('dead');
}

function caught(){ lose('TAPE DAMAGED'); }

/* Out of time. The same cost as being caught — a life and a rewound level —
   because a clock is only a real deadline if it can actually kill you. If it
   only scolded you, three minutes would be advice. */
function outOfTime(){ lose('THE CLOCK RAN OUT'); }

/* ============================================================
   RENDER
   ============================================================ */
/* ---- camera ----
     ONE mapping, used everywhere:
        device_px = SCALE * (world_tiles*TILE + tx)
     so the player's own tile always lands at the centre of the viewport, and
     the light bake (which shares that origin) lines up with the geometry.
     The previous version mixed a pre-scaled offset with a device-space one and
     carried SCALE twice, which panned the world the wrong way and threw the
     player off-screen. */
  const cam = {x:0, y:0, jx:0, jy:0};

  function render(t){
    if (!G) return;
    const p=G.player;

    // camera follow + breathing jitter.
    // Exponential smoothing with a TIME CONSTANT, not a fixed per-frame
    // fraction: 0.12/frame is twice as fast at 144fps as at 72fps, which
    // makes the camera lag inconsistently across machines.
    const dt   = Math.max(0.001, Math.min(0.1, (t - (render.prevT || t-16))/1000));
    render.prevT = t;
    const k    = 1 - Math.exp(-dt/0.09);
    cam.x += (p.x - cam.x) * k;
    cam.y += (p.y - cam.y) * k;
    const breathe = Math.sin(t*0.0009)*0.06;
    /* Shake is a multiplier on the camera jitter, not a new system — the
       breathing motion and the VHS wobble were already here, and a settings
       slider that scales them turns both off at 0. */
    /* Camera jitter. Always on: the breathing sway and the handheld wobble were
       here before the slider existed, and a "camera shake" preference could
       only ever be OFF (0) or exactly what the game already did (1). Turning it
       down did not make the game calmer, it made the camera less honest. */
    cam.jx = (Math.random()-0.5)*0.10 + breathe*0.35;
    cam.jy = (Math.random()-0.5)*0.10;

    // clamp to the maze so the viewport is never half off-map void
    const T = TILE*SCALE;
    const halfW = cvs.width /(2*T), halfH = cvs.height/(2*T);
    if (MAP_W > halfW*2) cam.x = Math.max(halfW, Math.min(MAP_W-halfW, cam.x));
    if (MAP_H > halfH*2) cam.y = Math.max(halfH, Math.min(MAP_H-halfH, cam.y));

    // translate applied inside the scaled context, in world pixels
    const tx = -cam.x*TILE + cvs.width /(2*SCALE) + cam.jx;
    const ty = -cam.y*TILE + cvs.height/(2*SCALE) + cam.jy;
    // same mapping, expressed in device pixels
    const dx = tx*SCALE, dy = ty*SCALE;
    const w2sx = wx => SCALE*(wx*TILE + tx);
    const w2sy = wy => SCALE*(wy*TILE + ty);

    // clean slate. Without this, anything the scene does not paint (the
    // off-map margin at the maze edges) keeps last frame's pixels and the
    // post-processors compound on top of it.
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalAlpha=1;
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='#000';
    ctx.fillRect(0,0,cvs.width,cvs.height);

    ctx.setTransform(SCALE,0,0,SCALE,0,0);
    ctx.save();
    ctx.translate(tx, ty);

    const tlx = Math.floor(cam.x - cvs.width /(2*T)) - 1;
    const tly = Math.floor(cam.y - cvs.height/(2*T)) - 1;
    const tw  = Math.ceil(cvs.width /T) + 3;
    const th  = Math.ceil(cvs.height/T) + 3;

    const x0=Math.max(0,tlx), y0=Math.max(0,tly);
  const x1=Math.min(MAP_W-1,tlx+tw), y1=Math.min(MAP_H-1,tly+th);
  const vw = x1-x0+1, vh = y1-y0+1;

  /* ---------- 1. carpet ----------
     Baked at floor build: the carpet, the hash2 tonal variation, the wall
     faces, the wall tops and their edge highlights are static, so the whole
     viewport slice of them is one drawImage each. Source rect is the viewport
     in TILES on the world-sized bake canvas; the destination is the same
     rectangle in world pixels, inside the same camera transform the per-tile
     fills used. */
  ctx.drawImage(G.tilesCv, x0*TILE, y0*TILE, vw*TILE, vh*TILE,
                            x0*TILE, y0*TILE, vw*TILE, vh*TILE);

  /* ---------- 1b. the flood ----------
     Drawn AFTER the carpet and BEFORE the walls, which is what makes it read as
     the floor being wet rather than a blue card floating over the room: the
     wall faces and tops are painted on top of it, so a partition standing in a
     flooded room stays dry and above the waterline.

     One drawImage of a 76x76 image upscaled with smoothing. Per-tile fills were
     the obvious alternative and would have been both slower (5776 draw calls)
     and worse — hard tile-aligned water edges, the same quantised boundary the
     vision cone has, on a feature whose entire job is a legible front. */
  /* The packed image is refreshed where G.wetArr changes, not here — see
     waterDirty. Drawing it is still one drawImage. */
  if (G.wetArr){
    ctx.globalAlpha = 1;
    ctx.drawImage(G.wetCv, 0, 0, MAP_W*TILE, MAP_H*TILE);

    /* Specular sheen on the deep water. Without it a flooded room is a flat
       tinted region and reads as "a blue filter is on" rather than as water;
       the highlight is what makes it look like a surface you could sink
       into. Drawn only on the deepest tiles and only where the mask can see
       them, so a dark flooded room is still dark. */
    ctx.globalCompositeOperation = 'lighter';
    const shx0=Math.max(0,x0), shy0=Math.max(0,y0);
    for (let y=shy0;y<=y1;y++) for (let x=shx0;x<=x1;x++){
      const i=y*MAP_W+x;
      const w = G.wetArr[i];
      if (w < 0.55) continue;
      if (G.maskArr[i] < 0.05) continue;
      const n = hash2(x*7+3, y*11+5);
      const ph = (t*0.0011 + n*6.28);
      const a = (w-0.55)/0.45 * 0.05 * (0.5+0.5*Math.sin(ph));
      if (a <= 0.003) continue;
      ctx.fillStyle = `rgba(150,196,206,${a})`;
      ctx.fillRect(x*TILE, y*TILE, TILE, TILE);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- 2+3. wall faces and tops ----------
     The second baked layer, drawn AFTER the flood so a partition standing in
     a flooded room stays dry: the water lands on the carpet and the walls are
     painted over it, exactly the order the per-tile passes used. */
  ctx.drawImage(G.wallsCv, x0*TILE, y0*TILE, vw*TILE, vh*TILE,
                             x0*TILE, y0*TILE, vw*TILE, vh*TILE);

  /* ---------- 4. world markers ---------- */
  for (const b of G.batteries){
    if (b.taken) continue;
    const bx=(b.x+0.5)*TILE, by=(b.y+0.5)*TILE;
    const pu = 1 + Math.sin(t*0.004)*0.12;
    ctx.fillStyle='rgba(20,17,8,0.45)'; ctx.fillRect(bx-9, by-11, 18, 22);
    ctx.fillStyle='#c8d97a'; ctx.fillRect(bx-7, by-9, 14, 18);
    ctx.fillStyle='#2c2a12'; ctx.fillRect(bx-5, by-7, 10, 5*pu+3);
    ctx.strokeStyle='rgba(232,217,138,0.5)'; ctx.lineWidth=1;
    ctx.strokeRect(bx-7.5, by-9.5, 15, 19);
  }

  /* The leak itself is drawn AFTER the lighting multiply — see section 6b.
     It is the one object in the world that is not gated by the cone, and the
     reason is written where it is drawn. */

  for (const e of G.exitTiles) drawDoor(e, t);

  /* ---------- 5. entities + player, y-sorted ---------- */
  const draws = [];
  for (const a of G.agents) draws.push({y:a.y, kind:'a', o:a});
  draws.push({y:p.y, kind:'p', o:p});
  draws.sort((m,n)=> m.y-n.y);
  for (const d of draws) d.kind==='a' ? drawAgent(d.o,t) : drawPlayer(p,t);

  ctx.restore();

  /* ---------- 6. lighting ---------- */
  ctx.setTransform(1,0,0,1,0,0);

  // ambient bake (multiply) — mono-yellow, and only where the character can see
  ctx.globalCompositeOperation='multiply';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(G.lightCv, dx, dy, MAP_W*TILE*SCALE, MAP_H*TILE*SCALE);

  /* The visibility mask: room scope x distance x cone, or everything at once
     while the radar sweeps. One multiply. Multiplicative, not additive, so it
     can only ever REMOVE light the bake put there — which is the whole point. */
  ctx.drawImage(G.maskCv, dx, dy, MAP_W*TILE*SCALE, MAP_H*TILE*SCALE);

  /* flickering fluorescents (additive, above the bake).
     GATED BY VISIBILITY. The bake is a multiply, so an unlit room is already
     dark — but this pass is 'lighter', which ADDS light on top of whatever
     the bake left. Left ungated it paints every fixture on the floor at full
     strength, so every "dark" room would have its tube blazing in it and the
     room scoping would be invisible. */
  ctx.globalCompositeOperation='lighter';
  for (const f of G.fixtures){
    const fv = fixtureVis(f);
    if (fv < 0.02) continue;
    let a = 0.12 * fv;
    /* Fluorescent flicker. 16% of fixtures stutter, a 2%-per-frame dropout dips
       a tube to 15%, and the VHS pass adds its own on top. The depth and the
       dropout were a three-way preference once; they are now simply what a
       fluorescent tube does, at FLICKER_DEPTH. The hum is the room's whole
       character — a perfectly steady light reads as a bug, not as calm. */
    if (f.flicker){
      a *= (1-FLICKER_DEPTH + FLICKER_DEPTH*Math.max(0, Math.sin(t*0.001*f.flicker + f.phase)));
      if (Math.random()<0.02) a*=0.15;
    }
    const fx=w2sx(f.x), fy=w2sy(f.y);
    const rr=f.r*T;
    if (fx<-rr||fy<-rr||fx>cvs.width+rr||fy>cvs.height+rr) continue;
    /* One textured quad instead of a screen-sized gradient rebuilt per fixture
       per frame. Same ramp, same alpha (it rides in globalAlpha now), and the
       sprite is a quarter of the cost: a gradient fill evaluates its stops at
       every pixel it covers, a drawImage samples a texture — and this rect is
       routinely larger than the viewport, because r goes up to 19 tiles. */
    ctx.globalAlpha = a;
    ctx.drawImage(glowSprite, fx-rr, fy-rr, rr*2, rr*2);
    ctx.globalAlpha = 1;
    /* The tube itself must be a FIXED physical size. It used to scale with
       f.r (the 10-19 tile light radius), painting a 130-400px additive slab
       per fixture; two or three overlapping blew the whole frame to white. */
    const tw2 = 2.4*T, th2 = 0.34*T;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(f.phase);
    ctx.fillStyle=`rgba(228,230,168,${(0.10 + a*0.5)*fv})`;
    ctx.fillRect(-tw2/2, -th2/2, tw2, th2);
    ctx.fillStyle=`rgba(225,226,187,${0.10*fv})`;
    ctx.fillRect(-tw2/2, -th2/2, tw2, th2*0.45);
    ctx.restore();
  }

  /* No additive pass for the radar. It is tempting: sweep a bright wash over the
     frame to suggest the device firing. But the mask has already multiplied
     every dark room down to black, so an additive wash paints a yellow haze
     onto an empty frame — a glow with no room in it, which reads as a
     rendering fault rather than as light. The radar reveals because the mask
     never zeroed anything while it was on. */
  ctx.globalCompositeOperation='source-over';

  /* ---------- 6b. the pipes ----------
     The one thing in the world that is not gated by the cone, and deliberately
     so. Drawn as part of the scene it would be multiplied by the mask along
     with everything else, which is correct from the next room and wrong from
     the doorway: the mechanic is that the WATER tells you where the leak is,
     and a cue that stops working the moment you arrive has taken the mechanic
     away at the only point it matters. Each pipe is drawn on its own tile's
     mask value, so the rule is per-pipe and not "nearest one wins" — you can be
     standing at a sealed pipe with another one still gushing a room away.

     It is still not the radar. It reveals one tile you are already standing
     next to, it costs no battery, and it does nothing at all while you are two
     rooms away — the G.maskArr lookup is a plain tile read and the radar's
     contract ("everything, full brightness, while the battery lasts") is not
     touched anywhere near this code. */
  for (const L of G.leaks){
    /* DEVICE space, not world. This pass runs after ctx.restore(), so the
       context is back to identity and a world coordinate is just a raw pixel.
       The first version filled at L.x*TILE and drew the entire leak at
       (1360, 1360) — off screen, every frame, while every logic test passed
       and the leak was plainly absent from the screenshot. It is converted
       with the same w2s helpers the fixture pass uses, and sized in device
       pixels, which is why the flood (drawn earlier, inside the world
       transform) does not need this and the leak does. */
    const lt = L.y*MAP_W + L.x;
    if (!G.wetArr || G.maskArr[lt] <= 0.02) continue;
    const U  = TILE*SCALE;                 // one tile, in device pixels
    const fx = w2sx(L.x+0.5), fy = w2sy(L.y+0.5);
    const vis = G.maskArr[lt];
    ctx.save();
    ctx.globalAlpha = vis;

    if (!L.fixed){
      /* the split: a dark stain that runs DOWN the face and pools at the base,
         widening as it goes. The widening is what makes it read as liquid
         rather than as a stain-coloured rectangle. */
      const g1 = ctx.createLinearGradient(fx, fy-U/2, fx, fy+U/2);
      g1.addColorStop(0,   'rgba(28,44,48,0.95)');
      g1.addColorStop(0.35,'rgba(44,70,74,0.80)');
      g1.addColorStop(1,   'rgba(70,104,108,0.45)');
      ctx.fillStyle = g1;
      ctx.fillRect(fx-U*0.34, fy-U*0.40, U*0.68, U*0.90);
      /* wet halo on the carpet at the foot of the wall */
      const g2 = ctx.createRadialGradient(fx, fy+U*0.5, 1, fx, fy+U*0.5, U*0.95);
      g2.addColorStop(0,  'rgba(96,140,148,0.50)');
      g2.addColorStop(1,  'rgba(70,104,108,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(fx-U, fy-U*0.5, U*2, U*2);
      /* the jet — a thin bright line that pulses */
      const pulse = 0.5 + 0.5*Math.sin(t*0.006);
      ctx.fillStyle = `rgba(168,214,222,${0.30+0.30*pulse})`;
      ctx.fillRect(fx-U*0.06, fy-U*0.38, U*0.12, U*0.66);
    } else {
      /* sealed: a collar and a dry face. No halo, no jet. The absence is the
         feedback — you can tell from across the room that it is done. */
      ctx.fillStyle='rgba(120,132,74,0.92)';
      ctx.fillRect(fx-U*0.28, fy-U*0.16, U*0.56, U*0.24);
      ctx.fillStyle='rgba(228,230,168,0.55)';
      ctx.fillRect(fx-U*0.28, fy-U*0.16, U*0.56, U*0.05);
      ctx.fillStyle='rgba(28,44,48,0.55)';
      ctx.fillRect(fx-U*0.30, fy-U*0.36, U*0.60, U*0.22);
    }
    ctx.restore();

    /* The wrench ring is drawn UNMASKED but only while the player is physically
       at the pipe, which is a fact about where they are standing rather than
       an act of revealing. Losing it to a nearby partition would read as the
       repair stalling for no reason, and the ring is the only feedback the
       mechanic gives moment to moment. */
    if (L.repair > 0 && !L.fixed){
      const rx = w2sx(L.sx+0.5), ry = w2sy(L.sy+0.5), rr = U*0.62;
      const prog = L.repair/REPAIR_TIME;
      ctx.strokeStyle = 'rgba(20,24,18,0.75)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(rx, ry, rr, 0, 6.283); ctx.stroke();
      ctx.strokeStyle = 'rgba(158,214,224,0.95)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(rx, ry, rr, -Math.PI/2, -Math.PI/2 + prog*6.283);
      ctx.stroke();
    }
  }

  /* ---------- 7. danger / awareness ---------- */
  /* Both overlays below are baked images (buildVignette / buildDangerWash) and
     were full-screen gradients rebuilt and re-evaluated every frame. The
     awareness wash's strength now rides in globalAlpha, which is exactly what
     multiplying the gradient's outer stop by `seen` was doing. The images are
     rebuilt on resize(); the lazy rebuilds below are the belt to that braces,
     and cost nothing once the size has settled. */
  if (!vigCv || vigCv.width!==cvs.width || vigCv.height!==cvs.height) buildVignette();
  /* The danger wash is HALF resolution, so the guard has to compare against the
     size it would be BUILT at, not against cvs.width itself: an odd canvas
     width shifted right by one and the check never matched, which rebuilt the
     wash every frame and cost more than the gradient it replaced. */
  const dw = Math.max(1, cvs.width>>1), dh = Math.max(1, cvs.height>>1);
  if (!dangerCv || dangerCv.width!==dw || dangerCv.height!==dh) buildDangerWash();

  const seen = Math.min(1,G.seenBy);
  if (seen>0.01){
    ctx.globalAlpha = seen;
    ctx.drawImage(dangerCv, 0, 0, cvs.width, cvs.height);
    ctx.globalAlpha = 1;
  }
  /* Vignette. Was 0.52, which was tuned when the whole floor was lit and the
     only job was to stop the frame feeling like a wallpaper sample. With the
     room scoped and the cone doing the framing, a vignette that strong just
     eats the palette at the edges of the very room you are standing in. */
  ctx.drawImage(vigCv, 0, 0);

  /* ---------- 8. VHS composite ----------
     A lopping tracking band, a scanline grid, grain, a chroma ghost and
     dropouts. This is the pass that makes the game a recording rather than a
     window, and it is now unconditional: it was a slider once, and the two
     things people turned it down for — the scanline crawl and the shake — are
     both still here at full strength, so "tape degradation" as a preference
     could not honestly offer a middle. The snapshot is taken before the passes
     that read it. */
  const vhs = VHS_PASS;
  /* The snapshot exists so the chroma ghost has something to read that does not
     include itself. It was a FULL-RES copy of the canvas — a screen-sized
     read plus a screen-sized write, every frame — and the ghost then composited
     that copy twice more at screen size. Three full-screen operations to draw a
     3%-alpha, 1-3px offset smear.

     QUARTER RESOLUTION. Nothing about the effect can see the difference: the
     source is upscaled back to canvas size with smoothing on the way out, so a
     slightly soft ghost rather than a sharp one, which is what chroma bleed
     looks like anyway. What it buys is a quarter-res copy and two quarter-res
     composites in place of three full-screen ones. The snapshot is still taken
     before every pass that reads it, so there is no feedback. */
  const POST_S = 0.25;
  const pw = Math.max(1, Math.round(cvs.width * POST_S));
  const ph = Math.max(1, Math.round(cvs.height * POST_S));
  if (!G.postCv || G.postCv.width!==pw || G.postCv.height!==ph){
    G.postCv = document.createElement('canvas');
    G.postCv.width = pw; G.postCv.height = ph;
  }
  const pg = G.postCv.getContext('2d');
  pg.globalCompositeOperation='copy';
  pg.setTransform(POST_S,0,0,POST_S,0,0);
  pg.drawImage(cvs,0,0);
  pg.setTransform(1,0,0,1,0,0);
  pg.globalCompositeOperation='source-over';

  if (vhs > 0.01){
  // tracking band
  const bandY = ((t*0.055) % (cvs.height+220)) - 110;
  const tg=ctx.createLinearGradient(0,bandY,0,bandY+110);
  tg.addColorStop(0,'rgba(255,255,255,0)');
  tg.addColorStop(0.5,`rgba(255,248,220,${0.05*vhs})`);
  tg.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=tg; ctx.fillRect(0,bandY,cvs.width,110);

  // scanlines
  ctx.globalCompositeOperation='multiply';
  ctx.globalAlpha = vhs;
  ctx.fillStyle=scanPat;
  ctx.fillRect(0,0,cvs.width,cvs.height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation='source-over';

  // grain
  ctx.globalCompositeOperation='overlay';
  ctx.globalAlpha=0.032*vhs;
  if (!grainFull || grainFull.width!==cvs.width || grainFull.height!==cvs.height) buildGrainFull();
  ctx.drawImage(grainFull, 0, 0);
  ctx.globalAlpha=1;
  ctx.globalCompositeOperation='source-over';

  // chromatic ghost, from the snapshot — bounded, no feedback.
  // The offset stays in DEVICE pixels: the snapshot is drawn back out at canvas
  // size, so a shift of `ca` here is a shift of `ca` on screen, exactly as it
  // was when the copy was 1:1.
  ctx.globalCompositeOperation='lighter';
  ctx.globalAlpha=0.03*vhs;
  ctx.imageSmoothingEnabled = false;     // a 4x nearest upscale of a 3% smear
  const ca = 1 + Math.round(Math.random()*2);
  ctx.drawImage(G.postCv, -ca, 0, cvs.width, cvs.height);
  ctx.drawImage(G.postCv,  ca, 0, cvs.width, cvs.height);
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha=1;
  ctx.globalCompositeOperation='source-over';

  // dropouts
  if (Math.random()<0.02*vhs){
    const y=(Math.random()*cvs.height)|0;
    ctx.fillStyle='rgba(210,206,190,0.14)';
    ctx.fillRect(0,y,cvs.width,1+Math.random()*2|0);
  }
  }   // end vhs
}

/* ============================================================
   THE CAST — two sprites, drawn as paths.
   ============================================================ */
const TAU = Math.PI * 2;

function limb(g, x1, y1, x2, y2, w, col) {
  g.strokeStyle = col;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  g.lineCap = 'butt';
}

function blob(g, cx, cy, rx, ry, col, rot) {
  g.fillStyle = col;
  g.beginPath(); g.ellipse(cx, cy, rx, ry, rot || 0, 0, TAU); g.fill();
}

/* One stride: `s` is the fore/aft offset of the leading foot, `liftL`/`liftR`
   are how high each foot is off the carpet, `bob` is the body rise that comes
   with two steps. gait=0 collapses all of it to zero, so an idle sprite is
   symmetric without any special case. */
function stride(S) {
  const k = S.gait || 0;
  const p = S.phase * TAU;
  const s = Math.sin(p) * k;
  return { s, liftL: Math.max(0, s), liftR: Math.max(0, -s), bob: -Math.abs(Math.cos(p)) * 0.012 * k };
}

/* A rubber boot: shaft, then a sole that reaches forward of it. The sole is
   what reads as a foot from above, so it is drawn second and darker. */
function boot(g, T, cx, cy, ang, sc, col, dark) {
  g.save();
  g.translate(cx, cy);
  g.rotate(ang);
  blob(g, 0, 0, 0.058 * sc * T, 0.078 * sc * T, col);
  blob(g, 0, -0.048 * sc * T, 0.052 * sc * T, 0.040 * sc * T, dark);
  g.restore();
}

/* The carpet is a saturated yellow and so is the vest. A dark rim is what
   keeps a figure from bleeding into the floor at game scale. */
function rim(g, cx, cy, rx, ry) {
  g.strokeStyle = 'rgba(24,26,16,0.55)';
  g.lineWidth = 0.055 * (rx + ry) * 0.5 + 0.6;
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.stroke();
}

/* An arm from the shoulder to the hand. The shoulder sits BEHIND the centre
   of the body and the hand level with it, so the limb hangs along the flank:
   reaching further forward than this puts two pale blobs above the head, and
   from directly overhead a top-down figure with two blobs above its head is
   a rabbit. */
function arm(g, T, side, cy, swing, col, handCol, reach) {
  const r = reach || 1;
  const sx = side * T * 0.155, sy = cy + T * 0.05;
  const ex = side * T * (0.17 + 0.02 * r), ey = cy + T * 0.01 + swing * T * 0.5;
  const hx = side * T * (0.10 + 0.04 * r), hy = cy - T * 0.055 + swing * T;
  limb(g, sx, sy, ex, ey, T * 0.066, col);
  limb(g, ex, ey, hx, hy, T * 0.056, col);
  blob(g, hx, hy, T * 0.038, T * 0.042, handCol);
}

/* Where both feet are, this frame. One plan, two consumers: the legs are
   drawn to it and the boots are drawn on it, so the legs cannot come apart
   from the boots — which is the usual way a hand-drawn walk cycle falls
   apart. */
function footPlan(S, T, o) {
  const st = stride(S);
  const bob = st.bob * T + (o.bob || 0);
  const out = [];
  for (const s of [-1, 1]) {
    const lift = s > 0 ? st.liftR : st.liftL;
    const fore = -st.s * s * T * (o.swing || 0.045);
    out.push({
      s,
      x: s * o.sep * T,
      y: o.y * T + bob + fore - lift * (o.lift || 0.06) * T,
      ang: -s * st.s * (o.turn || 0.30),
      sc: o.sc || 1,
    });
  }
  return out;
}

function feet(g, T, S, o) {
  for (const f of footPlan(S, T, o)) boot(g, T, f.x, f.y, f.ang, f.sc, o.col, o.dark);
}

function legs(g, T, S, o) {
  for (const f of footPlan(S, T, o))
    limb(g, f.s * o.hipSep * T, o.hipY * T, f.x, f.y + T * 0.035, T * (o.w || 0.10), o.col);
}

/* THE AVATAR — the Rigger. Hard hat, hi-vis vest with two reflective bands
   that slide fore and aft on the stride, tool belt, and a wrench that swings
   with the walk. Local -y is forward: the boots lead, the hat brim trails. */
function drawRigger(g, S) {
  const T = S.T, st = stride(S);
  const hip = st.bob * T;

  feet(g, T, S, { sep:0.088, y:-0.085, bob:hip, col:'#4a3a22', dark:'#2f2515', lift:0.06, sc:0.9 });

  // work trousers
  legs(g, T, S, { sep:0.105, y:-0.135, bob:hip, hipSep:0.072, hipY:-0.02, col:'#4a4a52', w:0.095 });

  // vest over a grey tee
  blob(g, 0, T * 0.025 + hip, T * 0.155, T * 0.115, '#c8b25a');
  rim(g, 0, T * 0.025 + hip, T * 0.155, T * 0.115);
  g.fillStyle = '#8e8a72';
  g.beginPath(); g.ellipse(0, T * 0.045 + hip, T * 0.055, T * 0.075, 0, 0, TAU); g.fill();
  // reflective bands, offset by the stride
  const off = st.s * T * 0.018;
  g.fillStyle = 'rgba(236,238,196,0.85)';
  g.fillRect(-T * 0.15, T * 0.05 + hip - off, T * 0.30, T * 0.022);
  g.fillRect(-T * 0.15, T * 0.10 + hip - off, T * 0.30, T * 0.022);

  // arms, and a wrench hanging off the belt that swings with the walk
  for (const s of [-1, 1]) arm(g, T, s, T * 0.035 + hip, -st.s * 0.05 * s, '#8e8a72', '#c9a072');
  g.save();
  g.translate(T * 0.14, T * 0.10 + hip); g.rotate(-0.4 + st.s * 0.5);
  g.fillStyle = '#7d8288';
  g.fillRect(-T * 0.015, 0, T * 0.03, T * 0.11);
  g.beginPath(); g.arc(0, T * 0.11, T * 0.028, 0, TAU); g.fill();
  g.restore();

  // hard hat: dome plus a brim that leads
  blob(g, 0, T * 0.055 + hip, T * 0.10, T * 0.10, '#e8b62e');
  rim(g, 0, T * 0.055 + hip, T * 0.10, T * 0.10);
  blob(g, 0, T * 0.105 + hip, T * 0.115, T * 0.05, '#c9921f');
  g.strokeStyle = 'rgba(255,244,200,0.6)'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(-T * 0.07, T * 0.04 + hip); g.lineTo(T * 0.07, T * 0.04 + hip); g.stroke();
}

/* THE LIFEFORM — the Stalker. Four thick black legs under a small glossy
   body, sized at roughly TWICE the avatar: the Rigger stands about a quarter
   of a tile tall and half a tile wide, and this is about half a tile tall and
   three quarters across. A thing that swells as it approaches you is a threat
   you can watch coming; this one is compact and simply is already there, and
   its legs reach further than its body, which is why the floor is clipped
   under it (see drawAgent) — an unclipped leg over a partition reads as
   walking through walls. The origin is the feet; it grows upward. */
function drawStalker(g, S) {
  const T = S.T, t = S.t;
  const HGT = T * 0.75;
  g.globalAlpha = Math.min(1, 0.30 + S.h * 0.70);
  g.save();
  const s = Math.sin(S.phase * TAU) * (S.gait || 0);
  const legs = [[-1, 0], [1, Math.PI], [-1, Math.PI * 0.55], [1, Math.PI * 0.55]];

  /* THE HIT ZONE, drawn first so the legs and body stand on it. brush() is
     fatal at CATCH_R tiles and nothing on screen said so: the legs reached
     further than the kill radius and the body was smaller than it, so the part
     that could touch you was invisible. This disc IS the kill radius. */
  const danger = S.danger || 0;
  blob(g, 0, 0, T * CATCH_R, T * CATCH_R * 0.92, `rgba(18,20,14,${0.20 + 0.14 * danger})`);
  g.strokeStyle = `rgba(216,80,60,${0.20 + 0.34 * danger})`;
  g.lineWidth = 2;
  g.beginPath(); g.ellipse(0, 0, T * CATCH_R, T * CATCH_R * 0.92, 0, 0, TAU); g.stroke();

  for (let i = 0; i < legs.length; i++) {
    const side = legs[i][0], ph = legs[i][1];
    const sw = Math.sin(S.phase * TAU + ph) * (S.gait || 0);
    const footX = side * T * (0.30 + sw * 0.10);
    const footY = -HGT * 0.06 + Math.cos(S.phase * TAU + ph) * T * 0.09 * (S.gait || 0);
    const hipX = side * T * 0.10, hipY = -HGT * 0.62;
    // knee: out to the side and below the hip line, so the leg reads bent
    const kneeX = side * T * (0.22 + sw * 0.06);
    const kneeY = -HGT * 0.34;
    limb(g, hipX, hipY, kneeX, kneeY, T * 0.095, '#0e0e0d');
    limb(g, kneeX, kneeY, footX, footY, T * 0.070, '#0e0e0d');
    // three-toed foot, the shape that says "not a boot"
    g.strokeStyle = '#0e0e0d'; g.lineWidth = T * 0.035; g.lineCap = 'round';
    for (const k of [-0.4, 0, 0.4]) {
      g.beginPath();
      g.moveTo(footX, footY);
      g.lineTo(footX + Math.sin(k) * T * 0.08, footY - T * 0.08 + Math.abs(k) * T * 0.02);
      g.stroke();
    }
    g.lineCap = 'butt';
  }

  // body: a glossy black mass with two lobed shoulders
  const pitch = s * T * 0.03;
  g.save();
  g.translate(pitch, 0);
  blob(g, 0, -HGT * 0.72, T * 0.20, T * 0.15, '#121211');
  blob(g, -T * 0.15, -HGT * 0.84, T * 0.10, T * 0.08, '#151514');
  blob(g, T * 0.16, -HGT * 0.80, T * 0.12, T * 0.09, '#151514');
  blob(g, 0, -HGT * 0.92, T * 0.10, T * 0.08, '#181817');
  // wet highlights: the sheen is what makes it liquid rather than matte
  g.fillStyle = `rgba(228,230,168,${0.10 + 0.05 * Math.sin(t * 0.004)})`;
  g.beginPath(); g.ellipse(-T * 0.045, -HGT * 0.75, T * 0.045, T * 0.017, -0.5, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(T * 0.055, -HGT * 0.86, T * 0.035, T * 0.014, -0.4, 0, TAU); g.fill();
  g.restore();   // the body pitch

  /* Pop the save() at the top of this function. Without it the Stalker leaks
     one canvas state per frame, and because the states are LIFO the damage is
     not confined to itself: drawAgent's two restores then pop the WRONG pair,
     so its floor clip survives past drawAgent and the player — drawn after it
     in the y-sort — is clipped to the five tiles around the Stalker. The
     Rigger therefore vanished whenever a Lifeform happened to sort north of
     it, which is every frame in the bottom half of a floor. */
  g.restore();
  g.globalAlpha = 1;
}

/* THE DOOR.
   Drawn before the lighting multiply, like everything else on this pass, so it
   is there exactly when the wall it is in is — which is the right amount of help
   for the one object whose position you already know to the tile. It needs no
   reveal because you start the level standing in front of it and you finish the
   level walking back into the room it is in.

   LOCAL SPACE. The origin is the centre of the door's own tile and +y points
   INTO the room, so everything below is written once, in the one orientation
   where the wall is above and the opening faces the viewer. `facing` rotates
   that into whichever wall the placement actually landed in, which is why the
   hinge, the swing and the frame are correct in all four of them.

   The lamp is the whole state read. It was text once — LOCKED above, LATCH
   CLEAR below — and text on a door is a label stuck to a rectangle: it says
   what the door is, not what it is doing, and it is only legible when the
   multiply has already let enough light through to read small type. A lamp in
   the frame corner survives the lighting, survives the distance across a dark
   room on the way back, and is what a building with a functioning door system
   would actually have fitted. */
const DOOR_ROT = { S:0, N:Math.PI, E:-Math.PI/2, W:Math.PI/2 };
/* How far south of its own tile the door is PAINTED, and where in that tile.
   This is not a nudge, it is the difference between a frame lying on the floor
   and a door in a wall. The door tile is masonry: the renderer paints its
   ceiling top dark, and the lit face — the wallpaper band with the hard ceiling
   line above it — lives in the carpet tile BELOW, filling WALL_FACE of that
   tile's height (bakeTiles). So the door is painted there, centred on the band
   itself rather than on the tile, because the band is the wall and the rest of
   that tile is floor.

   Drawn in section 4, which is after both the flood and the wall bake, so
   landing here paints straight over the lit face. The Rigger draws later still
   (section 5), so standing in the doorway puts them in front of the frame,
   which is where a person in a doorway is. */
function drawDoor(e, t){
  const armed = G.leaksOpen === 0;
  const open  = Math.max(0, Math.min(1, e.open));     // the swing, written by tickDoor
  /* Sized to the face it is painted on. A door wider or taller than the band
     stops being a door in the wall and becomes a free-standing frame standing
     on the carpet in front of it — which is what the first version looked like
     at 0.74 of a tile against a face of 0.46.

     0.60 rather than something rounder because the opening is not the whole
     object: the casing strokes sit 3px outside it on every side, and the door
     only fits the face if the opening plus its own frame does. At 0.60 the
     assembly spans exactly the band's height, which is the constraint. */
  const OW = TILE*0.40, OH = WALL_FACE*0.60;
  const hw = OW/2, hh = OH/2;
  const cycling = G.descend>0.02 && G.descend<DOOR_HOLD;

  const rot = DOOR_ROT[e.facing] !== undefined ? DOOR_ROT[e.facing] : 0;

  ctx.save();
  ctx.translate((e.x+0.5)*TILE, (e.y+1)*TILE + WALL_FACE/2);
  ctx.save();
  ctx.rotate(rot);

  /* The lamp's own light, thrown onto the wall before anything is drawn over
     it — the glow is how the state reads from the next room, which is the only
     time you are far enough away for it to matter. */
  const gr = ctx.createRadialGradient(0, 0, 2, 0, 0, TILE*2.4);
  if (armed){
    const p = 0.5 + 0.5*Math.sin(t*0.010);            // READY breathes
    gr.addColorStop(0, `rgba(143,208,122,${0.16+0.14*p})`);
  } else {
    gr.addColorStop(0, 'rgba(143,208,122,0.10)');     // LOCKED barely registers
  }
  gr.addColorStop(1,'rgba(143,208,122,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(-TILE*2.4, -TILE*2.4, TILE*4.8, TILE*4.8);

  /* the opening — somewhere darker than the wall it is cut into */
  ctx.fillStyle = 'rgba(16,20,12,0.88)';
  ctx.fillRect(-hw, -hh, OW, OH);

  /* THE FRAME, as an outline rather than a fill.
     This used to paint its own wall colour into the lintel and the jambs, which
     was right when the door sat on the wall tile and had to bring its masonry
     with it. Painted on the lit face there is nothing to bring: the wallpaper
     band is already there, under us, and filling over it erased the one lit
     surface the door was placed to be on. So the frame is now the casing — two
     jambs and a head, stroked — and the wall face reads straight through the
     gaps the way a real door frame sits in a real wall. */
  ctx.strokeStyle = '#9c9a68'; ctx.lineWidth = 2.5;
  ctx.strokeRect(-hw-1.5, -hh-1.5, OW+3, OH+3);
  ctx.strokeStyle = 'rgba(40,38,24,0.5)'; ctx.lineWidth = 1;
  ctx.strokeRect(-hw-3, -hh-3, OW+6, OH+6);
  ctx.fillStyle = 'rgba(120,118,70,0.55)';
  ctx.fillRect(-hw-1.5, hh+1.5, OW+3, 1.5);            // the sill, catching the room light

  /* THE LEAF. Hinged on the left jamb, so the free edge is the one that
     travels: toward the hinge, and down toward the viewer, because a door in a
     wall on a floor plan swings out into the room it opens onto. The far edge
     cannot rise — it would leave its own frame — so the trapezoid is built from
     the hinge edge, which never moves. */
  const hx = -hw;
  const fx = hx + OW*(1 - 0.52*open);
  const top = -hh + OH*0.26*open;
  ctx.beginPath();
  ctx.moveTo(hx, -hh); ctx.lineTo(fx, top);
  ctx.lineTo(fx, top+OH); ctx.lineTo(hx, hh);
  ctx.closePath();
  const lg = ctx.createLinearGradient(hx, 0, fx, 0);
  lg.addColorStop(0,'#cdc98f'); lg.addColorStop(1,'#a8a473');
  ctx.fillStyle = lg; ctx.fill();
  ctx.strokeStyle = 'rgba(28,26,20,0.55)'; ctx.lineWidth = 1; ctx.stroke();
  if (fx-hx > 6){                                     // the recessed panel
    ctx.strokeStyle = 'rgba(28,26,20,0.22)';
    ctx.beginPath();
    ctx.moveTo(hx+2.5, -hh+2.5); ctx.lineTo(fx-2.5, top+2.5);
    ctx.lineTo(fx-2.5, top+OH-2.5); ctx.lineTo(hx+2.5, hh-2.5);
    ctx.stroke();
  }
  if (armed){
    ctx.fillStyle = '#7d8288';                         // the handle, on the swinging edge
    ctx.fillRect(fx-3.5, top+OH/2-4.5, 2.5, 9);
  }
  /* hinges — on the JAMB, not the leaf, so there is something fixed for the
     crank to swing around */
  ctx.fillStyle = '#6f6c47';
  ctx.fillRect(-hw-3.5, -hh+3, 2.5, 4.5); ctx.fillRect(-hw-3.5, hh-7.5, 2.5, 4.5);

  /* THE CRANK. Drawn only while the door is actually cycling, which is the
     one piece of feedback the 1.5s hold did not have at all: before this, the
     whole descent existed as the prompt string and nothing in the world. */
  if (cycling){
    const cx = -hw-2, cy = 0, r = 8, p = G.descend/DOOR_HOLD;
    ctx.strokeStyle = 'rgba(28,26,20,0.4)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI*0.5, Math.PI*1.5); ctx.stroke();
    ctx.strokeStyle = '#8fd07a';
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI*0.5, Math.PI*0.5+Math.PI*p); ctx.stroke();
    ctx.strokeStyle = '#7d8288'; ctx.lineWidth = 1.6;   // the handle, turning
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx+Math.cos(2.2+t*0.006)*r, cy+Math.sin(2.2+t*0.006)*r);
    ctx.stroke();
  }

  /* THE LAMP. Green means the level can end; red means it cannot. No word on
     the door anywhere — the word is on the HUD, where the other four readings
     are, and one label in one place is a label a player learns to read. */
  const lx = hw + 5, ly = -hh + 1;
  const lit = armed ? (0.6 + 0.4*Math.sin(t*0.010)) : 0.5;
  const col = armed ? '#cdf3bd' : '#d8503c';
  const lg2 = ctx.createRadialGradient(lx, ly, 0.5, lx, ly, 7);
  lg2.addColorStop(0, col); lg2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.45*lit; ctx.fillStyle = lg2;
  ctx.beginPath(); ctx.arc(lx, ly, 7, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(lx, ly, 2.4, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(28,26,20,0.65)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(lx, ly, 2.4, 0, TAU); ctx.stroke();

  ctx.restore();          // pops the rotation, keeps the translate to the door

  ctx.restore();
}

/* The avatar. Every part drawn INSIDE the collision disc (R = 0.33 tiles).
   The body itself is the Rigger, drawn by drawRigger below; this function owns
   the shadow, the facing, the gait clock and the radar in hand. */
function drawPlayer(p, t){
  const x=p.x*TILE, y=p.y*TILE;

  // contact shadow, kept tight so it never spills onto a wall
  ctx.fillStyle='rgba(8,6,3,0.34)';
  ctx.beginPath(); ctx.ellipse(x+1.5, y+3, TILE*0.19, TILE*0.11, 0,0,6.283); ctx.fill();

  /* The gait phase is the step timer — the same one that paces the footstep
     audio — so a rig's feet are on the floor on the frame the sound lands.
     Standing still, phase keeps its last value but gait drops to zero and
     every stride in the table collapses with it. */
  const phase = p.stepDur ? 1 - p.stepT/p.stepDur : 0;

  ctx.save();
  ctx.translate(x,y);
  ctx.rotate(p.face + Math.PI/2);

  drawRigger(ctx, { T:TILE, phase, gait: p.moving ? 1 : 0, t });

  /* The radar, held out in front — same forward offset as vision cone. */
  const rg = G.radar ? 1 : 0.35;
  ctx.fillStyle=`rgba(255,250,222,${0.5*rg})`;
  ctx.beginPath(); ctx.arc(0, -HAND_OFF*TILE, TILE*0.044, 0, 6.283); ctx.fill();
  ctx.fillStyle=`rgba(255,244,196,${0.20*rg})`;
  ctx.beginPath(); ctx.arc(0, -HAND_OFF*TILE, TILE*0.082, 0, 6.283); ctx.fill();

  ctx.restore();
}

/* The Lifeform. Dormant = static burst on carpet. Rising = the body
   coalesces out of its own footprint. Hunting = fully up, one of six
   the Stalker, drawn by drawStalker below. The shadow and the red rim are the
   game's; the thing itself is the sprite's. */
function drawAgent(a, t){
  const x=a.x*TILE, y=a.y*TILE;
  const h = a.rise;

  // shadow, sized to the body rather than to the rise
  ctx.fillStyle='rgba(6,5,3,0.5)';
  ctx.beginPath();
  ctx.ellipse(x, y+4, TILE*0.36, TILE*0.20, 0,0,6.283);
  ctx.fill();

  if (h < 0.02){
    /* DORMANT — a burst of static on the carpet */
    for (let i=0;i<20;i++){
      const sx = x + Math.sin(i*3.7 + t*0.01)*TILE*0.25;
      const sy = y + Math.cos(i*2.3 + t*0.008)*TILE*0.10;
      const br = 100 + Math.sin(i)*50;
      ctx.fillStyle=`rgba(${br},${br},${br},0.3)`;
      ctx.fillRect(sx, sy, 2, 2);
    }
    return;
  }

  /* Gait. The Lifeforms have no step timer of their own — they are not
     walking anything, they are coming — so the phase runs off the frame
     clock and the stride amount comes from the state: a HUNT strides,
     a SEARCH drifts, a WALK is halfway between the two. */
  const gait = a.state==='HUNT' ? 1 : a.state==='WALK' ? 0.55 : 0.3;

  /* CLIP TO THE FLOOR. The Stalker's legs reach further than its collision
     disc, so drawn unclipped it strides straight over the partition into the
     next room — which reads as walking through walls, and a wall it can cross
     is a wall that cannot save you. The clip is the walkable tiles within
     reach of it, so the legs stop at the wall line exactly like the body
     does. Built per frame from the grid: 25 rects, and the alternative is a
     sprite that lies about where it is. */
  const CR = 2;
  const cx0 = Math.max(0, Math.floor(a.x - CR)), cx1 = Math.min(MAP_W-1, Math.ceil(a.x + CR));
  const cy0 = Math.max(0, Math.floor(a.y - CR)), cy1 = Math.min(MAP_H-1, Math.ceil(a.y + CR));
  ctx.save();
  ctx.beginPath();
  for (let ty=cy0; ty<=cy1; ty++)
    for (let tx=cx0; tx<=cx1; tx++)
      if (G.grid[ty*MAP_W+tx]===FLOOR) ctx.rect(tx*TILE, ty*TILE, TILE, TILE);
  ctx.clip();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-a.face + Math.PI/2 + Math.sin(t*0.0018)*0.05);

  /* `danger` is how close it is to hunting you: 0 when it is wandering,
     1 when it is coming. It drives the rim on the hit zone below. */
  drawStalker(ctx, { T:TILE, h, phase: (t*0.0009) % 1, gait, t,
                     danger: a.state==='HUNT' ? 1 : 0.25 });

  ctx.restore();   // the transform
  ctx.restore();   // the floor clip

  // when it has you, a thin red rim on the hit zone itself
  if (G.seenBy>0.35){
    ctx.strokeStyle=`rgba(216,80,60,${0.30*G.seenBy})`;
    ctx.lineWidth=2;
    ctx.beginPath(); ctx.ellipse(x,y,TILE*CATCH_R,TILE*CATCH_R,0,0,6.283); ctx.stroke();
  }
}

/* ============================================================
   HUD + SCREENS
   ============================================================ */
const HUD = {
  batt: document.getElementById('bar-batt'),
  noise: document.getElementById('bar-noise'),
  noiseWrap: document.querySelector('.bar.noise'),
  noisePeak: document.getElementById('bar-noise-peak'),
  noiseLeak: document.getElementById('bar-noise-leak'),
  noiseLoud: document.querySelector('.bar.noise u.loud'),
  vBatt: document.getElementById('val-batt'),
  vNoise: document.getElementById('val-noise'),
  vClock: document.getElementById('val-clock'),
  clockWrap: document.getElementById('clock'),
  vPipes: document.getElementById('val-pipes'),
  vLeak: document.getElementById('val-leak'),
  vFlood: document.getElementById('val-flood'),
  barFlood: document.getElementById('bar-flood'),
  vDepth: document.getElementById('val-depth'),
  vLives: document.getElementById('val-lives'),
  hud: document.getElementById('hud')
};

/* m:ss, floored. The clock is read at a glance while running, so it never
   shows a value it would not show again a frame later — it counts down on whole
   seconds and that is all. */
function clockText(s){
  const t = Math.max(0, Math.ceil(s));
  return Math.floor(t/60) + ':' + String(t%60).padStart(2,'0');
}

let flashT = 0;
function flash(text){
  const el=document.getElementById('flashnote');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(flashT);
  flashT = setTimeout(()=>el.classList.remove('on'), 3400);
}

function show(which){
  for (const s of SCREENS)
    document.getElementById('screen-'+s).classList.toggle('hidden', s!==which);
}
function hideAll(){ for (const s of SCREENS)
    document.getElementById('screen-'+s).classList.add('hidden'); }

/* M. Goes through setOption rather than poking Audio_ directly, so the store is
   written and the UI re-synced on the same path as every other setting — a mute
   that only lives in a variable is a mute that forgets itself on reload. The
   blip is fired AFTER, and only on unmute, because a confirmation you cannot
   hear is not a confirmation. */
function toggleMute(){
  const next = !SETTINGS.muted;
  setOption('muted', next);
  flash(next ? 'AUDIO MUTED' : 'AUDIO ON');
  if (!next) Audio_.blip(true);
}

/* ============================================================
   THE PAUSE TICKET — SETTINGS AND BRIEFING ARE PAGES OF IT
   Every control writes straight into SETTINGS, then calls applySettings() and
   saveSettings(). There is no "apply" button and no pending copy: a slider
   that only commits on OK makes people wonder whether it saved, and these
   values are all cheap and reversible.

   They are not a screen of their own any more. They are the lower half of the
   ticket the player is already looking at, because a pause is the one moment
   the player has stopped to read a document — and a modal over that document
   hides the very thing the player paused to check. pausePage is the only state
   this adds: which page of the ticket is showing. STATE never leaves 'pause',
   so the clock stays frozen and the game behind the ticket stays stopped the
   way it always did, with no second state machine to keep in step.
   ============================================================ */
let pausePage = 'settings';      // 'settings' | 'briefing'

/* SETTINGS is where a pause lands: it is the page with something to change on
   it. BRIEFING is SPLASH 02 reprinted — the work order, the backstory and the
   controls list — for the player who clicked through it once and remembers
   none of it. It is a reprint rather than the order screen itself, because a
   reprint cannot start a run: the "any key advances" branch on the splash
   chain would fire behind the player's back otherwise, and a second copy of
   one hundred words is a cheaper thing to own than a second way to lose a
   floor. */
function setPausePage(page){
  pausePage = page;
  /* An armed RESET GAME does not survive the player's attention moving to
     another page of the ticket. */
  disarmReset();
  for (const b of document.querySelectorAll('[data-pause-page]'))
    b.classList.toggle('hidden', b.dataset.pausePage !== page);
  for (const t of document.querySelectorAll('[data-pause-tab]'))
    t.setAttribute('aria-selected', String(t.dataset.pauseTab === page));
}

/* ============================================================
   THE TERMS OF THE SHIFT
   The difficulty used to be a settings row the player could flip from the
   pause ticket, mid-run — which rewrote FLOOR_CLOCK, REPAIR_TIME and the
   hunt constants under a floor already being played, while runLives had
   been read at clock-in and stayed where it was. Now it is chosen at the
   door: the work order carries a stamp, CHANGE folds the chooser open on
   the ticket, and whatever the stamp says when CLOCK IN lands is what the
   run is built with. There is no difficulty control on the pause screen at
   all — a run is on its terms from its first frame.

   The value still lives in SETTINGS and still persists, so a returning
   player's stamp is the run they always play; a fresh machine reads NORMAL,
   the schema default, and is never unset. paintTerms is the one place the
   stamp is written, and syncSettingsUI calls it, so every path that can
   change the value — the chooser, the digits, RESET SETTINGS, a reloaded
   store — leaves the three stamps and the note saying the same thing.
   ============================================================ */
let termsOpen = false;

/* The work order is prose, and prose needs prose numbers: 240 is "4 minutes",
   150 is "2 minutes 30 seconds", 90 is "90 seconds". The briefing used to say
   "3 minutes" and "5 seconds" whatever the terms — a lie on two of the three. */
function proseClock(s){
  const m = Math.floor(s/60), r = Math.round(s%60);
  const mins = m ? `${m} minute${m===1?'':'s'}` : '';
  const secs = r ? `${r} second${r===1?'':'s'}` : '';
  return [mins, secs].filter(Boolean).join(' ') || 'no time at all';
}

function paintTerms(){
  const d = DIFFICULTIES[SETTINGS.difficulty] || DIFFICULTIES.normal;
  const set = (id, txt)=>{ const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('order-terms', d.label);
  set('pause-terms', d.label);
  /* The work order and the pause reprint of it are one document written
     twice, so the numbers on both come from here: how long the shift is and
     how long a pipe takes, in the terms' own numbers. */
  const ret = proseClock(d.clock);
  const fix = `${d.repairTime} second${d.repairTime===1?'':'s'}`;
  set('order-return', ret);
  set('brief-return', ret);
  set('order-repair', fix);
  set('brief-repair', fix);
  const note = document.getElementById('note-difficulty');
  if (note){
    note.textContent = `${d.lives} lives \u00b7 ${Math.round(d.clock)}s on the clock \u00b7 ${d.repairTime}s at the pipe`;
  }
}

function setTermsOpen(v){
  termsOpen = v;
  const fold = document.getElementById('terms-fold');
  if (fold) fold.classList.toggle('open', v);
  if (!v){
    /* The order screen has no movement, so a key held while the chooser was
       open must not carry into the run: closing the fold is the moment the
       frame goes back to being a splash, and splashes drop held keys. */
    for (const kk in keys) keys[kk] = false;
  }
}

/* ============================================================
   RESET GAME
   The run is the only progress the game keeps — there are no unlocks and no
   meta, the floor dies with the run — so resetting is one honest act: a new
   seed, a fresh floor zero, the attempts restored, and the player back on
   the riser with the same ticket and the same terms they clocked in on. The
   store is NOT wiped: volume, tint and the stamped terms are preferences,
   not progress, and a player who resets to escape a bad floor did not ask
   for the building to forget how they like their water.

   Two-stage, because it is the only control on the ticket that ends a run.
   The first press arms it and says so on the button; the second press fires.
   It disarms itself after five seconds, on a page switch, and on resume — an
   armed reset must never survive the player's attention moving elsewhere,
   or the next pause fires it by accident.
   ============================================================ */
let resetArmed = false;
let resetArmTimer = 0;
const RESET_LABEL  = 'RESET GAME';
const RESET_ARMED  = 'TAP AGAIN — LOSES THE RUN';

function paintResetButton(){
  const b = document.getElementById('btn-reset-run');
  if (b) b.textContent = resetArmed ? RESET_ARMED : RESET_LABEL;
}
function disarmReset(){
  resetArmed = false;
  clearTimeout(resetArmTimer);
  paintResetButton();
}
function armReset(){
  resetArmed = true;
  clearTimeout(resetArmTimer);
  resetArmTimer = setTimeout(disarmReset, 5000);
  paintResetButton();
}
function resetRun(){
  /* The same path boot walks: a new seed, the floor built from it, the plan
     painted from the same seed — so the riser shows the building the next
     run is actually about to be, not a picture of the one just abandoned. */
  rollRunSeed();
  floorIdx = 0;
  runTime = 0;
  runLives = (DIFFICULTIES[SETTINGS.difficulty] || DIFFICULTIES.normal).lives;
  lives = runLives;
  runStat = { noises:0, deaths:0, sealed:0 };
  renderLives();
  /* The HUD belongs to a run; the riser is not one. */
  document.getElementById('hud').classList.remove('on');
  STATE = 'splash';
  show('splash');
  syncAmbience();
  disarmReset();
}

function setOption(key, value){
  if (!settingsValid(key, value)) return false;
  SETTINGS[key] = value;
  /* packWet bakes the tint into the pixels, so a new tint is a stale image even
     though G.wetArr has not moved. */
  if (key==='waterHue' || key==='waterContrast') waterDirty = true;
  applySettings();
  saveSettings();
  syncSettingsUI();
  return true;
}

function syncSettingsUI(){
  // sliders
  for (const el of document.querySelectorAll('input[type=range][data-opt]')){
    const v = SETTINGS[el.dataset.opt];
    if (v !== undefined && Number(el.value) !== v) el.value = v;
  }
  // segmented buttons
  for (const row of document.querySelectorAll('.seg[data-opt]')){
    const key = row.dataset.opt, cur = String(SETTINGS[key]);
    for (const b of row.querySelectorAll('button')){
      b.setAttribute('aria-pressed', String(b.dataset.value === cur));
    }
  }
  /* The stamp on the work order, on its stub, and on the pause stub are the
     same fact as the segmented row, so they are painted from the same place
     the row is synced — one writer, three stamps, the note line. */
  paintTerms();
}

/* Button label sets per segmented row. Declared here rather than in markup so
   the enum and the labels cannot drift apart. */
const SEGMENTS = {
  difficulty: () => Object.keys(DIFFICULTIES).map(k => [k, DIFFICULTIES[k].label]),
  waterHue:   () => [['slate','SLATE'],['teal','TEAL'],['violet','VIOLET'],['grey','GREY']],
};

function buildSettingsUI(){
  /* The controls used to live in a modal they shared with a BACK button, and
     the return path was state juggling: remember where you were, swap STATE,
     map it back on the way out. Now the ticket's pages ARE the menu, so the
     return path is one line: the tab that is not pressed. Escape out of the
     briefing page cannot strand the player anywhere, because there is only
     ever the ticket. */
  for (const row of document.querySelectorAll('.seg[data-opt]')){
    const key = row.dataset.opt;
    const opts = (SEGMENTS[key] || (()=>[]))();
    row.innerHTML = '';
    for (const [val,label] of opts){
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.value = String(val);
      b.onclick = ()=> setOption(key, SETTINGS_SCHEMA[key].type === 'enum' ? val : (val==='true'));
      row.appendChild(b);
    }
  }
  for (const el of document.querySelectorAll('input[type=range][data-opt]')){
    const key = el.dataset.opt;
    el.addEventListener('input', ()=> setOption(key, parseFloat(el.value)));
  }
  const reset = document.getElementById('btn-settings-reset');
  if (reset) reset.onclick = ()=>{ resetSettings(); syncSettingsUI(); };
  /* No BACK on the settings page: it is the page a pause lands on, so BACK
     would mean ESC, and a second control that does what the key under the
     player's hand already does is a control nobody needs. The briefing's BACK
     is different — it goes somewhere, back to the settings page. */
  for (const t of document.querySelectorAll('[data-pause-tab]'))
    t.onclick = ()=> setPausePage(t.dataset.pauseTab);
  /* The terms chooser: the front door. CHANGE folds it out of the stamp on
     the work order; the segmented row inside it is built by the loop above,
     exactly as it was when it was a settings row. */
  const change = document.getElementById('btn-terms-change');
  if (change) change.onclick = ()=> setTermsOpen(!termsOpen);
  /* RESET GAME: arm on the first press, fire on the second. */
  const resetRunBtn = document.getElementById('btn-reset-run');
  if (resetRunBtn) resetRunBtn.onclick = ()=>{
    if (!resetArmed){ armReset(); return; }
    resetRun();
  };
}

/* Click anywhere on either splash advances it, so a player who never reads
   the keyboard prompt is not stuck. The advance function keys off STATE, so
   the click that lands on CLOCK IN and then bubbles up to the screen a second
   time finds STATE already 'play' and does nothing.

   Two guards, both for the work order now that it carries controls. A click
   that lands on a control — a term button, a slider, CHANGE, CLOCK IN itself —
   is a choice, not an advance: bubbling it up to the screen is how a player
   who meant to read the terms starts a run on HARD. And while the chooser
   is open, a click on the frame dismisses it the way ESC does, because an
   open chooser is the top layer of the screen. */
for (const id of ['screen-splash','screen-order']){
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', (e)=>{
    if (e.target.closest && e.target.closest('button, input, .terms-fold')) return;
    if (STATE==='order' && termsOpen){ setTermsOpen(false); return; }
    advanceSplash();
  });
}

function togglePause(){
  if (STATE==='play'){
    STATE='pause';
    show('pause');
    /* Every pause lands on the settings page. It is the one page of the ticket
       with something to change on it, and the page a player who came back to
       adjust the tint needs; the briefing is one click deeper for the player
       who wants to re-read the work order. */
    setPausePage('settings');
    /* The pause screen is splash 04 with the run's own numbers written on it,
       so pausing costs no bearings: depth, pipes left, clock, battery, lives,
       and the next move — all in the places a clerk would have written them.
       SCOPE OF WORK answers "what am I here for" and STATUS answers "where
       does that stand"; the ticket has a line for each because they are
       different questions. */
    const set = (id, html)=>{ const el = document.getElementById(id); if (el) el.innerHTML = html; };
    const sealed = G.pipes - G.leaksOpen;

    set('pause-level',   `${G.floor+1}/${FLOORS}`);
    set('pause-clock',   clockText(G.clock));
    set('pause-pipes',  `${sealed}/${G.pipes}`);
    set('pause-batt',    String(Math.ceil(G.batt)));
    set('pause-lives', livesHTML());
    /* The terms the run is on. Not a control — a fact, like the clock. */
    set('pause-terms',  (DIFFICULTIES[SETTINGS.difficulty] || DIFFICULTIES.normal).label);
    set('pause-seed',    '#88D-' + (RUN_SEED>>>0).toString(16).toUpperCase().slice(-4));
  }
  else if (STATE==='pause'){ disarmReset(); STATE='play'; hideAll(); }
}

function updateHUD(){
  if (!G) return;
  HUD.batt.style.width = (G.batt/BATT_MAX*100)+'%';
  HUD.vBatt.textContent = Math.ceil(G.batt);
  /* The NOISE bar, on the noise scale and not the battery one. Divided by
     BATT_MAX it drew 1% of itself for a sprint and 1.8% for the door, while the
     red test below still fired on the raw level and turned the bar hot at a
     level it could not show. Three marks now: the fill (what you are making),
     the water-blue floor (what the open pipes are making, everywhere — the
     number a searching Lifeform steers by), and the peak tick, because a sprint
     lasts 0.26s and the fill alone cannot say that it happened. */
  const nz = Math.max(0, Math.min(1, G.noise/NOISE_FS))*100;
  HUD.vNoise.textContent = String(Math.round(nz)).padStart(2,'0');
  /* TWO FILLS, ONE BAR. The yellow is what YOU are making; the blue is what
     the open pipes are making, everywhere on the floor, at the level the
     Lifeform is steering by. Standing still beside a burst pipe used to fill
     this bar to its top, which reads as "you are screaming" when you are
     standing perfectly still and something is coming to the PIPE, not to you.
     The number above is the loudest of the two, because that is what the room
     actually sounds like. */
  HUD.noise.style.width = Math.max(0, Math.min(1, G.selfNoise/NOISE_FS))*100+'%';
  /* LOUD, on YOUR noise, and read from the constant. A pipe never reaches it
     by construction, so red still means "this is about you" — and the old 0.45
     was a stale copy of a threshold that lives at 0.5. */
  HUD.noiseWrap.classList.toggle('hot', G.selfNoise>=LOUD);
  G.noisePeak = Math.max(G.noise, G.noisePeak - 0.004);
  if (HUD.noisePeak){
    HUD.noisePeak.style.left = Math.max(0, Math.min(100, G.noisePeak/NOISE_FS*100))+'%';
    HUD.noisePeak.style.opacity = '1';
  }
  if (HUD.noiseLeak){
    HUD.noiseLeak.style.width = Math.max(0, Math.min(1, G.leakTotal/NOISE_FS))*100+'%';
  }
  /* the LOUD mark, positioned from the constant rather than typed into the
     stylesheet: it is the threshold the AI reads, and a hardcoded 50% went
     stale the moment full scale stopped being 1.0 */
  if (HUD.noiseLoud) HUD.noiseLoud.style.left = (LOUD/NOISE_FS*100)+'%';
  /* Three pipe readouts, because they answer three different questions and a
     single "OPEN/SEALED" cannot answer any of them. PIPES is the tally you are
     working down. DOOR is whether the level can end at all — it stays shut until
     the last one is closed. FLOOD is a gauge of how much of the floor is under
     water: it keeps climbing while you are still working, and it drains after
     the last seal, so it is both the pressure and the proof the repair worked. */
  if (HUD.vPipes) HUD.vPipes.textContent = `${G.pipes-G.leaksOpen}/${G.pipes}`;
  /* The door. OPEN means every pipe is sealed and the level can be ended, so
     OPEN is the good state and gets no colour; SEALED is the only one that
     shouts. The old version injected <span class="ok">OPEN</span> with ok being
     water-blue, next to a flood gauge also in water-blue — so the word that
     answers "can I leave yet" looked like it belonged to the thing keeping you
     here. Text plus a class, not markup, so the stylesheet can say what the
     states mean. */
  if (HUD.vLeak){
    HUD.vLeak.textContent = G.leaksOpen===0 ? 'OPEN' : 'SEALED';
    HUD.vLeak.classList.toggle('shut', G.leaksOpen>0);
  }
  if (HUD.vFlood) HUD.vFlood.textContent = String(Math.round(G.floodCover*100)).padStart(2,'0');
  if (HUD.barFlood) HUD.barFlood.style.width = (G.floodCover*100)+'%';
  /* The clock. Whole seconds, and it changes COLOUR in the last thirty — the
     same thirty the flash announces — because a number that does not change
     colour is a number players stop seeing after the first level, and a number
     that changes SIZE is one that reflows its own box once a second for three
     minutes. Both flags live on the wrapper, so the stylesheet owns what
     "low" and "critical" look like and this never has to restate it. */
  HUD.vClock.textContent = clockText(G.clock);
  HUD.clockWrap.classList.toggle('low',     G.clock <= 30);
  HUD.clockWrap.classList.toggle('critical', G.clock <= 10);
  HUD.vDepth.textContent = `${G.floor+1}/${FLOORS}`;
  HUD.vLives.innerHTML = livesHTML();
}

function setPrompt(){
  const el=document.getElementById('prompt');
  if (!G){ el.classList.remove('on'); return; }
  let working = 0;
  for (const L of G.leaks) if (!L.fixed && L.repair > 0.02) working++;
  /* The repair prompt is first because it is the only state in the game where
     the player must NOT press a key, and the prompt line is where they look to
     find out what the game wants. Everything else is a movement instruction. */
  if (working)                el.textContent = 'wrenching \u2014 DO NOT MOVE';
  else if (G.atLeak)         el.textContent = `hold still \u2014 ${REPAIR_TIME} seconds at the pipe`;
  else if (G.descend>0.02)   el.textContent = 'cycling door \u2014 do not stop';
  else if (G.leaksOpen>0)    el.textContent = `${G.leaksOpen} PIPE${G.leaksOpen===1?'':'S'} LEAKING \u2014 THE WATER RUNS DOWNHILL FROM THE BREAK`;
  else                       el.textContent = 'the door will cycle \u2014 GET BACK TO THE ONE YOU CAME IN THROUGH';
  el.classList.add('on');
}

/* ---------- buttons ---------- */
document.getElementById('btn-start').onclick = ()=>{
  Audio_.init();
  Audio_.unlock();
  /* The seed is NOT rolled here. It was rolled before the splash was painted,
     because the plan behind the title has to be the level the player is about
     to walk — re-rolling at the moment of entry would make the splash a lie
     and nothing else. A finished run rolls its own; see rollRunSeed(). */
  runLives = (DIFFICULTIES[SETTINGS.difficulty] || DIFFICULTIES.normal).lives;
  lives = runLives; floorIdx=0; runTime=0;
  /* A new run, so a new tally: the win card is the only reader and it must not
     inherit the previous run's seals and deaths. */
  runStat = { noises:0, deaths:0, sealed:0 };
  renderLives();
  /* Floor 0 was already built at boot — the same seed, the same geometry the
     splash plan was painted from — so building it again here generates the
     identical level a second time for nothing. Reuse it instead.

     The extra two conditions are what stop the reuse from handing back a
     PLAYED floor: a run that died on floor 1 and came back through CLOCK IN
     (lives spent, btn-retry forwards to here) has the same seed and the same
     floor number, but its pipes are sealed and its clock has run. A floor
     that has never ticked and still has every pipe open is the only floor
     worth keeping. The clock check also catches a difficulty change made
     after boot, whose FLOOR_CLOCK the boot floor was never built with. */
  const reuse = G && G.floor===0 && G.seed===RUN_SEED
                && G.clock >= FLOOR_CLOCK && G.leaksOpen === G.pipes;
  if (!reuse) buildFloor(0, RUN_SEED);
  else {
    G.clock = FLOOR_CLOCK; G.time = 0; G.batt = BATT_MAX;
    G.stat = {noises:0, deaths:0, sealed:0};
    G.radar = false; G.noise = 0; G.noisePeak = 0; G.selfNoise = 0; G.descend = 0; G.seenBy = 0;
    initFlood();          // the flood the builder warmed, warmed again here
    snapMask();
  }
  /* The opening grace period, on the start path either way — reuse and a
     fresh build have to be indistinguishable from where the player stands. */
  for (const a of G.agents){ a.born = 3.0; }
  hideAll();
  STATE='play';
  document.getElementById('hud').classList.add('on');
  syncAmbience();        // the title bed has no business following you downstairs
};

document.getElementById('btn-descend').onclick = ()=>dismissClear();
document.getElementById('btn-retry').onclick = ()=>{
  if (lives<=0){
    document.getElementById('btn-start').click(); return;
  }
  buildFloor(floorIdx, RUN_SEED);
  G.batt = Math.max(G.batt, 55);
  /* The retry keeps the same seed, so the pipes are where you left them and
     the flood restarts. Dying costs you a life and the work you did on them,
     but not the knowledge — which is the split that matters, because where the
     pipes are is the thing you spent the level learning and a re-roll would
     erase it. */
  for (const a of G.agents){ a.born=3.0; }
  hideAll(); STATE='play';
  document.getElementById('hud').classList.add('on');
  syncAmbience();
};
document.getElementById('btn-again').onclick = ()=>{
  rollRunSeed();                 // a new run deserves a new building
  document.getElementById('btn-start').click();
};

/* ============================================================
   LOOP
   ============================================================ */
let last = performance.now();
function frame(now){
  let dt = (now-last)/1000;
  last = now;
  dt = Math.min(dt, 0.05);

  if (STATE==='play'){ runTime+=dt; update(dt); updateHUD(); setPrompt(); }
  if (G) render(now);

  requestAnimationFrame(frame);
}

/* ---- boot ----
   The store is read BEFORE anything that depends on it, and applySettings
   runs before the first buildFloor so the opening floor is generated with the
   player's depth and repair time already in place. Building the floor first
   and applying after would mean the first floor of a run quietly used NORMAL
   while the menu said HARD. */
resize();
buildPatterns();
buildGlowSprite();
loadSettings();
applySettings();
buildSettingsUI();
syncSettingsUI();
/* The audio graph is built HERE, at boot, and not on the first click of the
   run. Two reasons, and the second is the one that matters: the title screen is
   the only place the splash bed can play at all, and a context created inside
   the CLOCK IN click is already too late to have been the thing that made the
   title sound like a place. The browser will hold it suspended until a gesture
   arrives — Audio_.unlock(), called from the keydown handler and from
   advanceSplash — and everything is built and wired in the meantime. */
Audio_.init();
syncAmbience();
/* The splash plan is the level the first run is built from, so the boot floor
   is built from RUN_SEED instead of a throwaway constant: painting it is then
   a copy of what already exists rather than a second generation of the maze. */
buildFloor(0, RUN_SEED);
paintSplashPlan();
requestAnimationFrame(frame);