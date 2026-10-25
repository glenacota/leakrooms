# AGENTS.md

## Project Overview

LEAKROOMS is a 2D top-down puzzle/stealth game written in vanilla JavaScript (native ES modules) with HTML5 Canvas and Web Audio API. It features **zero external dependencies, no build step, and no external assets**—all visuals are procedurally rendered or styled via CSS, and all audio is synthesized at runtime.

Players repair burst pipes across 5 fixed levels while avoiding sound-hunting lifeforms, utilizing water trails as environmental clues and a power-draining radar as their sole active tool.

---

## Tech Stack

* **Language**: JavaScript (`ES2023+`, native ES modules, `"type": "module"`)
* **Runtime**: Browser (requires static HTTP server via `npm run serve` due to CORS) and Node.js $\ge$ 20 for headless tests
* **Graphics**: HTML5 Canvas 2D (procedural textures, baked lightmaps, per-tile flood, visibility masks)
* **Audio**: Web Audio API (synthesized voices, ambient beds, drone, noise floor — zero samples)
* **Testing**: Node.js built-in test runner (`node --test`), parallel file execution, headless with stubbed DOM/Canvas/Audio
* **Tooling**: None (no bundlers, transpilers, or npm packages)

---

## Architecture

```text
src/
├── main.js              # Entry point: imports boot() and calls it
├── boot.js              # Composition root: wires all modules, builds floor 0, starts loop
├── sim/                 # Pure simulation (NO imports from render/, ui/, game/, audio/)
├── render/              # Canvas drawing (imports sim/ for state only)
├── game/                # Run state machine & fixed-step loop (NO renderer, NO DOM)
├── ui/                  # DOM, screens, HUD, input, settings
├── audio/               # Synthesized audio (engine + voices + ambience)
├── config/              # Constants, levels, palette, presets, tuning
├── settings/            # Schema + localStorage persistence
└── util/                # RNG (mulberry32), hash, grid, events, view

css/                     # Stylesheets in cascade order: tokens.css → base.css
tests/
├── unit/                # One file per architectural area
├── integration/         # Playthrough, render trace vs. golden, full-draw soak
└── helpers/             # Harness (DOM/canvas/audio stubs), api.js, bot, soft-assert

```

**Layer Enforcement** (verified in `tests/unit/layers.test.js`):

* `sim/`, `util/`, `config/` → **never** import `render/`, `ui/`, `game/`, or `audio/`
* `game/run.js`, `game/loop.js` → **never** import `render/`, `ui/` or touch `document`
* Only `boot.js` crosses layers; nothing imports `boot.js` back.

### Key Files to Know

| File | Purpose |
| --- | --- |
| `src/boot.js` | Composition root (wiring order is strict) |
| `src/sim/state.js` | `G` facade Proxy (read/write forwards to domain objects) |
| `src/sim/update.js` | Fixed tick order: clock → battery → movement → vision → flood → leaks → lifeforms → radar → door → audio |
| `src/game/run.js` | Run state machine (`splash |
| `src/game/loop.js` | Fixed-step loop, error boundary (3 strikes → fatal) |
| `src/render/adaptive.js` | Adaptive resolution: the render target the frame budget allows |
| `src/render/render.js` | Camera, pass orchestration, device/world transforms |
| `src/config/constants.js` | **Frozen** `NOISE` (stealth contract) |
| `src/config/levels.js` | 5 fixed levels: `[{leaks, forms}, ...]` |
| `src/util/events.js` | Tiny event bus (simulation emits; UI/audio subscribe) |
| `tests/helpers/harness.js` | Headless boot stubbing globals; returns `{A, G, press, ...}` |
| `src/sim/path.js` | Walking-distance field over floor tiles; pure, no RNG, headless-safe |
| `src/ui/touch.js` | Touch layer: floating stick, radar and pause buttons |
| `src/ui/touch-hud-rules.js` | Rules for when the HUD panel shows in touch mode |
| `src/ui/haptics.js` | Short vibration pulses for danger sounds |
| `src/util/stick.js` | Thumb-stick to movement vector: dead zone, speed rescale, sprint hysteresis |

### Key Patterns

* **Facade State (`G`)**: A `Proxy` over domain objects (`level`, `leak`, `plumber`, `lifeform`, `flood`, `vision`, `noise`, `clock`, `door`) built by the factories in `sim/state-domains.js`, enabling clean floor hot-swapping via `installFloorState()`.
* **Event-Driven Decoupling**: Simulation emits facts (`stat`, `caught`, `clock:out`, `door:cycled`, `sfx`) via `util/events.js`; UI and audio layers subscribe.
* **Deterministic RNG**: `mulberry32` PRNG seeded per floor (`RUN_SEED + floorIdx`). Essential for reproducible simulation tests.
* **Headless-First**: All simulation and render modules load seamlessly in Node.js using global stubs, allowing tests to drive real `update()` and `render()` pipelines.

---

## State Model

* **`G`** (`sim/state.js`): Per-floor state facade Proxy. Replaced entirely on `buildFloor()`.
* **Run State** (`game/run.js`): Global run metadata (`STATE`, `lives`, `floorIdx`, `RUN_SEED`, `runTime`, `runStat`, `runLives`) that survives floor rebuilds.
* **SETTINGS** (`settings/store.js`): Global user configuration persisted to `localStorage`.

---

## Testing

* **Unit Tests** (`tests/unit/*.test.js`): Isolated test per domain area. Test real logic directly without mocking out internals.
* **Integration Tests** (`tests/integration/`): Automated bot playthroughs, render trace diffs against golden fixtures (`tests/fixtures/render-trace.json`), and full-draw soak tests.
* **Harness**: Headless execution via `tests/helpers/harness.js`. Use `loadGame({recordMain: true})` for capturing render traces.
* **Golden Files**: Regenerate **only when explicitly instructed**.
* **Pre-flight**: Run the test suite before modifying simulation, collision, lighting, or maze generation logic.

---

## Constraints (Hard Rules)

* **Zero Assets**: Visuals use canvas/CSS only; audio is strictly synthesized.
* **Deterministic RNG**: Must use `mulberry32` seeded per floor (`RUN_SEED + floorIdx`).
* **Headless-Safe**: All modules must load successfully in Node.js with test stubs.
* **Zero Dependencies**: No external npm packages or build steps; vanilla ES modules only.
* **Fixed Simulation Step**: Production runs strictly at `1/60` fixed dt. Variable `dt` is restricted to tests.
* **Frozen Constants**: `NOISE` is `Object.freeze()`d. Difficulty adjustments belong in `tuning.js`/`presets.js`, never here.

---

## Conventions

* **Naming**: Use kebab-case for file names, `SCREAMING_SNAKE_CASE` for frozen constants, and module-scoped `let` for mutable state variables.
* **Imports**: Prefer named exports. Reserve default exports for single-purpose utility modules.
* **Comments**: Use JSDoc annotations for all public exports. Use inline comments exclusively for tuning rationale (explaining *why* a specific numerical value was chosen).
* **TypeScript**: Strictly plain JavaScript with JSDoc typing (`@param`, `@returns`).
* **Communication**: Use the event bus for cross-layer signaling rather than direct callbacks.

---

## Common Tasks

| Task | Where to Look |
| --- | --- |
| Add a leak type | `sim/leaks.js`, `render/passes/leaks.js`, `config/constants.js` (`PIPE_*`) |
| Change lifeform behavior | `sim/lifeforms.js`, `config/constants.js` (`LIFEFORM`), `config/tuning.js` (speeds) |
| Adjust difficulty | `config/presets.js` (`DIFFICULTIES`), `config/tuning.js` (**never** touch `NOISE`/`LIFEFORM`) |
| Build new screen/HUD element | `index.html` → `ui/dom.js` → `ui/hud.js` or `ui/pause.js` |
| Add new audio cue | `audio/voices.js` (oneshots), `audio/ambience.js` (beds), `audio/engine.js` (graph) |
| Fix render bug | `render/passes/<pass>.js` — inspect `render/render.js` for the `rc` context shape |
| Debug simulation logic | Run `npm test` (unit tests provide fast, deterministic feedback) |

---

## What Never To Do

* ❌ Import `render/`, `ui/`, `game/`, or `audio/` from `sim/`, `util/`, or `config/` (except `render/repaint.js`, the dirty-rect exception, until Step 11).
* ❌ Import `render/` or `ui/` from `game/run.js` or `game/loop.js`.
* ❌ Reference or modify `document` inside `sim/` or `game/`.
* ❌ Introduce external assets or npm dependencies.
* ❌ Modify `NOISE.*` (violates the frozen stealth contract).
* ❌ Pass variable `dt` to the simulation loop in production.
* ❌ Alter the `G` state structure without updating `OWNER` and `KEY_ORDER` in `sim/state.js`.
* ❌ Persist per-floor state across floor resets (`G` is destroyed and rebuilt per floor).
* ❌ Regenerate `tests/fixtures/render-trace.json` without explicit instruction.
* ❌ Assume `AudioContext` is available globally—always guard `Audio_.init()` and unlock via user gestures.
