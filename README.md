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
| `Esc` | pause |

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