---
name: leakrooms-audit
description: "Audit LEAKROOMS (scoped or whole project) and produce an evidence-backed findings report plus a prioritized remediation plan, without changing code. Covers architecture, simulation, rendering and performance, input and accessibility, and game design. Use only when explicitly asked for an audit, review, or health check of the game."
disable-model-invocation: true
---

# LEAKROOMS Audit

Find consequential problems and opportunities to remove complexity in the
requested scope. Report findings and a plan. Do not implement changes.

Default scope: the game and its tests. Honor a narrower scope if given. Read
documentation and tooling only where they bear on a finding or a project
contract.

## Rules

- **Never touch `_local/`.** Do not list, search, read, cite, or use anything
  under it, including prior reviews.
- **Cover all five lenses.** Aim for at least four distinct, supported findings
  per lens. A hypothesis counts only if it names a concrete code path or
  observation and a way to verify it. Do not pad with duplicates or generic
  advice. If a lens falls short, report the actual count, say what you
  checked, mark the minimum unmet, and do not call the audit complete.
- **Run the game.** Exercise relevant flows in a browser in addition to static
  inspection and targeted tests. Record environment, steps, and observed
  results. Measure performance claims; do not infer them from code. If runtime
  testing is unavailable, say so and mark runtime-dependent conclusions
  unverified.
- **Respect frozen contracts:** noise and hearing values, difficulty presets,
  the fixed 1/60 s step, seeded floor generation, and the render golden trace.
  Flag any proposal that would change one for explicit owner approval. Never
  regenerate the golden trace.
- **Use project terms** (`docs/GLOSSARY.md`). Skip advice that does not fit
  this game, such as generic platformer or RPG mechanics.

## Process

1. Read `AGENTS.md`. Check `docs/GLOSSARY.md` for unfamiliar terms and the
   relevant `docs/adr/` files before judging a contract.
2. Map the scope to the five lenses. Search broadly for likely risks, then
   trace important behavior through callers, state ownership, tests, and
   player-facing effects. File size, an abstraction, or a code smell is not a
   defect by itself.
3. Investigate in proportion to the risk. Run targeted checks where practical.
   Use subagents only when available and worthwhile. Do not claim exhaustive
   coverage from a sample.
4. Check each finding against existing guards and tests, then label it:
   - **Confirmed:** supported by code, a failing check, or observed behavior.
   - **Hypothesis:** plausible but needs measurement, reproduction, or
     playtesting. State what evidence would confirm or reject it.
5. Rank by actual impact and urgency. Do not raise a hypothesis because its
   potential impact is large; state both the impact and the uncertainty.
   Propose the simplest remedy that fixes the cause, including deletion where
   it fits. Preserve intended behavior and name decisions that need the owner.
6. Write the report in the format below. Do not invent findings to fill a lens
   or a priority.

## Five lenses

### 1. Architecture and state lifecycle

- Do ownership and dependencies match the layers: pure simulation, run and
  loop orchestration, rendering, UI, audio, boot wiring?
- Trace floor and run state through creation, transitions, retries, and
  resets. Find state that outlives its lifecycle or bypasses its owner.
- Find seams that make a concept hard to understand, change, or test. Prefer
  removing duplicate state, branches, wrappers, or layers over moving
  complexity between files.
- Do interfaces expose meaningful behavior? Do integration tests cover the
  connections between well-tested pieces?

### 2. Simulation rules and determinism

- Trace movement, collision, repair and sealing, water, noise, lifeform
  states, detection, the clock, and the door, as far as the scope needs.
- Check boundary conditions, state transitions, reachability, and reset
  behavior against real callers and tests.
- Check fixed-step behavior and seeded streams. Separate simulation randomness
  from intentional run-seed selection and visual-only randomness.
- Do the tests assert meaningful outcomes, cover representative seeds and edge
  cases, and set up conditions that can reach the behavior they claim to test?

### 3. Rendering correctness and runtime cost

- Trace world/device coordinate mapping, camera and viewport culling, render
  passes, surface invalidation, and canvas state.
- Find repeated work or allocation in measured or demonstrably hot simulation
  and render paths. Weigh map size, frame frequency, and real call sites
  before assigning impact.
- Find resources and listeners that can accumulate across floors, runs,
  settings changes, or browser transitions.
- Treat an unmeasured bottleneck as a hypothesis. Give a reproducible
  measurement or comparison where practical, and promise no speedup without
  evidence.

### 4. Input, accessibility and platform resilience

- Review keyboard and touch input, responsive layout, viewport scaling,
  settings, and screen transitions within the scope.
- Do essential information and controls stay understandable and usable across
  input modes, screen sizes, and audio conditions?
- Trace input release and cleanup across blur, visibility changes,
  cancellation, and screen transitions.
- Check audio initialization and gesture unlocking, unavailable browser APIs,
  and storage failure against the actual guards and user feedback.
- Separate a demonstrated failure from a concern that needs device, browser,
  or accessibility testing.

### 5. Playability and design coherence

- Evaluate the real loop: follow water, find and seal leaks, manage noise and
  stamina, avoid lifeforms, reach the door before the clock runs out.
- Are actions, risks, progress, and failure legible through the visual and
  audio cues, including with muted audio and on touch?
- Examine choices and tradeoffs: movement noise, repair commitment, lure
  behavior, radar use, escape. Can the rules or generated floors produce
  unfair or unwinnable situations?
- Judge onboarding and pacing against the game's existing tone and design.
- Separate implemented mechanics from claims about feel. Validate subjective
  findings with playtests or observation. Seek approval before proposing
  changes to frozen or product-level decisions.

## Report

Respond in Markdown in the conversation unless the user asks for a file.

Open with the audited scope, evidence gathered, checks run and their results,
and material coverage limits. If no consequential finding is supported, say so.

Priorities:
- **P0:** urgent, consequential breakage needing immediate action.
- **P1:** significant, evidenced risk or defect to address soon.
- **P2:** lower-urgency improvement or validated polish opportunity.

### Output template

```
# LEAKROOMS Audit - YYYY-MM-DD

## Analysis
- What was in scope and what was not.
- Evidence gathered, checks run, runtime environment.
- Caveats and unmet minimums.

### Architecture and state lifecycle
- **Finding**: concise description.
  - **Priority:** P0, P1, or P2, based on demonstrated impact and urgency.
  - **Status:** confirmed or hypothesis.
  - **Evidence:** file and line references, observed behavior, and the
    reproduction or measurement where available.
  - **Impact:** the concrete failure, maintenance cost, or player consequence.
  - **Remedy:** the smallest credible structural or behavioral change; note
    alternatives or product decisions where they matter.
  - **Verification:** the targeted test, measurement, or playtest needed.

[...other findings...]

### Simulation rules and determinism
[...findings...]

### Rendering correctness and runtime cost
[...findings...]

### Input, accessibility and platform resilience
[...findings...]

### Playability and design coherence
[...findings...]

## Remediation Plan

### P0: Immediate Action Required
- [ ] S1: Short imperative title (finding addressed)
  - **Lens and status:** lens name; confirmed or hypothesis.
  - **Task:** precise instructions for the implementing agent.
  - **Target Files:** exact files to modify, or areas if not yet known.
  - **Step Dependencies:** none, or prerequisite step IDs; note any owner or
    frozen-contract approval required.
  - **Expected Impact:** what improves.
  - **Success Criteria:** concrete acceptance checks, with the smallest
    relevant test or validation command, or a playtest or measurement
    procedure when automation cannot establish the outcome.

[...other steps...]

### P1: Address in Next Phase
[...steps with the same structure as P0...]

### P2: Product Owner Backlog (Feature Expansion)
- [ ] S_n: Feature title
  - **User Story:** As a player, I want...
  - **Acceptance Criteria:** bullets for functional validation.
```

### Plan rules

- Order steps by priority, then prerequisites. Keep each step self-contained
  where possible.
- Split validation tasks from implementation when the right change depends on
  evidence or a product decision.
- P2 technical polish uses the standard step structure; use the user-story
  form only for feature or design expansion.
- Never invent exact files, commands, metrics, or results; report the
  limitation instead.