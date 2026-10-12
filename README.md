# LEAKROOMS

A 2D top-down puzzle / stealth prototype. Plain HTML, CSS and JavaScript — no
build step, no dependencies, no image or audio assets. Every texture is drawn
procedurally and every sound is synthesised with the Web Audio API.

Open `index.html` in a browser. (A local server is optional:
`python3 -m http.server` then visit `/index.html`.)

---

## The design

Faithful to the original 2019 4chan description rather than the expanded
fandom wiki: six hundred million square miles of randomly segmented empty
rooms, mono-yellow, no level names, and an entity that is never named on
screen.

**You are a plumber.** A riser has burst somewhere on every floor and the water
is climbing. You do not know where. The radar cannot help with that — it
reveals exits and nothing else, and it is not going to start knowing about
plumbing. The water will tell you. Finding the break is the first half of the
job; standing still next to it for five seconds while something walks toward
the noise of you doing exactly that is the second.

**The radar is information only.** It does not repel the entity, does not stun
it, and cannot save you. A sweep lights the entire floor at once — no dark
spots anywhere, including the 80 degrees behind you — and it reveals exits and
scrawled warnings as they come on screen. Battery is a budget you spend on
*knowing*, and the radar spends it fast: **5.6/s, so a full battery is eighteen
seconds of seeing everything.** The torch it replaced drained 2.4/s and could be
held indefinitely, which made the budget a formality rather than a decision.

**Only what you can see is lit.** The world is drawn in five colours — the
mono-yellow of the original — and the lights are per room, so the maze is a
run of bright rooms separated by black ones. On top of that the character has a
**200 degree cone of vision** that stops at walls, so there is always 80 degrees
of blindness behind you and turning is how you check behind you. What is inside
the cone and inside a lit room is the palette at full strength. Everything else
is black: rooms you are not in, the 80 degrees behind you, and anything a
partition hides.

The radar overrides all of that while it is on. That is the trade, and it is the
only reason the cone is tolerable: you are blind in the dark, so sweeping is
how you find the doors, and the doors are loud, and you still have to walk to
one.

This is a *visibility* rule, not a safety one. A dark room is still there, and
so is anything standing in it.

### The palette

Every surface in the game is one of five colours, and there is no other hue
anywhere in the world:

| | | role |
|---|---|---|
| `#e4e6a8` | 228,230,168 | brightest — the lit face of a partition |
| `#e1e2bb` | 225,226,187 | pale — wallpaper mid-tone |
| `#d6dea7` | 214,222,167 | the skirting end of a wall face, and the avatar's head |
| `#c3cb6e` | 195,203,110 | **the carpet** — the saturated one, the colour it is named for |
| `#c6c58b` | 198,197,139 | wall tops, seen from above |

The last one is the interesting choice. Wall tops have to separate from the
carpet without going dark, and `#c6c58b` sits within two points of luminance of
`#c3cb6e` — it is separated by *saturation*, not brightness, backed up by the
dark edge strokes along every wall/carpet boundary. The canvas and `style.css`
share these five values, so the shell and the game are one palette rather than
two that happen to be yellowish.

**The water is the one deliberate exception.** It has to be: it is the mechanic,
and a flood you cannot see is a flood you cannot follow. It is applied as an
alpha tint over the carpet rather than as a replacement for it, so a wet tile
is still that carpet — darkened, and only eventually cool enough to read as
water. Nothing else in the world is allowed a second hue, and the one blue in
the HUD (`#8fc4cc`, the flood gauge) is the water's own colour, borrowed for
the one meter that describes it.

**Noise is the entire stealth layer.**

| action | power | heard within |
|---|---|---|
| walk | 0.22 | ~6.6 tiles |
| walk through standing water | 0.30 | ~7.6 tiles |
| walk into a partition | 0.30 | ~7.6 tiles |
| the leak, dripping (rising as the floor drowns) | 0.16 → 0.42 | ~6 → ~9 tiles |
| **sprint** | 1.00 | ~16 tiles |
| **wrench the pipe** | 0.85 | ~14 tiles |
| reveal an exit | 1.30 | ~20 tiles |
| cycle a door | 1.80 | ~26 tiles |

Walls muffle sound by 3 tiles each. **Quiet noise only makes it curious; only
loud noise — or being seen — commits it to a hunt.** So you can walk right past
a sleeping coil pile, but sprint near one and it stands up.

**The rule that makes it a game:** all three exits must be found *and* the riser
sealed before you can descend. Finding each exit is loud. Sealing the riser is
louder than running. The two halves pull in opposite directions — the radar
finds the doors and costs battery, the water finds the pipe and costs nothing
but the walk — and you cannot do both at the same time.

---

## The leak

One wall tile per floor, as far from where you spawn as the geometry allows
(capped at 46 tiles straight-line — see below). It is the only object in the
game that is not gated by the cone, and it is still not the radar: it reveals
one tile you are already standing next to, costs no battery, and does nothing
at all from two rooms away.

**The water is the cue, and it costs nothing.** Water runs downhill *away* from
the break and nowhere else, so the wet trail is a path to the source that
spends no battery and makes walk-level noise. Walking it is slightly slower
(20%) and slightly louder than dry carpet — and still under `LOUD`, because if
following the water were strictly worse than sweeping, nobody would ever follow
it. The radar is the expensive way to learn where the doors are; the water is
the free way to learn where the pipe is. They are deliberately not comparable.

**The leak is a standing noise source, and that is the trap.** A leak that only
flooded the floor would be scenery. One that gurgles pulls the Lifeform to the
pipe — a shield while you are finding it, because something standing over the
break is not standing over you — and a fixed ambush for the repair, because you
know where it is coming from. Its power rises with how much of the floor is
underwater, but it is clamped below `LOUD` no matter how bad it gets: above
that it stops being a lure and becomes a floor-wide hunt trigger, and the
repair would have nothing left to be tense against. It only ever diverts an
entity that is already `SEARCH`ing. A hunting one ignores it entirely — if it
did not, sprinting would no longer be a decision, and the noise layer would be
gone.

**The repair is five seconds of standing still.** Move and the bar decays at
2.6 whole-bars per second, so leaving after four seconds throws away the lot
and hesitating at the pipe is a mistake you have to pay for. Wrenching is
0.85 — louder than sprinting, the loudest thing you will do on a floor other
than cycle a door — and it wakes a Lifeform that is standing on the pipe with
you. You are choosing to be immobile and loud, next to the noisiest thing in
the building, with something already on its way.

**Dripping is the audio half of the cue**, and it is separate from the visual
one on purpose: the water tells you where to go, the drip tells you that you
have arrived, and a player who has been squinting at wet carpet for two
minutes gets a second channel at the moment the first one has done its job.

### How the water spreads

`waterDist` is a BFS from the pipe over walkable floor, and a tile's target
wetness is exactly `distance <= front` where the front advances at
`LEAK_SPREAD`. That is the whole physics: water runs downhill, so a distance
field *is* the simulation, and a diffusion model would only add a parameter to
get wrong. It also means the flood cannot depend on frame timing — two machines
at different frame rates flood identically.

Wetness integrates toward that target with a time constant rather than snapping
to it, so the waterline creeps instead of teleporting a tile at a time. Sealing
the pipe runs the same mechanism backwards: the front retreats at one tile per
`WET_FALL` second, so the water recedes from the edges inward, away from the
pipe, rather than fading uniformly.

Three bugs in here were each invisible to the suite and obvious on screen:

- Only the band the front swept was being integrated, on the reasoning that a
  tile's *target* only changes there. True, and wrong: a tile keeps darkening
  for `WET_RISE` seconds *after* the front passes it. The floor sat at 10%
  wetness forever and read as permanently damp.
- The band's end was computed as `ceil(front)`, treating the BFS array index
  as a distance. They are not the same thing — a hundred tiles can share
  distance 17 — so the flood was truncated to the first hundred tiles of a
  3700-tile floor. There is now a distance→index table.
- The colour was chosen by picking something that looks like water *in
  isolation*. It has to be chosen by solving for what the tile looks like
  **over the carpet**: damp composites to roughly (135,139,81), about 30%
  darker than dry, and standing water to about (78,105,104), where blue beats
  red by enough to read in a dark corridor. An earlier pass darkened it further
  and a flooded tile became indistinguishable from an unlit one, which defeats
  the entire mechanic.

The leak is placed by straight-line distance with a **46-tile cap**, and the cap
is load-bearing. Sorting by Euclidean distance and taking the extreme corner
looks correct on paper and is wrong in a maze: a tile 70 tiles away in a
straight line can be 200 tiles of corridor to actually walk, because a BSP
floor is a tree and the winding is the point. Uncapped, the repair became a
two-minute trudge — not tension, a commute.

### The Lifeform

A tall figure of coiled black wire. Dormant, it is a flat pile of loops on the
carpet. It rises over 1.4 seconds when it hears you — that animation is your
window. It hunts by sound and by sight, but only sees you when you are standing
in light. Dying to something idling in a corridor is a gotcha rather than
tension, so brushing a loitering entity startles it into a chase instead.

Three lives for a full descent.

---

## Controls

| key | |
|---|---|
| `WASD` / arrows | move |
| `Shift` | sprint — fast, and very loud (hold or toggle, per settings) |
| `R` | radar — lights the whole floor, burns battery fast |
| *(nothing)* | **the repair has no button. Stand at the pipe and do not press anything.** |
| `Enter` | start / confirm / resume — closes whichever modal is up |
| `Esc` | pause (the modal re-shows the controls and your current depth, exits, battery, riser state and flood level) |

---

## Settings

Reachable from the title screen and from pause, and stored in
`localStorage` under `backrooms.settings.v1`. Nine options:

| | |
|---|---|
| **Difficulty** | Relaxed / Normal / Brutal — see below |
| **Fluorescent flicker** | Off / Reduced / Full |
| **Volume** | master gain |
| **Tape degradation** | grain, scanlines, tracking bands, chroma ghost, dropouts |
| **Camera shake** | scales the camera jitter and breathing |
| **Water tint** | Slate / Teal / Violet / **Grey** |
| **Water contrast** | 0.4x to 2x on the tint alpha |
| **Sprint** | hold or toggle |
| **Frame counter** | on / off |

Changes apply immediately — there is no OK button, because a slider that only
commits on confirm makes people wonder whether it saved. Opening settings
mid-run also pauses the game, so a Lifeform cannot eat you while you read.

**Why difficulty is presets and not sliders.** A preset moves *counts and
spacing*: lives, floors, `REPAIR_TIME`, and the Lifeform's chase speed.

| | lives | floors | repair | chase |
|---|---|---|---|---|
| Relaxed | 5 | 4 | 7.0s | 2.90 + 0.26/floor |
| Normal | 3 | 5 | 5.0s | 3.45 + 0.34/floor |
| Brutal | 1 | 6 | 4.0s | 4.05 + 0.42/floor |

None of them touches the noise table, and that is the discipline rather than an
oversight. `LOUD` is the design contract — quiet noise only makes it curious —
so a difficulty control that could push a walk or a wading step above it would
let a player configure the stealth layer out of existence. The suite asserts the
noise constants are byte-identical across all three presets, and that
`LEAK_NOISE_BASE + LEAK_NOISE_GAIN` still lands under `LOUD` in every one.

This is also the tuning instrument. With the monster present, test 4b clears 0
of 6 and never leaves floor 1, and a bot cannot tell you whether the repair is
too dangerous or the bot is bad at it. Presets do not tune anything; they make
the question *askable*.

**Why the water is configurable at all.** The leak is the only non-yellow hue
in the world and it is the entire cue. A player who cannot separate slate from
yellow-olive cannot play the mechanic, and had no way to say so. `Grey` drops
the hue entirely and keeps only the value difference. The contrast slider is
the same idea for low-contrast displays.

**Persistence is defensive on purpose.** The store validates per field against
a schema, so a stale blob from an older build, a hand-edited value, or a
half-written one degrades *that field* to its default and leaves the rest
intact. `loadSettings()` always loads over the defaults rather than over
whatever is live, so its result is a total function of the blob and does not
depend on when it was called. Every access is wrapped: `localStorage` is absent
in the headless suite, throws on some `file://` origins, and can be disabled
outright in private browsing, and a settings screen is never allowed to be the
reason the game does not start.

---

## Files

| | |
|---|---|
| `index.html` | markup + the recovered-tape UI |
| `style.css` | mono-yellow palette, CRT/tape treatment |
| `game.js` | the whole game |
| `test.js` | headless regression suite |

---

## Tests

```
node test.js      # exit 0 = pass
```

This takes **about 80 seconds**. It used to take **fifteen minutes**, and
nothing said so — every line of output was timestamp-free, so the fact that one
test was 87% of the wall clock stayed invisible until it was profiled. Every
banner now prints the time since the previous one, and the five slowest
sections are summarised at the end.

The fifteen minutes were almost entirely work nobody was asking for.
`packMask` and `packWet` repack two 5776-tile images every frame, and
`traceViewCone` fires 240 rays per frame, all to feed a canvas. The headless
harness has no canvas. Measured, that was 48% of the suite's CPU. `game.js` now
exposes `setHeadless(pixels, vision)`; the suite switches both off and switches
back on for the tests that actually read them — tests 12 through 19 need the
vision half, and test 17 is the only one that reads a packed image back as
pixels. **This changes what the suite pays for, not what the game computes.**
Every assertion still runs against the real arrays, and the game itself never
sets either flag.

What deliberately did *not* get faster: the simulation step is still `1/60`.
Dropping the bot loops to `1/30` saves 8 seconds and weakens exactly the
collision fidelity test 4 exists to check, which is a bad trade. `buildFloor`
is 20% of what remains and is not memoised, because no two call sites use the
same `(floor, seed)` pair — the seeds are all distinct by construction.

`game.js` is DOM/canvas-coupled, so `test.js` stubs enough of both to load the
real module and drive its real logic — maze generation, the ambient light bake,
line of sight, the noise layer, entity AI and the descend flow. It reimplements
nothing, and its two collision oracles are written from scratch rather than
calling the game's own `blocked()`, so the two have to agree independently.

What it actually checks:

1. **Maze integrity** over 400 floors — single connected region, exactly three
   reachable exits, no NaN in the light bake, sane lit-room coverage.
2. **Collision** over 20 000 random-walk frames against an independent oracle.
3. **Entity AI** over 20 000 frames — hunts, never leaves geometry.
4. **End-to-end playthroughs** — a bot drives real key state through the real
   `update()`, which proves the game is *finishable* and the light budget is
   survivable. It is a weak player, so its death rate is reported but is not a
   difficulty signal.
5. **Render** — 400 full frames with no exceptions.
6. **Configuration-space connectivity** — the strongest of these. Tile
   connectivity is not navigability: a one-tile corridor can be connected on the
   grid and still trap a disc of the player's radius. This samples the
   collision disc across free space at quarter-tile resolution and flood-fills
   it. All 1 742 752 free positions across 25 floors are reachable from spawn,
   which is a guarantee that **no position on any generated map can soft-lock
   the player.**
7. **Camera mapping** — asserts the player's tile lands at the viewport centre,
   that a fixed world point moves the *opposite* way on screen to the direction
   of travel, that `SCALE` is applied exactly once (10 tiles spans exactly
   10·TILE·SCALE), and that the light bake shares the geometry's origin.
8. **Avatar fits the collision disc** — every drawn part (shadow, torso, arms,
   head, radar glow) is asserted to stay inside the 0.33-tile collision radius,
   that the beam origin is a forward offset rather than the body centre, and
   that the avatar and agents are drawn at their *true* positions rather than
   offset by half a tile.
9. **Wall contact does not accelerate** — pushing into a wall for a simulated
   second must not move the avatar faster along the wall than it walks, and a
   sprint in the open must still reach full speed.
11. **Room shape and gate size** — asserts room area never exceeds 120 tiles,
    many small rooms per floor, that openings through wall bands are mostly
    2 tiles wide rather than 1-tile pinholes, and that no room is effectively
    sealed. This encodes the brief directly: small rooms, flowing into one
    another through ~2-tile gates.
10. **Pressing into a wall produces no lateral drift and no teleport** —
    holding a direction into a wall must not move the avatar sideways at all,
    no single frame may jump more than 0.2 tiles, and the avatar must end up
    flush (centre-to-face distance == collision radius, not sunk in and not
    short). Checked for up, left and right.
12. **Room-scoped light** — the feature is two layers and the second is where
    the bugs live. The ambient bake is per fixture and is asserted unchanged by
    test 1; the scope layered on top is asserted per region over 120 floors:
    the region you are standing in is fully visible, a region one gate away
    gets exactly the spill allowance and no more, everything beyond is dark,
    and your room is more than twice as bright as the ones past it. It also
    asserts the failure modes that would each silently break the feature: a
    wall darker than the brightest floor it touches (a partition becomes a black
    hole punched through a lit room), a floor tile belonging to no region, a
    disconnected region graph, the bake mutated in place instead of copied, a
    scope computed once at floor build that never follows the player, and a
    crossfade that either swaps on a single frame or never settles and leaves
    you standing in a half-dark room. It also pins the falloff table itself —
    strictly decreasing, and dim but non-zero at the far end — and asserts that
    sight survives **down a straight corridor**: on a 40-tile clear run the mask
    must still be lit 18 tiles out. That is the regression this falloff exists
    to prevent, and the old step-function assertion could not see it.
13. **Cone of vision** — 200 degrees, stopped by walls. Asserts that the cone
    *rotates* (the set of visible tiles must genuinely depend on facing), that
    floor directly ahead is lit and floor directly behind is not, and — the one
    that matters — that tiles with no line of sight are never visible. That last
    case is invisible in aggregate statistics: a one-tile partition stub is 1
    tile out of 5776, so a cone that ignores walls still passes every brightness
    check. The oracle is deliberately *neither* the game's voxel walk nor
    Bresenham — it samples the sightline finely and asks whether any line
    reaches a disc inside the tile, because the two traversals disagree by a
    tile exactly at the corners where the question is interesting. It also
    asserts the mask is the function the renderer depends on, and that **no
    visible tile in your own room is ever dimmed** — the distance falloff must
    not touch the room you are standing in.
14. **The radar** — off by default, total while on, expensive. Asserts it starts
    off, that a full battery buys under 25 seconds of sweep, that it drains at
    exactly the stated rate and stops at exactly zero rather than going
    negative, that **all 5776 tiles** are lit while it is on and none are dark,
    and that switching it off puts the cone's blindness back. Then the reveal
    rule itself, which is now the entire exit economy: placed where an exit is
    off screen it must not be found; placed where it is on screen it must be.
    That is checked by *placing* the player rather than by walking it there,
    because driving `G.player` in a straight line fights `unstick()` and the
    test ends up measuring the collision code instead of the rule. It also has
    to reset the found flags between cases: a sweep reveals every exit on
    screen, not just the one under test, so a negative case otherwise inherits
    a reveal from the previous one.
15. **The leak** — over 200 floors, every leak is on a wall and every repair
    spot is floor the player can physically stand on. Then the water field: no
    wall tile is inside it, no floor tile is outside it, and no pair of
    neighbouring tiles violates `|d(n) − d(i)| <= 1` (a BFS that skipped a tile
    produces a front that jumps, and the symptom is water arriving in a distant
    room before a nearer one). Then that the flood rises, stays inside 0..1,
    never wets a wall, and that **the incremental flood gauge matches a full
    re-sum to 1e-6** — it is read every frame by the leak's noise level and the
    HUD and the game no longer recomputes it, so a drifting incremental sum is
    invisible everywhere else: the tiles would be exactly right and the number
    would be wrong. Finally, that **the leak never reaches `LOUD`**, over 1200
    frames of a floor drowning. That is the whole lure contract.
16. **The repair** — it takes exactly `REPAIR_TIME` seconds to within a frame,
    a sealed pipe cannot be re-wrenched and cannot make noise, leaving decays
    the bar and a full bar is gone within two seconds, a Lifeform lying on the
    pipe wakes to the wrench, the door **stays shut** with all three exits found
    and the pipe open, and opens once it is sealed. The last pair is the one
    that matters: without the negative case, "the door opened" would pass even
    if the gate were not the leak at all.
17. **The water as a cue** — it is asserted on the *packed pixels*, not on the
    simulation, because a wet tile that packs to alpha 0 leaves every other
    assertion in the suite passing while rendering a clean dry floor. That this
    is exactly the bug class test 5 cannot catch, which is why the flood
    canvas's `putImageData`/`getImageData` now round-trip in the stub. Then
    that following the trail is free next to sweeping, that wetness strictly
    decreases with distance from the pipe, and that wading really is slower.
18. **End-to-end with the repair** — a second bot drives real keys to the pipe,
    holds still, and descends. The first bot only chases exits and can now never
    finish, which would have turned test 4 into a permanent 0/8 and quietly
    stopped testing whether the game is winnable at all.
19. **The leak is drawn where it is.** The leak visual was absent from every
    frame of test 5's 400 renders. It was filled with *world* coordinates in
    the one pass that runs after `ctx.restore()`, so it landed at raw pixel
    1360 on a 1218px canvas — right size, right colour, correct mask, and
    completely off screen. Nothing about that arithmetic looks wrong, and no
    exception is thrown. This asserts the pipe's projected device position is
    on the canvas and that something is actually painted there.
20. **Settings.** The defaults are a complete and valid schema. The store
    round-trips every field. A blob of deliberate nonsense — a bad enum, a
    string where a range belongs, `NaN`, an out-of-bounds contrast — keeps its
    one legal field and rejects the rest **individually**, because a settings
    screen that throws away everything over one bad value trains people to
    distrust it. Unparseable, non-object, and absent blobs all fall back. And
    **a `localStorage` that throws on every access is survivable at every entry
    point**, which is the case that actually happens in a browser. Then the
    contract: all three difficulty presets leave `LOUD`, the wrench power, and
    both leak noise constants byte-identical, and the preset values genuinely
    reach `FLOORS` and `REPAIR_TIME` rather than sitting in the store.

### Lighting

Lighting is two layers, and they do completely different jobs.

**The bake** is per fixture and is a pure brightness: a radius, a line-of-sight
test, a 3x3 blur, and a floor of `BAKE_FLOOR` — which is 1.0. That number used
to be 0.42, and it was low because the bake used to be the only thing deciding
brightness and a floor had to stop the darkest corner of a lit room collapsing
into black. Darkness moved onto the mask, so the floor could go to 1.0: a
surface you can see is the palette at full strength, unmodified. The bake is
also neutral grey now, not tinted `(255,246,186)` with a warm `+18` lift —
tinting it would double-count a hue the surfaces already carry. Variation
inside a room comes from the additive fixture pass, not from dimming everything
else.

**The mask** is what the viewer can see, folded into one array and multiplied
once. Three terms:

| term | what it is |
|---|---|
| radar on | everything, full brightness — no scope, no cone, no falloff |
| room scope | a BFS over **regions**, falling off by gates crossed |
| distance | 1.0 at 13 tiles to 0.0 at 31 — your own room excluded |
| cone | 200 degrees, stopped by walls |

`mask = radar ? 1 : scope × distance × cone`

There is exactly one place in the program that decides this, and the radar is
the first thing it checks.

**Why the radar is not a beam.** It replaced the torch, which was a narrow
aimed cone and its own term in this mask. A tool that lights the whole floor
does not need to be aimed, so it is not: while it is on the mask is uniformly 1
and there is nowhere dark left. It is also, notably, *not* clipped to the 200
degree cone — a sweep goes everywhere or it is not a sweep.

**Why the torch had to move into the mask, and the radar then did not have to
move at all.** The torch was its own additive pass drawn after the lighting.
That was correct while unlit rooms still had geometry under them. Once dark
rooms went black it became a bug with no visible cause: the multiply had
already reduced those rooms to zero, so an additive beam was painting a yellow
haze onto an empty frame — a glow with no room in it, which reads as a
rendering fault. Putting it in the mask fixed that. The radar replaced it, and
a whole-floor reveal is just `mask = 1`, so there is no beam left to place.

**Why the scope is a falloff, not a cliff.** It started as one: your room 1.0,
one gate away 0.30, everything beyond hard zero. That is what you want between
*rooms* — but a corridor is itself a band region, so on a measured 40-tile
straight run the floor went black at 10 tiles while dead ahead, in line of
sight, inside a 200 degree cone. You could not see down a hallway in your own
house. The rule is now `1.00 → 0.62 → 0.40 → 0.26 → 0.17 → 0.11` by gates
crossed, which keeps a room two gates away plainly darker than yours (6.5x,
asserted) while letting light arrive continuously instead of stopping at a
boundary you cannot see.

**And why there is also a distance falloff.** `1.00` at 13 tiles to `0.00` at
31, applied *only* outside your own room. Without it a 40-tile corridor stays at
11% all the way to the far wall and reads as a lit pipe rather than a corridor
receding into the dark. It is skipped for your own region on purpose: that room
is at most 12 tiles across, and dimming the far corner of the room you are
standing in is the one thing this whole feature must never do. Test 13 asserts
that no visible tile in your own room is ever dimmed.

**Why the scope is a BFS over regions.** Tile distance would be the obvious
choice and would not work: a gate tunnel is two tiles wide, so the far side of a
doorway is three tiles away — closer than the far corner of the room you are
standing in. Scoping by tile distance lights the neighbouring room anyway and
the feature is a no-op. A region is a BSP room, or a run of partition-band
floor between two rooms, flood filled as its own lit space, so standing in a
doorway lights the doorway and not either room behind it. Walls carry no
region and take their brightest floor neighbour instead — labelling whole room
rects swept up the stub partitions and left walls darker than the floor they
bordered.

**Why the cone is a ray cast.** A per-tile angle test is O(5776) every frame
and is also wrong: it lights the floor on the far side of a one-tile partition
stub, which is the case the ray cast gets right and the angle test does not.
The traversal is an exact voxel walk rather than a fixed-distance sample,
because sampling skipped walls it was clipping for a 0.4-tile sliver and lit
the pocket behind them — 15 tiles out of 1722, invisible in any aggregate
brightness number. A tile only counts as seen if the ray passes within
`VIEW_MID` of its *centre*, so a tile you can only see the corner of counts as
hidden rather than lit.

Four things in here were wrong before they were right, and each is a trap
rather than a typo:

- The flicker pass is `lighter`, which *adds* light on top of whatever the bake
  left. Ungated, it paints every fixture on the floor at full strength, so every
  "dark" room has its tube blazing in it and the scoping is invisible.
- The sight check read the bake. Reading the bake alone lets the entity see you
  standing in a room whose lights are, as far as the screen is concerned, off.
- A 3x3 blur over the final mask ate the middle of vision. Averaging the
  player's own fully-lit tile with the dark tiles around it measured **0.55
  underfoot** — the character stood in a dimple in the middle of a lit room.
  Any average of a field with hard zeros in it eats into the lit side of every
  edge. There is no blur now; the 76x76 mask is bilinearly upscaled at draw
  time, which softens edges across about a tile without leaking.
- The mask dimmed walls by 10% "so they would read as walls", which is
  backwards. They already read as walls — different texture, and the bake floors
  them at 80% of the carpet. Dimming them twice left them measurably darker
  than the floor in front, which is the signature of a hole.

The cone deliberately has **no falloff of its own**. It is a statement about
angles and occlusion only; brightness falloff is a separate term, so a tool can
have one and your own room cannot.

The room crossfade is quantised to ten repacks over `LIGHT_FADE`. The lightmap
is 76x76 tiles at 4 samples per tile; repacking it every frame for a third of a
second is 116k pixel writes per frame for an effect nobody can see at that
cadence. The mask is a separate 76x76 canvas so that turning — which changes the
cone every frame — costs 5.8k writes instead.

### Level generation

BSP subdivision driven by a **size ceiling**, not a depth counter — a fixed
depth ran out of budget while cells were still ~18 tiles across, so every
floor kept at least one room big enough to read as an empty field. Each cell
is cut along its longer axis until it is at most 12 tiles, then carved as a
room with an uneven 1-2 tile inset, so the band between neighbours stays thin
and rooms read as linked rather than sealed.

Every split punches a **2-tile gate** through the partition and tunnels it
until it breaks into a room on each side, and ~45% of splits punch a second
gate, so rooms chain rather than dead-end. Gates carry an explicit axis: a
vertical partition takes a gate that straddles *columns*, a horizontal one
straddles *rows*. (Those two were previously swapped, so gates landed beside
the wall they were meant to pierce and the connectivity repair masked it by
tunnelling diagonal holes through partitions.)

Larger rooms then get extra partition stubs, 1-2 tiles thick and dead-ending
partway across. These break up open carpet and make alcoves without dividing
a room in two, which could strand one half and force the repair pass to tunnel
a visible hole. Stubs are placed away from each room's centre so the player
never spawns inside one, and fixtures, batteries and graffiti all pick
validated floor tiles rather than blind random coordinates.

### Movement model

Collision is a circle against tile AABBs. A move tries the full step, then
slides on each axis in turn, and only treats the position as wedged when a
*diagonal* press finds every axis blocked.

Two earlier attempts at a "corner assist" were removed rather than tuned. A
fixed perpendicular nudge slid the avatar sideways at ~18 tiles/second on
contact, and a step-bounded one still preferred `+x` on every blocked axis, so
holding up against a wall walked the avatar right until it left the screen.
If your circle overlaps a wall corner, stopping is correct — you round the
corner by pressing the other direction too, which the axis-only fallback
already handles.

### Verified in a real browser

Test 7 came from a build that was unplayable despite passing tests 1–6. Three
bugs only a rendered frame could reveal:

- The camera offset mixed a pre-scaled value with a device-space one and
  carried `SCALE` twice, so the world panned the wrong way and the player left
  the screen.
- The chroma ghost drew the canvas *onto itself* with `lighter`, feeding back
  each frame's ghost into the next until the image desaturated to flat white.
- Fixture radii were `f.r * T * T` — `T` squared — making every light a
  19 000px disc that saturated the entire frame.

Checked after the fix: moving right raises world-x while a fixed landmark
slides left on screen, mean luminance 97/255, 0.1% clipped, 2% near-black,
33% wall coverage around the player.

### Known gaps

- **Difficulty is untuned, and the leak makes that worse before it makes it
  better.** A bot cannot tell you whether three lives across a ten-minute
  descent is fun or brutal. That needs a human. Room scoping already made this
  worse before it made it better: you can no longer see the whole floor, so
  exits are found with the radar rather than by looking. The leak adds a second
  untuned cost to the same floor — a five-second immobile commitment next to a
  noise source — and it was tuned before anything else in the game had been.
  The numbers that matter and have never been played by a human are
  `REPAIR_TIME` (5.0s), `REPAIR_DECAY` (2.6 bars/s), `LEAK_SPREAD` (1.4s per
  tile, so a floor drowns in about three and a half minutes) and `LEAK_FAR`
  (46 tiles).
- **The repair is a death trap, and the bot walks straight into it.** With the
  monster present, test 4b now clears **0 of 6** runs and never gets past the
  first floor. The bot walks to the pipe and holds still for five seconds at
  0.85 noise without ever checking whether something is coming, which is
  precisely the mistake the mechanic is designed to punish. A human who scouts
  the pipe first and repairs during a lull is playing the intended game; the
  bot is not. But this is the one number here that should be read as a
  difficulty *warning* rather than dismissed as bot incompetence — the
  mechanic's whole risk budget is one immobile, loud commitment, and it has
  never been played by anyone.
- **The flood has no gameplay consequence for the entity.** Water slows you by
  20% and makes your footsteps louder; it does nothing to the Lifeform. Making
  deep water slow *it* would make a flooded room a place you can briefly hold
  ground in, which is the obvious next idea and was left out because it
  interacts with `LOUD` thresholds in ways that need playtesting first.
- **The leak is not re-rolled on death**, deliberately: the retry keeps the
  seed, so the pipe is where you left it. That means dying does not cost you
  the flood either, which is generous, and is the opposite of the ratchet the
  mechanic was sketched with.
- Scoping is by region, so it cannot distinguish "the room you are in" from
  "the two rooms joined by a band you happen to be standing in". In practice
  the bands are two to six tiles of corridor, so this reads correctly, but it is
  a coarse instrument rather than a precise one.
- **The vision cone makes a hunting entity much harder to see.** It is not
  visible at all until it enters the cone or crosses a threshold into your
  room, which puts it on the same footing as the exits you now have to sweep
  for. The proximity drone and the red `seenBy` vignette are the only warnings
  that something is close. This was a deliberate trade — a dark room with a
  plainly visible silhouette is not a dark room — but it makes the untuned
  difficulty worse before it makes it better, and it has not been played by a
  human.
- The cone is a per-tile mask upscaled bilinearly, so the boundary of vision
  is quantised to the tile grid and a gate two tiles wide can either vanish or
  sit stubbornly in view depending on how it lines up with the ray fan. It is
  smooth enough in motion that this has never been visible in play, but a
  sub-tile field would fix it properly.
- Wall tops are lit from their neighbours rather than self-lit, so a partition
  deep inside a block is flatter than one bordering a room. It reads fine but
  is a simplification.
- The avatar is drawn to fit a 0.33-tile disc, which at normal zoom is a small
  figure. It is legible, but a bigger player would need either a smaller
  collision radius or wider corridors.