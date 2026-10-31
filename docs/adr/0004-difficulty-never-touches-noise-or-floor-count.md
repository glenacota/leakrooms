# Difficulty presets change pacing only, never the noise contract or floor count

The `relaxed`, `normal` and `hard` presets in `src/config/presets.js` change lives, the clock, repair time and hunt speed. They do not change the `NOISE` table in `src/config/constants.js`, and they do not change the number of floors, which is always five. We chose this so that the stealth rules a player learns on one difficulty mean the same thing on every difficulty, and so that a difficulty change cannot silently alter the balance the tests and the golden trace assume.

## Consequences

- A new difficulty knob must be a pacing knob. A knob that changes what makes noise, or how far it carries, needs a new ADR.
- The noise table stays a single frozen source of truth in `constants.js`.
