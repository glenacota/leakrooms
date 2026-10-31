# Fixed 1/60 s simulation step with render interpolation

The simulation advances in fixed steps of 1/60 s, and the renderer interpolates between the last two states for display. A frame that falls behind runs at most `MAX_STEPS = 6` catch-up steps and then drops the remaining time. We chose a fixed step over variable delta time so that a floor with the same seed and the same inputs plays out identically on any machine and any frame rate, which the seeded floors and the golden render trace both depend on.

## Consequences

- Changing the step length changes timing for every noise, hunt and repair value and invalidates the golden trace. Treat it as a frozen contract.
- Logic that needs real time (audio scheduling, input) lives outside `src/sim/`.
