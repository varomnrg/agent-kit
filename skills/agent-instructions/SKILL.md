---
name: agent-instructions
description: Design or revise skills, AGENTS files, and agent-facing documents for reliable routing, progressive disclosure, and checkable completion.
metadata:
  agent-kit:
    kind: primary
    requires: []
    optional: []
---

# Agent instructions

Write for repeatable behavior, not impressive prose.

## Design the load

- **Context load** is material always shown to the agent.
- **Cognitive load** is what the human must remember to invoke.

Keep always-loaded pointers short and precise. A pointer says what a document
is and names each genuinely distinct trigger branch. Put detailed reference
behind the pointer.

## Structure the instruction

1. Separate ordered steps from reference consulted only by some branches.
2. Keep what every branch needs inline; disclose branch-specific detail through
   direct relative links.
3. Co-locate a concept's definition, rules, and caveats.
4. Give each procedure a checkable, demanding completion criterion.
5. Prefer a strong familiar leading word over repeating a paragraph.
6. State positive target behavior. Use prohibitions only for hard guardrails and
   pair them with the desired action.
7. Keep one source of truth. Do not cache facts an agent can cheaply inspect in
   the environment.
8. Remove stale material, duplicate meaning, and instructions that do not change
   model behavior.
9. Encode repeated mechanical rules in checks or structure instead of prose.

For Agent Skills frontmatter, invocation choice, composition, and routing, read
`references/skill-mechanics.md`.

## Verify

Check links, routing descriptions, completion criteria, contradictions, and
whether each instruction would change behavior in its target model. When
editing a skill, run discovery in the target harness from a clean process.
