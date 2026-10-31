# AGENTS.md

## What this is

LEAKROOMS is a 2D top-down stealth and puzzle game. A plumber repairs burst pipes across five Backrooms floors while avoiding lifeforms that hunt by sound. It is vanilla JavaScript (ES modules), Canvas 2D and Web Audio. There are no dependencies, no build step and no external assets.

## Read order

1. This file.
2. The core terms below. For any other term, read `docs/GLOSSARY.md`.
3. The files you are about to change. Use grep for symbols and read line ranges. Do not read whole large files unless you are editing them.

## Commands

- `npm run test:quick`: unit tests only. Use this while iterating.
- `npm test`: the full suite, about a minute. Run it before every commit.
- `npm run serve`: local static server. The game uses ES modules and will not run from `file://`.

Never run the golden-trace update (`UPDATE_GOLDEN=1`) unless the user explicitly asks.

## Definition of done

- `npm test` passes. New logic has new tests.
- Layer rules hold (`tests/unit/layers.test.js`, `tests/unit/module-load.test.js`).
- No unused imports (`tests/unit/unused-imports.test.js`).
- No new dependency, asset or build step.
- Frozen contracts are untouched (see below), unless the user asked for the change.
- No git commit or git push, but suggest a one-liner commit message.
- If the change is visible on screen, say so in the summary, so the user can play it or run `/qa`.

## Architecture

- `src/main.js`: entry point. Calls `boot()` and nothing else.
- `src/boot.js`: the composition root. The only file that wires layers together. Nothing imports it.
- `src/sim/`: pure simulation. Floor generation, water, noise, lifeforms, vision, clock, door. No DOM, no rendering.
- `src/game/`: run state (lives, floor index, terms), the fixed-step loop, and `floor.js` (builds a floor).
- `src/render/`: canvas drawing. `passes/` holds one file per visual layer. `pack.js` turns simulation arrays into images.
- `src/cast/`: drawing code for the plumber and the lifeform.
- `src/ui/`: DOM screens, HUD, input, touch controls, settings UI.
- `src/audio/`: Web Audio engine, one-shot voices and ambience.
- `src/config/`: constants, levels, difficulty presets, tuning, palette, notes.
- `src/settings/`: persisted settings schema and store.
- `src/util/`: seeded RNG, hash, grid and line helpers, event bus, dirty flags, stick maths.
- `tests/unit/`, `tests/integration/` (bot playthroughs and the render golden trace), `tests/helpers/` (DOM, canvas and audio stubs; the bot; the soft-assert collector).

## Layer rules

- `sim/`, `util/` and `config/` never import from `render/`, `ui/`, `game/` or `audio/`.
- `game/run.js` and `game/loop.js` never import from `render/` or `ui/`, and never touch `document`.
- Cross-layer signals go through `util/events.js`, not direct calls.
- Every new module must be imported from the `boot.js` tree in the same change.
- Floor state lives behind the `G` facade. A new floor field must be added to `sim/state-domains.js`, to the `OWNER` map and to `KEY_ORDER` in `sim/state.js`. `state.test.js` pins the key list.

## Frozen contracts

Do not change these without asking first.

- The noise table in `config/constants.js` (`NOISE`, `LOUD`, `NOISE_FS`, and the hearing and wall constants). Walking and wading stay below `LOUD`. Sprinting and the wrench stay above it. Walls are cover.
- Difficulty presets (`config/presets.js`) change pacing only: lives, clock, repair time and lifeform speed. They never change noise or the number of floors.
- The simulation step is a fixed 1/60 s. Variable time steps are for tests only.
- Simulation randomness comes from seeded streams. A floor is built from `mulberry32(seed + floorNum * 7919)`. Lifeforms use their own streams. Visual-only code may use `Math.random`; simulation code may not.
- `tests/fixtures/render-trace.json` is a golden file. Do not regenerate it.

## Core terms

Full definitions and the words to avoid are in `docs/GLOSSARY.md`.

- **Plumber**: the player's character. Say "plumber" in code and docs. Player-facing copy says "you".
- **Lifeform**: the hostile creature. States: DORMANT, RISING, WALK, SEARCH, HUNT. Do not call them "agents", because in this repo "agent" means an AI agent. Do not call them "monsters".
- **Leak**: a burst pipe in a wall (`leaks`, `L` in code). Player copy says "leak".
- **Standing spot**: the floor tile beside a leak where the plumber repairs (`sx`, `sy`).
- **Repair and seal**: holding still at a standing spot fills `repair`. A full bar seals the leak (`fixed`). Do not say "fix" for this.
- **Water and waterline**: wetness spreading from open leaks along walkable floor (`wetArr`, `wetFront`). The water is the main clue to where the leaks are.
- **Noise**: sound events with a power. `selfNoise` is the plumber's own noise. `leakTotal` is the leaks' noise. `LOUD` is the threshold that wakes sleepers and starts hunts.
- **Lure**: an open leak's noise pulls SEARCHing lifeforms toward it.
- **Floor**: one generated level map. `floorIdx` runs 0 to 4 and is shown as 1 to 5.
- **Run**: from clock-in until the win screen or the last life is lost. Has a seed (`RUN_SEED`).
- **Door**: the exit (`exitTiles`). It opens after `DOOR_HOLD` seconds of standing at it, and only once every leak is sealed.
- **Clock**: the per-floor countdown (`FLOOR_CLOCK`).
- **Terms**: the difficulty chosen at the door before a run (RELAXED, NORMAL, HARD). Per run.
- **Settings**: persisted preferences such as volume, water tint and touch options. Not per run. Do not confuse with terms.
- **"Mode" is overloaded**: input mode (keyboard or touch), HUD visibility mode and so on. Always say which one you mean.

## Testing

Pick the smallest suite that covers your change.

- Pure logic in `sim/`, `util/` or `config/`: `npm run test:quick`.
- UI wiring: `tests/unit/ui-wiring.test.js` and `ui-flow.test.js`.
- Drawing: `tests/integration/render.test.js`. The golden trace fails on any change to what is drawn. Report it. Do not regenerate it.
- Movement, level generation or tuning: the playthrough tests in `tests/integration/playthrough-*` are slow because the bot plays full floors. Run them only when your change touches these areas.
- New API accessors for tests go in `tests/helpers/api.js`. `loadGame()` in `harness.js` returns `A`, `G` and `els`.
- The harness keeps one window listener per event type. Do not add window listeners in tests.

## Conventions

- Files are kebab-case. Frozen constants are `SCREAMING_SNAKE_CASE`. Mutable module state is module-scoped `let`.
- Prefer named exports. Use JSDoc for public exports.
- Comments are plain English. Explain why, not what. Keep them short. Give every tuning number a reason. Avoid filler such as "seamlessly", "robust" or "leverage".
- Before renaming an export, grep for every import and every test that uses it.

## Cost and context budget

- Keep this file under about 150 lines. Put detail in `docs/` and link to it. Read the linked file only when the task needs it.
- Do not edit `AGENTS.md`, `CLAUDE.md` or `docs/GLOSSARY.md` in the middle of a task. The cached prefix depends on them staying the same. Edit them between tasks.
- Search before you read. Use grep for symbols and read only the relevant line ranges. Do not paste whole files into the conversation.
- Test output: run `npm run test:quick` while iterating. Read only failures. If a run is noisy, pipe it through `tail`.
- Model choice: use a cheaper model for renames, comments, test wording and docs. Use the strongest model, with a plan first, for `sim/`, stealth numbers and tuning.
- Subagents are for wide searches that would fill the main context. Each one costs its own context, so do not use them for a single lookup.
- Start a fresh session for each unrelated task. Use `/compact` only at a natural boundary within a task.
- Plan before editing when a change touches more than three files or any frozen contract.
- Stop rule: if the same test fails after two attempted fixes, stop. Report the failing assertion, your hypothesis and what you tried. Do not keep retrying.

## Never

- Import `render/`, `ui/`, `game/` or `audio/` from `sim/`, `util/` or `config/`.
- Change `NOISE`, `LOUD` or any other frozen contract without asking.
- Regenerate the golden trace, or run `UPDATE_GOLDEN=1`.
- Add a dependency, an asset or a build step.
- Call `Math.random` in simulation or level generation.
- Carry per-floor state across a floor rebuild.
- Assume `AudioContext` exists. Guard it and unlock it on a user gesture.
- Retry a failing fix more than twice without reporting back.