# AGENTS.md

## Project

LEAKROOMS — 2D top-down puzzle/stealth. Vanilla JS + canvas, zero dependencies, zero assets. All textures procedural, all audio synthesized (Web Audio API).

## Files

- `index.html` — markup, HUD, screens (splash/order/pause/dead/win); settings live as a page of the pause ticket, not a screen
- `src/main.js` — composition root: installs the boot and starts the frame loop
- `src/boot.js` — boot order: wiring, settings, audio, floor 0, then the loop
- `game/` — run state machine, floor assembly, fixed-step loop
- `sim/` — pure simulation: collision, noise, flood, leaks, regions, lightmap, vision, spawn, agents, player, clock, door, radar, tick stages, update
- `render/` — canvas, textures, bake, pack, entities, passes (ground/markers/actors/lighting/leaks/post), splash plan
- `ui/` — DOM, HUD, splash, terms, pause ticket, settings panel, input, buttons, bindings
- `config/` — constants, levels, palette, presets, tuning
- `settings/` — schema and store
- `src/audio/` — synthesized audio
- `cast/` — the rigger and the stalker
- `util/` — rng, hash, grid, events, view
- `style.css` — CRT shell, mono-yellow palette, tape UI
- `tests/` — headless regression suite (`npm test`, parallel files, exit 0 = pass)

## Architecture

No build step. `src/main.js` is the entry point and is loaded via `<script type="module">`; the rest of the tree is native ES modules. CORS blocks `file://`, so serve the repo (`npm run serve`). The cast is drawn inline in `render/entities.js`.

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
