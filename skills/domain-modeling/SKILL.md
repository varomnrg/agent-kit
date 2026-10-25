---
name: domain-modeling
description: Sharpen domain language and durable decisions while designing. Use when terminology, domain relationships, a glossary, or a qualifying ADR is changing.
metadata:
  agent-kit:
    kind: primary
    requires: []
    optional: []
---

# Domain modeling

Use this skill when the model is changing, not merely to read existing domain
vocabulary.

1. Read the applicable `GLOSSARY.md` or glossary map and relevant ADRs.
2. Challenge overloaded or conflicting terms immediately. Propose one precise
   canonical term for each distinct concept.
3. Test relationships with concrete edge cases and counterexamples.
4. Compare stated behavior with code or observable reality. Surface conflicts
   rather than silently choosing one.
5. When a term becomes stable, update the owning glossary using
   `references/glossary-format.md`. Keep implementation mechanics out of it.
6. Offer an ADR only when all are true:
   - changing later is meaningfully costly;
   - the choice is surprising without context;
   - real alternatives were traded off.
7. If accepted, write it using `references/adr-format.md` in the owning context.

Create glossary and ADR directories lazily. Before writing, state what durable
artifact will change unless the user already explicitly requested documentation.
Follow project ownership, approval, and publication rules.
