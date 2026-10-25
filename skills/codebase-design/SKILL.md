---
name: codebase-design
description: Design or improve module interfaces and seams for leverage, locality, and testing. Use for architecture choices in a known area, not broad speculative scanning.
metadata:
  agent-kit:
    kind: primary
    requires: []
    optional: [domain-modeling]
---

# Codebase design

Design **deep modules**: substantial useful behavior behind a small interface at
a real seam. Optimize for caller leverage, maintainer locality, and tests that
exercise the same interface as callers.

Use this vocabulary consistently:

- **Module**: an interface plus its implementation, at any scale.
- **Interface**: every fact a caller must know, including invariants, ordering,
  errors, configuration, and performance—not only a type signature.
- **Seam**: a location where behavior can vary without editing the caller.
- **Adapter**: a concrete implementation occupying a seam.
- **Depth**: behavior and leverage delivered per unit of interface knowledge.
- **Locality**: related change, knowledge, bugs, and proof concentrated together.

## Design

1. Name the outcome, affected callers, and behavior that must remain stable.
2. Map the current interfaces and facts callers must coordinate.
3. Apply the deletion test: if removing a module only spreads its complexity
   across callers, it earns depth; if complexity disappears, it was pass-through.
4. Place a seam only where behavior actually varies. One adapter is usually a
   hypothetical seam; two real adapters establish one.
5. Design the smallest interface that hides the relevant complexity.
6. Accept dependencies rather than constructing them invisibly, and return
   results where practical rather than scattering side effects.
7. Test through the external interface. Internal seams may support implementation
   tests without becoming caller knowledge.
8. For a novel, costly-to-reverse interface with no precedent, read
   `references/design-it-twice.md`. Otherwise do not multiply designs by ritual.

Read `references/deepening.md` when restructuring a cluster with several
categories of dependencies.

Do not perform an unrequested codebase-wide architecture scan. Do not add an
abstraction for a possible future implementation. When domain language or a
durable domain decision is changing, use `domain-modeling` if installed.
