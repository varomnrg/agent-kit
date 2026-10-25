---
name: agent-retro
description: Review completed agentic work and recommend high-value improvements to instructions, checks, tools, information access, delegation, and environment structure.
disable-model-invocation: true
metadata:
  agent-kit:
    kind: primary
    requires: []
    optional: [agent-instructions]
---

# Agent retro

Inspect primary session evidence and resulting artifacts. Do not rely on the
agent's retrospective memory alone.

Find system improvements in this order:

1. **Incorrect result or overclaim** — what evidence or acceptance gate was
   missing?
2. **Mechanical mistake** — which deterministic check, type, or script should
   catch it?
3. **Navigation friction** — which precise pointer or structure would make the
   source easier to find?
4. **Information gap** — which safe read-only source or captured signal was
   unavailable?
5. **Tool economy** — which repeated expensive operation can be bounded or made
   deterministic?
6. **Delegation friction** — was ownership, scope, evidence, or lifecycle
   unclear?
7. **Instruction quality** — which rule was ambiguous, duplicated, stale, or a
   no-op?

Distinguish one-off execution mistakes from repeated structural problems.
Prefer checks and structure to another prose rule. Rank candidates by severity,
frequency, expected attention saved, and implementation cost.

Return recommendations with the observed evidence and the smallest suitable
owner. Do not edit instructions, install tools, or expand scope unless the user
separately asks for the change.
