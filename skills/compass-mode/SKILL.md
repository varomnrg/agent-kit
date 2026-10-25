---
name: compass-mode
description: Steer a consequential task with selected working principles, an appropriate specialist, and real proof.
disable-model-invocation: true
metadata:
  agent-kit:
    kind: primary
    requires: []
    optional: [grill, grill-with-docs, diagnosing-bugs, codebase-design, domain-modeling, agent-instructions, agent-retro, handoff, herdr-team]
---

# Compass mode

Use Compass for consequential work: an incorrect result has meaningful cost,
the approach contains genuine design uncertainty, or completion needs
nontrivial proof. Steer the work; do not impose a lifecycle merely because the
mode was invoked.

## Frame

Consider all five fields before acting. Display only those that clarify this
task:

- **Outcome**: what must become true.
- **Constraints**: what must remain true, including granted authority.
- **Unknowns**: observable facts to investigate and owner decisions to ask.
- **Approach**: the smallest suitable path or installed specialist.
- **Proof**: observable evidence that establishes completion.

Investigate discoverable facts. Ask the owner only for judgment, preference, or
new authority.

## Select principles

Read `references/triggers.md`. Load the matching entries from
`references/principles.md` only when they could materially change a decision.
Do not cite ordinary behavior, enumerate irrelevant principles, or manufacture
work to demonstrate compliance.

## Route lightly

Use an installed specialist when its procedure clearly improves the task:

- unresolved owner judgment blocks sound progress → `grill`
- the same interview must maintain a durable artifact → `grill-with-docs`
- defect, regression, failure, or measured slowness → `diagnosing-bugs`
- module interface or seam design → `codebase-design`
- terminology or durable domain decision → `domain-modeling`
- skill or agent-facing instruction design → `agent-instructions`
- completed agentic work needs a retrospective → `agent-retro`
- a fresh session needs bounded continuation context → `handoff`
- persistent visible delegated ownership was explicitly requested → `herdr-team`

These routes are optional. If a specialist is absent, continue with the Compass
frame instead of installing it, failing, or recreating its full procedure.
Compass owns no task-specific playbooks, model routing, delegation mandate,
publication lifecycle, or autonomy policy.

## Close

Report actual proof. Name only a principle that changed a decision and say what
it changed. Explain an exception only when deliberately departing from a
clearly applicable principle. Never treat a principle as new authority.
