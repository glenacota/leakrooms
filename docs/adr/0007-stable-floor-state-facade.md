# Keep a stable floor-state facade

The simulation exposes floor state through the flat `G` object. Production modules keep references to `G` while floor builds replace all floor-owned state. Keep `G` as a stable `Proxy` that forwards each field to its owning domain object.

## Consequences

- Installing a floor replaces the ownership map, not the `G` object.
- Each field has one domain owner. Duplicate ownership fails before replacing installed state.
- `Object.keys(G)` lists owned fields except internal fields. The `in` operator and property descriptors still expose owned internal fields.
- Before the first floor install, reads return `undefined`, writes are ignored, and reflection reports no fields.
- A field added to a domain becomes available through `G` without a separate domain-name or public-key registry.
