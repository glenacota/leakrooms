# Seeded, reproducible floors with separate random streams

Each floor is built from `mulberry32(seed + floorNum * 7919)`, and the cast draws from their own streams, `(seed ^ 0xC01) + floorNum * 131` and `(seed ^ 0xA6E27) + floorNum * 131`. The simulation may not call `Math.random`. We chose seeded generation so that a run can be replayed, debugged and tested from a seed alone, and so that changing one system's random draws does not reshuffle the building layout.

## Consequences

- Adding a new random draw to a floor build shifts every later draw in that stream. Give new consumers their own stream rather than reusing one.
- Tests can assert exact floor layouts from a fixed seed.
