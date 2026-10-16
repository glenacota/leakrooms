# AGENTS.md

## Project

LEAKROOMS — 2D top-down puzzle/stealth. Vanilla JS + canvas, zero dependencies, zero assets. All textures procedural, all audio synthesized (Web Audio API).

## Files

- `index.html` — markup, HUD, screens (splash/order/pause/dead/win); settings live as a page of the pause ticket, not a screen
- `game.js` — entire game: sim, render, audio, input, state machine, and the cast
- `style.css` — CRT shell, mono-yellow palette, tape UI
- `tests/` — headless regression suite (`npm test`, parallel files, exit 0 = pass)

## Architecture

Single-file game, one ES module, no build step. `game.js` is loaded via `<script type="module">` in the browser and in Node (via `vm` in test.js, with a `"use strict"` prefix to mimic module strictness) — keep it loadable headless. Modules are CORS-blocked on `file://`, so serve the repo (`npm run serve`) rather than opening the file directly. The cast is drawn inline in `game.js`.

State lives in module-level `let` bindings. `G` holds per-level state (grid, player, agents, `leaks`, flood, the one `exitTiles` door, `clock`). `LEVELS` is the fixed five-level content table; `SETTINGS` is global config, persisted to `localStorage` under `leakroom.settings.v1`.

## Constraints

- **No assets.** Every visual is canvas-drawn or CSS. Every sound is synthesized.
- **Deterministic RNG.** `mulberry32` seeded per floor. Tests rely on this.
- **Headless-safe.** `game.js` must load in Node with stubbed DOM/canvas. Tests drive real `update()` and `render()`. The vm source is prefixed with `"use strict"` so module strictness is enforced in the harness too.
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

Five yellows in `PAL` (game.js) mirrored in `:root` (style.css). Water is the only non-yellow hue — deliberate, load-bearing.
