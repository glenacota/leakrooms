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
  ten-minute descent is fun or brutal. That needs a human.
- Wall tops are lit from their neighbours rather than self-lit, so a partition
  deep inside a block is flatter than one bordering a room. It reads fine but
  is a simplification.
- The avatar is drawn to fit a 0.33-tile disc, which at normal zoom is a small
  figure. It is legible, but a bigger player would need either a smaller
  collision radius or wider corridors.