---
name: grill-with-docs
description: Grill a plan, spec, proposal, or decision while keeping its authoritative document current after each settled round.
disable-model-invocation: true
metadata:
  agent-kit:
    kind: composite
    requires: [grill]
    optional: [domain-modeling]
---

# Grill with docs

Load and follow `grill` as the interview procedure. This skill changes only the
durability contract; it does not duplicate or replace the decision tree.

## Establish the artifact

Use, in order:

1. a path explicitly supplied by the user;
2. the clearly authoritative active artifact named by project context;
3. otherwise one question asking where the decisions belong.

Read its ownership, approval, and publication instructions before editing. A
draft update never implies approval or implementation authority.

## Record after every settled round

Rewrite the relevant current-state sections with settled decisions. Do not
append a question transcript or preserve contradictory historical versions;
Git or the document's owning history carries that record.

Begin the next round's `## Context` with a concise statement of what was
recorded. Do not show the full diff after every round. Show it when the grill is
complete or when a semantic conflict needs attention.

An explicit revision replaces the prior decision. An ambiguous contradiction,
ownership conflict, approval mismatch, or dirty checkout not owned by this
session stops the write and asks for clarification.

If a stable domain term or a genuinely durable architectural decision emerges
and `domain-modeling` is installed, use it only when its own trigger applies.
Do not invent glossaries or ADRs merely because this composite is active.

Publish documentation only through the artifact owner's normal workflow.
