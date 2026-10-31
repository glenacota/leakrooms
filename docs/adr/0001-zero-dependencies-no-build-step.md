# Zero dependencies and no build step

LEAKROOMS is plain vanilla JS on canvas 2D and Web Audio, with no runtime dependencies, no bundler, and no transpile step. We chose this so the game runs by opening `index.html` through a static server and so every file an agent or a reader touches is the file that actually runs. Adding a dependency, an asset pipeline, or a build step is a deliberate reversal of this decision, not a routine change.

## Consequences

- Any new package needs the same justification as a new architectural layer, and is recorded here before it is added.
- Tests run on `node --test` with hand-written DOM, canvas and audio stubs in `tests/helpers/`, not on a browser harness.
