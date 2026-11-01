# Glossary

Read this when a task uses a domain term and the term is not clear from `AGENTS.md`.

Each entry gives the meaning, the code name, and the words to avoid. "Player copy" means text the player reads on screen.

## Characters and hazards

**Plumber**
The player's character. A round body with a collision radius of 0.33 tiles.
Code: `plumber` (on `G`), `PLUMBER.RADIUS`.
Avoid: "player" in code. Use "you" in player copy.

**Lifeform**
The hostile creature that hunts by sound at range and by sight up close. It has four legs, a glossy body, and a hit zone of radius `CATCH_R`. Touching one is fatal.
Code: `lifeforms`, `lf`.
Avoid: "agent" (collides with AI agents), "monster", "enemy".

**Lifeform states**
- DORMANT: lies still on the carpet. Wakes only to a loud sound.
- RISING: getting up, about 1.4 s. Ignores further sound.
- WALK: wanders the floor. A quiet sound turns it to SEARCH. A loud sound turns it to HUNT.
- SEARCH: walks to where it heard something. Gives up after a timer.
- HUNT: chases the plumber or the source of a loud sound. Holds and turns for two seconds on arrival, then gives up after about eight seconds.
Code: `state` field, values as above.

## Leaks and water

**Leak**
A burst pipe on a wall. Each floor has at least one. Leaks are the reason the plumber is on the floor.
Code: `leaks`, `L`. Fields: `x`, `y` (the wall tile), `fixed`, `repair`.
Player copy: "leak".

**Standing spot**
The floor tile directly south of the leak's wall tile. This is where the plumber repairs.
Code: `sx`, `sy`.
Avoid: "repair spot" and "stand tile" in new code.

**Riser**
The vertical section of the pipe drawing, from the ceiling line down to the elbow. Drawing term only.
Code: `riser` in `render/pipe-layout.js`.

**Repair**
Holding still within `REPAIR_REACH` of a standing spot. The bar fills over `REPAIR_TIME` seconds (5 s on NORMAL). Moving drains it quickly. Making progress is the loudest thing the plumber can do.
Code: `repair` (seconds of progress), `tickRepair`.

**Seal**
A repair that completes. The leak is then `fixed`, and it stops contributing water and noise.
Code: `sealLeak`, `fixed`.
Avoid: "fix" for this action. "Fix" is used for code bugs. Player copy says "SEAL" and "LEAKS SEALED".

**Water and waterline**
The wetness spreading from every open leak along walkable floor. It moves outward at `LEAK_SPREAD` seconds per tile and drains back at `LEAK_RETREAT` seconds per tile once the last leak is sealed. It is the main clue to where the leaks are.
Code: `wetArr` (0 to 1 per tile), `wetFront` (how far the front has reached), `waterDist` (walking distance from the nearest open leak), `floodCover` (share of floor that is wet).
Avoid: "flood" in player copy. "Flood" is the name of the simulation module (`sim/flood.js`) and nothing else.

**Wet and dry**
A tile is "wet" above `WET_DRAW`. Below that it is not drawn.

## Sound

**Noise**
A sound with a power, from the table in `config/constants.js`. Noise is the stealth currency of the game.
Code: `NOISE`.

**Your noise and the building's noise**
Your noise is what the plumber makes (footsteps, wrench, radar). The building's noise is what the open leaks make. The HUD shows them separately.
Code: `selfNoise` (yours), `leakTotal` (the building's).

**LOUD**
The threshold, 0.5. Sounds below it make a lifeform curious. Sounds at or above it wake dormant lifeforms and start hunts. Walking and wading are below it. Sprinting, the wrench, the door and touching a lifeform are above it.

**Hearing radius**
How far a sound reaches. Open floor gives `HEAR_BASE + power * HEAR_GAIN` tiles. Each wall tile on the line of sound takes `WALL_COST` tiles off the reach.
Code: `hearRadius`, `wallSteps`.

**Lure**
An open leak is a constant noise source. A SEARCHing lifeform walks to the nearest open leak within `LEAK_LURE`. The leak can keep a lifeform busy, but it cannot wake a sleeping one, because the building's noise stays below LOUD.

## Detection

A lifeform detects you two ways. **Sound** is long range: any sound at or above `LOUD` wakes a dormant lifeform and starts a hunt; quieter sounds turn a wandering lifeform curious (SEARCH) and pull it toward where it heard something. **Sight** is the close-range backstop: an awake lifeform within `SIGHT` tiles (8) that faces you, has nothing between you (`los()`), and you stand in light brighter than `SIGHT_AMBIENT` (0.30) goes straight to `HUNT` and chases you. Standing still keeps your noise down, but it does not make you invisible — if you're lit and in view, an awake lifeform will spot you. The red `seenBy` warning bar rises whenever a lifeform sights you.

Code: `tickLifeforms`, `seenBy`, `los`, `SIGHT`, `SIGHT_DOT`, `SIGHT_AMBIENT`.

## Sight and light

**Ambient light (bake)**
Each tile's brightness under its own ceiling lights, computed once per floor. It does not depend on the viewer.
Code: `lightArr`, `computeLightArr`.

**Scope**
Which rooms the plumber can currently see. A room is the plumber's own room, or a room reachable through gates. Visibility falls off by gate count (`HOP_FALL`). Your own room does not fade with distance.
Code: `regions`, `scopeRoomLight`, `visArr`.

**Cone of vision**
The 200-degree arc the plumber faces. Walls block it. There is no distance falloff inside the cone.
Code: `VIEW_HALF`, `VIEW_RANGE`, `castFan`, `coneArr`.

**Mask**
The final per-tile visibility. It multiplies scope, distance fade and cone together. The radar overrides it to show the whole floor.
Code: `maskArr`, `combineMask`.

**Fixture**
A ceiling light. The "tube" look comes from fixtures plus the flicker on some of them.
Code: `fixtures`.

**Radar**
A battery-powered tool that reveals the whole floor while it is on. It does not reveal leaks, which the plumber finds through the water. It reveals the notes on the carpet.
Code: `radar` (on, boolean), `RADAR_DRAIN`.

## The floor

**Floor**
One generated building. The five floors make up a run. Each floor's index is `floorIdx` (0 to 4), shown to the player as 1 to 5.
Code: `floorIdx`, `buildFloor`.
Avoid: "level" in player copy and in new code. Player copy says "FLOOR 2/5".

**Level**
The row of `LEVELS` that gives a floor's leak count and lifeform count. Code-only term.
Code: `LEVELS`, `spec`.

**Door**
The exit. The plumber starts the floor standing next to it, so the way out is always known. It cycles open after `DOOR_HOLD` seconds of standing at it, and only once every leak is sealed. Standing on it with leaks open does nothing.
Code: `exitTiles`, `descend` (hold progress), `tickDoor`.
Avoid: "exit" in player copy.

**Clock**
The per-floor countdown. It runs whether or not the plumber is moving. When it reaches zero, the run loses a life.
Code: `clock`, `FLOOR_CLOCK`.

**Battery**
A pickup worth 50 charge. Charge is capped at `BATT_MAX` (100). The radar drains it.
Code: `batteries`, `batt`.

**Note**
A short handwritten scrawl on the carpet. The plumber reads it when the radar brings it on screen. Some notes explain the rules in flavour text.
Code: `graffiti`, `NOTES`.

## The run

**Run**
From clock-in to the win screen or the loss of the last life. Has a seed.
Code: `RUN_SEED`, `startRun`.

**Seed**
The same seed always builds the same five floors.
Code: `RUN_SEED`, `setRunSeed`.

**Lives**
Attempts. Each death costs one. Retrying a floor keeps the leaks already sealed on it.
Code: `lives`, `runLives`.

**Terms**
The difficulty chosen at the door before a run starts. Options: RELAXED, NORMAL, HARD. The choice is stamped on the work order and cannot be changed mid-run.
Code: `difficulty`, `DIFFICULTIES`, `currentTerms`.
Avoid: "mode" and "difficulty" in player copy. Show "TERMS", with a one-line hint of what each option changes.

**Settings**
Preferences saved between sessions: volume, ambience, water tint, contrast, CRT intensity, touch options. They are not per run.
Code: `SETTINGS`, `settings/store.js`.

**Work order**
The first page of the binder before a run. It is the job briefing: contractor, location, job, hazard warning, and the terms chooser. It holds no controls and no how-to-play instructions.
Code: `data-binder-page="order"` in `#screen-binder`.

**Binder**
The one screen for everything the player reads or sets outside a run. It has two modes. Shift mode (STATE `binder`) opens from the title with the tabs WORK ORDER, FIELD MANUAL, SETTINGS. Pause mode (STATE `pause`) has the tabs RUN, FIELD MANUAL, SETTINGS. The manual and settings pages are the same markup in both modes.
Code: `#screen-binder`, `src/ui/binder.js`.

**Field manual**
The how-to-play reference: controls for keyboard and touch, the HUD legend, and the rules (repair, noise, radar, door, clock, lives). One shared page of the binder, reachable from the title menu, the binder tabs and pause. It replaces the pause "briefing" page.
Avoid: "briefing" for how-to-play. The briefing is the work order.

**Floor clear card**
The card between two floors, headed "FLOOR SEALED". It shows the clock left over and the next floor's briefing. The next floor is already built behind it, and the clock is frozen while it is up.
Code: `screen-clear`, `clearCard`.

## Input and screens

**Input mode**
Either `kbm` (keyboard or mouse) or `touch`. Set from the most recent input.
Code: `data-input` on `<html>`, `input:mode` event.

**Stick and sprint push**
On touch, the stick walks. Pushing it past a threshold sprints. The threshold is a setting (LIGHT, NORMAL, FIRM). It changes only when the stick sprints, not how loud sprinting is.
Code: `pad`, `STICK.SPRINT_PRESETS`.

**Diegetic ring**
The ring drawn around the plumber: the battery ring on the right.
Code: `render/passes/diegetic.js`.

**Noise indicators**
A visual noise indicator using a responsive glow and spreading ripples to represent noise intensity and detection range.
Code: `render/passes/ripples.js`.

**HUD panel**
The small corner panel showing the clock, lives and leak marks.
Code: `#hud`, `ui/hud.js`.

## Pending decisions

These terms are used inconsistently today. Pick one per row, then update the code, the tests and the copy in one change.

| Question | Options | Recommendation |
| --- | --- | --- |
| Floor or level? | Resolved: "floor". The binder shows "FLOOR 1/5". | Done in the binder redesign. |
