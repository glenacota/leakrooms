# Noise is the stealth currency and walls limit how far it carries

Every action the player takes and every sound the building makes is expressed as a noise value from the `NOISE` table (walking 0.20, wading 0.30, sprinting 0.7, repairing 0.85, doors 1.8, and so on). Lifeforms hear a sound according to its value, a hearing radius of `HEAR_BASE` plus `HEAR_GAIN` times the noise, and walls cost reach (`WALL_COST = 3.0`) rather than blocking sound outright. We chose a single shared currency over per-action detection rules so that the player can reason about all actions the same way and so that tuning one value has predictable effects.

## Consequences

- New actions must be given a `NOISE` entry, not a bespoke detection check.
- Changing a noise value rebalances the game and moves the golden trace, so it is a deliberate tuning change.
