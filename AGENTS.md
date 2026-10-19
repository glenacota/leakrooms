# AGENTS.md

## Project

LEAKROOMS — 2D top-down puzzle/stealth. Vanilla JS + canvas, zero dependencies, zero assets. All textures procedural, all audio synthesized (Web Audio API).

## Files

- `index.html` — markup, HUD, screens (splash/order/pause/dead/win); settings live as a page of the pause ticket, not a screen
- `src/main.js` — entry point: `import {boot} from './boot.js'; boot();`
- `src/boot.js` — composition root: boot order, all event wiring, settings, audio, floor 0, then the loop
- `src/sim/` — pure simulation: collision, noise, flood, leaks, regions, lightmap, vision, spawn, agents, player, clock, door, radar, tick stages, update
- `src/render/` — canvas, textures, bake, pack, entities, passes (ground/markers/actors/lighting/leaks/post), splash plan
- `src/ui/` — DOM, HUD, splash, terms, pause ticket, settings panel, input, buttons, bindings
- `src/game/` — run state machine, floor assembly, fixed-step loop
- `src/cast/` — the rigger and the stalker
- `src/audio/` — synthesized audio
- `src/config/` — constants, levels, palette, presets, tuning
- `src/settings/` — schema and store
- `src/util/` — rng, hash, grid, events, view
- `css/` — six stylesheets, linked in cascade order from index.html: `tokens.css` (the `:root` yellows) first, `base.css` last. There is no `style.css` any more
- `tests/unit/` — the headless regression suite, one file per area (`npm test`, parallel files, exit 0 = pass)
- `tests/integration/` — playthrough, render trace against the golden, and a full-draw soak
- `tests/helpers/` — harness (DOM/canvas/audio stubs, boots the real game), `api.js` (the suite's handle on the code), dom/stubs/bot/soft-assert
- `tests/fixtures/` — golden files (the render trace). Regenerate only when a task says so

## Architecture

No build step. `src/main.js` is the entry point and is loaded via `<script type="module">`; the rest of the tree is native ES modules. CORS blocks `file://`, so serve the repo (`npm run serve`). The cast is drawn inline in `src/render/entities.js`.

Layers are enforced, not just documented: `sim/`, `util/` and `config/` import nothing from `render/`, `ui/`, `game/` or `audio/`; `game/run.js` and `game/loop.js` import no renderer and no UI and never touch `document`. The run announces facts on the event bus and `ui/` writes them on screen (`tests/unit/layers.test.js`).

State lives in module-level `let` bindings. `G` holds per-level state (grid, player, agents, `leaks`, flood, the one `exitTiles` door, `clock`). `LEVELS` is the fixed five-level content table; `SETTINGS` is global config, persisted to `localStorage` under `leakroom.settings.v1`.

The composition root is `src/main.js` -> `src/boot.js`: it wires the run, the DOM and the input, loads settings, builds floor 0 and starts the fixed-step loop. Nothing below `src/boot.js` imports it back.

## Constraints

- **No assets.** Every visual is canvas-drawn or CSS. Every sound is synthesized.
- **Deterministic RNG.** `mulberry32` seeded per floor. Tests rely on this.
- **Headless-safe.** The sim and render modules load in Node with stubbed DOM/canvas. Tests drive real `update()` and `render()`. The vm source is prefixed with `"use strict"` so module strictness is enforced in the harness too.
- **No new deps.** Ever.

## Rules of the run

- Five levels, fixed content in `LEVELS` (leaks / lifeforms). Presets do not change the count.
- One door: the one you spawned at. Seal every leak, then cycle it before `FLOOR_CLOCK`.
- Running out of clock costs a life, exactly like being caught. The clock is frozen while paused.

## Tuning

Difficulty presets in `DIFFICULTIES` move counts/spacing only — never touch noise constants. `LOUD` is the stealth contract. See comments at each constant.

## Test Suite

Run before any change that touches sim, collision, lighting, or maze gen. Tests assert on real game logic, never reimplemented. `update` is re-exported through a wrapper that holds `G.clock` open; only the playthrough headroom and test 22 use `updateReal`. Slowest: end-to-end bot playthroughs.

## Palette

Five yellows in `PAL` (config/palette.js) mirrored in `:root` (style.css). Water is the only non-yellow hue — deliberate, load-bearing.
