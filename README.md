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

Illustrated tutorials appear during play when you first encounter key mechanics.
They close after 9 seconds of active play, or earlier with Enter or Close.
The countdown pauses while the game is paused or you interact with the card.
Each completed tutorial is remembered across runs in the same browser. Disable
tutorials under **Settings → Tutorials** to use concise flashnotes instead;
re-enabling them lets unseen tutorials appear.

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
| Run | `tests/runs/` | Can a player who only sees and hears win the game? | `npm run test:runs` | No, it only reports |

* **Unit** tests check one module at a time: pure logic, wiring and the layer rules.
* **Integration** tests run the whole game. They include the render golden trace (below) and the layout runs. A layout run walks every floor with an omniscient bot that reads the leak list and the door, with no lifeforms. It proves each floor fits the real clock on every difficulty. It does not prove a player can find the way.
* **Run** tests exercise a player-like bot with the real run, clock and retry rules. It explores visible water and uses intermittent radar. Its avoidance is a simple one-tile sprint away from the nearest known lifeform, and it knows exact nearby lifeform positions even through walls. It also routes through the complete grid, so it does not model human perception or decisions exactly. The intended bar is that every RELAXED run clears; NORMAL and HARD are informational. All scenarios remain TODO and do not gate the build while the bot is under investigation.
Run the full suite with `npm test` (about five minutes on two cores). It excludes the run tests.


### Run playtests
Run `PLAYER_BOT_NO_LIFEFORMS=1 npm run test:runs` for a matched navigation control on the same seeds. Set `PLAYER_BOT_RADAR=off`, `PLAYER_BOT_AVOIDANCE=none`, or `PLAYER_BOT_WATER=off` to compare those behaviors individually. `PLAYER_BOT_EXPLORATION=scan-sprint` tries sprinting briefly after a radar scan with no nearby visible lifeforms; the default is to walk. `PLAYER_BOT_RETURN=remembered` routes to the door over seen floor tiles, falling back to the remembered spawn and then search if necessary. Search and routes to leaks and water still use the full grid. The default return policy also uses the full grid. Set `PLAYER_BOT_TRACE=1` to print five-second samples, including the goal, position, clock, radar, battery, stamina and nearest lifeform, and the 15 seconds before each death. The result includes time and distance in tiles while pursuing the door or spawn, stationary time excluding the door hold, and replans. Search and avoidance are excluded from these return statistics. A timeout is a harness limit, not a clock-out. The `dead` event supplies each recorded death's actual cause.

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