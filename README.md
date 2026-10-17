# LEAKROOMS
[![Built with Claude](https://vibecoded.fyi/badges/flat/llms/claude.svg)](https://vibecoded.fyi/)
[![Coded with GitHub Copilot](https://vibecoded.fyi/badges/flat/agents/github-copilot.svg)](https://vibecoded.fyi/) 
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Welcome to [the Backrooms](https://en.wikipedia.org/wiki/The_Backrooms) - now with water damage 🟨🌊🟨. 

In this 2D web-based puzzle game, you play as an overworked plumber contracted by the Async Research Institute to fix pipe leaks within the Complex. Easier said than done when the rooms stretch on forever — and something is hunting you in the dark.

> 🚨 ***DISCLAIMER**: Pure vibe coding. I wanted to play this, not showcase a well-designed web game.*

## 🕹️ Gameplay Overview
* **Setting:** Endless monochromatic yellow wallpaper, buzzing fluorescent lights, and damp carpet.
* **Objective:** Navigate the rooms, seal the leaks, and escape back before your sanity runs out. Or something catches you.
* **Tech Stack:** Vanilla JavaScript, HTML5, and CSS3.

## 📐 Game design

Faithful to the original 2019 creepypasta: six hundred million square miles of randomly segmented mono-yellow rooms, no level names, and an unnamed entity.

You are a **plumber**. A pipe has burst and the floor is flooding. Water flows downhill away from the break, making the wet trail your primary cue to locate the rupture. To fix it, stand still in front of the pipe for five seconds. Doing so makes noise—and you don't want to be heard. Beware: wading through flooded carpet is both slower and louder than walking on dry floor.

You view the space top-down with a 200° cone of vision. Anything outside your field of view or behind a wall is pitch black. Darkness isn't safety; unlit rooms still harbor whatever is hunting you. Activating the radar (`R`) overrides vision restrictions, instantly lighting the entire floor—including behind you—to reveal exits and warnings. However, the radar drains battery fast, so use it sparingly.

Tall figures of coiled black wire live in the Complex. Dormant, they rest as a flat pile of loops on the carpet. They wake when they hear you, hunting ruthlessly by both sound and sight.

## 🕹️ Controls

| Key | Action |
|---|---|
| `WASD` / `Arrows` | Move |
| `Shift` | Sprint — fast, and very loud (hold or toggle, per settings) |
| `R` | Radar — lights the entire floor, burns battery fast |
| *(nothing)* | **The repair has no button. Stand at the pipe and do not press anything.** |
| `Enter` | Start / Confirm / Resume |
| `Esc` | Pause (display controls, depth, battery, and flood status) |

## 🧪 Tests

Run the headless test suite:

```
node test.js      # exit 0 = pass
```

## 🚀 Running

`src/main.js` is an ES module (`<script type="module">`), so opening `index.html` via `file://` no longer works — browsers block module scripts on that origin. Serve the repo instead:

```
npm run serve     # → http://localhost:8080/
```

The test suite validates game logic, physics, and generation across 20 automated checks:
* Maze & Map Integrity: Validates layout connectivity, exit reachability, and tile geometry across 400 floors. Samples 1.7M+ free-space positions to guarantee zero soft-locks.
* Vision & Lighting: Verifies the 200° cone of vision, line-of-sight wall occlusion, corridor falloff, and room-scoped light spillage.
* Radar & Mechanics: Tests 100% floor reveal on sweep, battery drain rate limits, and exit-detection triggers.
* Plumbing & Water Physics: Confirms fluid BFS propagation, speed penalties on wet carpet, 5-second repair timing, and exit unlock state rules.
* Collision & Entity AI: Tests 20,000 frames of movement against a physics oracle—verifying no wall drift, no clip bugs, and valid hunt/patrol states.
* Render & HUD Projection: Asserts off-screen canvas projection, true pixel alpha packing for flooded carpet, and sprite alignment.
* Automated Playthroughs: Simulates keyboard-driven bots through complete runs to prove levels are winnable within the light budget.
* Settings & Storage: Tests localStorage schema validation, corrupt-state recovery, and difficulty preset parameters.

## 🤗 OSS!
Forged under the MIT License.