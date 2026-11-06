# Floor state sits behind one facade whose key list comes from its domains

All per-floor state is held in nine domain objects built by `src/sim/state-domains.js`, and every module reads and writes it through the `G` facade in `src/sim/state.js`. The facade is a `Proxy` that forwards each field to the domain that owns it. The public key list is derived from those domain objects when a floor is installed, so a new field is added in one factory and nowhere else.

We kept one flat object that every module can reach, rather than passing domain objects to each sim function. Passing domain objects would make each module's real inputs visible in its signature, but cross-domain reads (the lifeforms read the leaks and the vision arrays, for example) would need extra arguments at every call site, and that churn touches every sim module and the test harness. The facade keeps the flat access that the frozen-contract tests and the golden trace already rely on.

## Consequences

- Adding a floor field means editing its domain factory. `tests/unit/state.test.js` pins the sorted key set, so an added or dropped key still fails a test.
- The key order is not a contract. Only membership is pinned, and nothing outside the test depends on `Object.keys(G)` order.
- Before the first floor is built, reads on `G` return `undefined` and writes are dropped. After it, writes to unowned or computed keys throw. We left this as it is, because it is not part of the key-list change and the suite passes with it.
- Replacing the `Proxy` or passing domain objects to sim functions is a larger change. Revisit this ADR before doing either.
