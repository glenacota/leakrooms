# THE BACKROOMS

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

**The torch is information only.** It does not repel the entity, does not
stun it, and cannot save you. It is a narrow beam — aim it by facing where you
walk — that reveals exits and scrawled warnings. Battery is a budget you spend
on *knowing*.

**Only the room you are in is lit.** The fluorescents are per room, not per
floor, so the maze is a run of bright rooms separated by dark ones and you
cross between them through gates you can see down. The room you leave goes
dark behind you, over about a third of a second — long enough to read as the
lights being somewhere else, short enough not to lag behind your feet.

This is a *visibility* rule, not a safety one. A dark room is still there, and
so is anything standing in it.

**Noise is the entire stealth layer.**

| action | power | heard within |
|---|---|---|
| walk | 0.22 | ~6.6 tiles |
| walk into a partition | 0.30 | ~7.6 tiles |
| **sprint** | 1.00 | ~16 tiles |
| reveal an exit | 1.30 | ~20 tiles |
| cycle a door | 1.80 | ~26 tiles |

Walls muffle sound by 3 tiles each. **Quiet noise only makes it curious; only
loud noise — or being seen — commits it to a hunt.** So you can walk right past
a sleeping coil pile, but sprint near one and it stands up.

**The rule that makes it a game:** all three exits must be found before you can
descend, and finding each one is loud. You spend light and noise to locate
them, then have to walk back to one without running.

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
| `Shift` | sprint — fast, and very loud |
| `F` | flashlight |
| `Enter` | start / confirm / resume — closes whichever modal is up |
| `Esc` | pause (the modal re-shows the controls and your current depth, exits, battery and lives) |

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
node test.js      # exit 0 = pass, ~70s
```

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
   head, torch glow) is asserted to stay inside the 0.33-tile collision radius,
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
    you standing in a half-dark room.

### Lighting

The bake is per fixture and unchanged: a radius, a line-of-sight test, a 3x3
blur, a floor of 0.42 so nothing is ever pure black, and wall tiles lit from
adjacent floor so a partition reads as a wall rather than a hole. What changed
is a second layer *on top* of it, recomputed when the player crosses into a new
region.

That layer is a BFS over **regions**, not tiles. Tiles would be the obvious
choice and would not work: a gate tunnel is only two tiles wide, so the far side
of a doorway is three tiles away — closer than the far corner of the room you
are standing in. Scoping by tile distance lights the neighbouring room anyway
and the feature is a no-op. A region is a BSP room, or a run of partition-band
floor between two rooms, flood filled as its own lit space, so standing in a
doorway lights the doorway and not either room behind it.

`DARK_ROOM` is a multiplier on the bake, not a brightness. The bake spans 0.42
in a dim corner to about 2.0 under a tube, so anything above roughly 0.15 lets
a dark room's fixture hotspot out-shine your own room's dim corner and the two
stop being distinguishable at all. At 0.14 a dark room sits around a third of
the dimmest lit tile — a clear silhouette, never a void.

Two things that are easy to miss and both were wrong first:

- The flicker pass is `lighter`, which *adds* light on top of whatever the bake
  left. Ungated, it paints every fixture on the floor at full strength, so
  every "dark" room has its tube blazing in it and the scoping is invisible.
- The sight check read the bake. Reading the bake alone lets the entity see you
  standing in a room whose lights are, as far as the screen is concerned, off.

The crossfade is quantised to ten repacks over `LIGHT_FADE`. The lightmap is
76x76 tiles at 4 samples per tile; repacking it every frame for a third of a
second is 116k pixel writes per frame for an effect nobody can see at that
cadence.

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

- **Difficulty is untuned.** A bot cannot tell you whether three lives across a
  ten-minute descent is fun or brutal. That needs a human. Room scoping makes
  this worse before it makes it better: you can no longer see the whole floor,
  so exits are found with the torch rather than by looking, which is the
  intended direction — but it is a change to the light budget and the budget
  has never been tuned.
- Scoping is by region, so it cannot distinguish "the room you are in" from
  "the two rooms joined by a band you happen to be standing in". In practice
  the bands are two to six tiles of corridor, so this reads correctly, but it is
  a coarse instrument rather than a precise one.
- Wall tops are lit from their neighbours rather than self-lit, so a partition
  deep inside a block is flatter than one bordering a room. It reads fine but
  is a simplification.
- The avatar is drawn to fit a 0.33-tile disc, which at normal zoom is a small
  figure. It is legible, but a bigger player would need either a smaller
  collision radius or wider corridors.