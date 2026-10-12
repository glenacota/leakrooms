# AGENTS.md

## Project

LEAKROOMS — 2D top-down puzzle/stealth. Vanilla JS + canvas, zero dependencies, zero assets. All textures procedural, all audio synthesized (Web Audio API).

## Files

- `index.html` — markup, HUD, screens (title/pause/dead/win), settings modal
- `game.js` — entire game: sim, render, audio, input, state machine
- `style.css` — CRT shell, mono-yellow palette, tape UI
- `test.js` — headless regression suite (`node test.js`, ~80s, exit 0 = pass)

## Architecture

Single-file game. No modules, no build step. `game.js` runs in browser and in Node (via `vm` in test.js) — keep it loadable headless.

State lives in module-level `let` bindings. `G` holds per-floor state (grid, player, agents, leak, flood, exits). `SETTINGS` is global config, persisted to `localStorage` under `leakroom.settings.v1`.

## Constraints

- **No assets.** Every visual is canvas-drawn or CSS. Every sound is synthesized.
- **Deterministic RNG.** `mulberry32` seeded per floor. Tests rely on this.
- **Headless-safe.** `game.js` must load in Node with stubbed DOM/canvas. Tests drive real `update()` and `render()`.
- **No new deps.** Ever.

## Tuning

Difficulty presets in `DIFFICULTIES` move counts/spacing only — never touch noise constants. `LOUD` is the stealth contract. See comments at each constant.

## Test Suite

Run before any change that touches sim, collision, lighting, or maze gen. Tests assert on real game logic, never reimplemented. Slowest: end-to-end bot playthroughs (~8 min cap per run).

## Palette

Five yellows in `PAL` (game.js) mirrored in `:root` (style.css). Water is the only non-yellow hue — deliberate, load-bearing.
