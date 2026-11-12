# LEAKROOMS
[![Built with Claude](https://vibecoded.fyi/badges/flat/llms/claude.svg)](https://vibecoded.fyi/)
[![Coded with GitHub Copilot](https://vibecoded.fyi/badges/flat/agents/github-copilot.svg)](https://vibecoded.fyi/) 
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Welcome to [the Backrooms](https://en.wikipedia.org/wiki/The_Backrooms) - now with water damage 🟨🌊🟨. 

In this 2D web-based puzzle game, you play as an overworked plumber contracted by the Async Research Institute to fix leaks within the Complex. Easier said than done when the rooms stretch on forever — and something is hunting you in the dark.

> 🚨 ***DISCLAIMER**: Pure vibe coding. I wanted to play this, not showcase a well-designed web game.*

## 🕹️ Gameplay Overview
* **Setting:** Endless monochromatic yellow wallpaper, buzzing fluorescent lights, and damp carpet.
* **Objective:** Navigate the rooms, seal the leaks, and escape back before your sanity runs out. Or something catches you.
* **Tech Stack:** Vanilla JavaScript, HTML5, and CSS3.

## 📐 Game design

Faithful to the original 2019 creepypasta: six hundred million square miles of randomly segmented mono-yellow rooms, no level names, and an unnamed entity.

You are a **plumber**. A pipe has burst and the floor is flooding. Water flows downhill away from the break, making the wet trail your primary cue to locate the rupture. To fix it, stand still in front of the leak for five seconds. Doing so makes noise—and you don't want to be heard. Beware: wading through flooded carpet is both slower and louder than walking on dry floor.

You view the space top-down with a 200° cone of vision. Anything outside your field of view or behind a wall is pitch black. Darkness isn't safety; unlit rooms still harbor whatever is hunting you. Activating the radar (`R`) overrides vision restrictions, instantly lighting the entire floor—including behind you—to reveal exits and warnings. However, the radar drains battery fast, so use it sparingly.

Sprinting is fast but loud and uses stamina. You can sprint for five seconds from full stamina; recovering from empty takes five seconds when you stop requesting a sprint. At zero stamina, you walk until stamina recovers.

Tall figures of coiled black wire live in the Complex. Dormant, they rest as a flat pile of loops on the carpet. They wake when they hear you, hunting ruthlessly by both sound and sight.

## 🕹️ Controls

| Key | Action |
|---|---|
| `WASD` / `Arrows` | Move |
| `Shift` | Sprint — fast, and very loud (hold or toggle, per settings) |
| `R` | Radar — lights the entire floor, burns battery fast |
| *(nothing)* | **The repair has no button. Stand at the leak and do not press anything.** |
| `Enter` | Start / Confirm / Resume |
| `F` | Toggle fullscreen |
| `Esc` | Pause (display controls, depth, battery, and flood status) |

## 🧪 Tests

There are three kinds of test. Each answers a different question:

| Kind | Where | Question it answers | Run | Gates the build |
|---|---|---|---|---|
| Unit | `tests/unit/` | Does each module do its own job? | `npm run test:quick` | Yes |
| Integration | `tests/integration/` | Does the whole game hold together? | part of `npm test` | Yes |
| Player | `tests/player/` | Can a player who only sees and hears win the game? | `npm run test:player` | No, it only reports |

* **Unit** tests check one module at a time: pure logic, wiring and the layer rules.
* **Integration** tests run the whole game. They include the render golden trace (below) and the layout runs. A layout run walks every floor with an omniscient bot that reads the leak list and the door, with no lifeforms. It proves each floor fits the real clock on every difficulty. It does not prove a player can find the way.
* **Player** runs play the game the way a player does. The player bot sees through the vision cone and hears walking, so it finds leaks by water and sight, and the door by sight. It uses the radar only when stuck, and it reacts to lifeforms it sees or hears. The bar is that every EASY run clears (EASY is RELAXED in the code). NORMAL and HARD are reported only. These runs are slow and never fail the build.

Run the full suite with `npm test` (about five minutes on two cores). It excludes the player runs.

### Render-trace golden file

`tests/integration/render-trace.test.js` snapshots the canvas draw calls produced by `boot()` → 30 fixed-step updates → 3 renders, hashes the call log into `tests/fixtures/render-trace.json` (`{sha1, length}`), and fails on any mismatch. Because the trace is sensitive to every sprite-drawing change (including the plumber's arm borders), regenerate the golden whenever render output intentionally changes:

```
UPDATE_GOLDEN=1 node --test tests/integration/render-trace.test.js
```

This overwrites `tests/fixtures/render-trace.json` with the current trace and prints the new `{sha1, length}`. Then re-run the full suite with `node --test` to confirm everything passes. Commit both the source change and the updated golden fixture together.

> Per `AGENTS.md`, the golden file is regenerated only when explicitly instructed — never as a side effect of an unrelated change.

## 🚀 Running

`src/main.js` is an ES module (`<script type="module">`), so opening `index.html` via `file://` no longer works — browsers block module scripts on that origin. Serve the repo instead:

```
npm run serve     # → http://localhost:8080/
```

## 🤗 OSS!
Forged under the MIT License.