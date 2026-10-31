# A golden render trace guards drawing output

`tests/fixtures/render-trace.json` records a sha1 and length of the draw calls for a fixed seed and fixed inputs. A test fails when drawing output changes. We chose a hash-based trace over pixel snapshots because it needs no image tooling and no browser, and because it catches unintended drawing changes that the simulation tests cannot see. The trace is regenerated only with `UPDATE_GOLDEN=1`, and only when a change to drawing is intended.

## Consequences

- A failing golden test means "drawing changed", not "the test is wrong". Check whether the change was intended before regenerating.
- Regenerating the trace is a reviewed act, not part of a routine fix.
