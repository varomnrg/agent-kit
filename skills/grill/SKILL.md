---
name: grill
description: Stress-test a consequential idea or decision through a context-rich, dependency-ordered interview. Use when the user asks to grill a plan, design, or decision without requesting document maintenance.
metadata:
  agent-kit:
    kind: primary
    requires: []
    optional: []
---

# Grill

Interview the owner until every consequential decision is explicit. Model the
subject as a **decision tree**: a decision unlocks the decisions that depend on
it.

Work in rounds. The **frontier** is every decision whose prerequisites are
settled. Ask the whole current frontier, then wait. A question that depends on
another answer belongs to a later round.

Investigate facts yourself. Read files, inspect the environment, or use
appropriate research tools. Ask the user only for judgment, preference, scope,
trade-offs, risk acceptance, or authority.

Start every round with:

```markdown
## Context

<what is being decided, verified facts and constraints, settled decisions,
and what this round must resolve>
```

Write for zero conversation recall without repeating unrelated history or
pre-answering open decisions.

Format each question:

```markdown
❓ **Q1 — <title>**

<question and meaningful options>

➡️ **Recommendation:** <answer and reason>
```

Recompute the frontier after each answer. Challenge ambiguous terms,
contradictions, hidden authority changes, missing failure behavior, and
unsupported assumptions. Do not begin implementation during the interview.

This skill performs no repository writes by default. If durable artifact
maintenance is wanted, use `grill-with-docs`.

Done when the frontier is empty and the final summary distinguishes settled
decisions, verified facts, remaining external blockers, and approval boundaries.
