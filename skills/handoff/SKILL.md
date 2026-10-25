---
name: handoff
description: Create a bounded, redacted continuation artifact so a fresh agent can resume with zero conversation recall.
disable-model-invocation: true
metadata:
  agent-kit:
    kind: primary
    requires: []
    optional: []
---

# Handoff

Write a handoff to the operating system temporary directory unless the user or
project supplies an authoritative destination.

Assume the next agent has zero conversation recall. Reference durable specs,
plans, tickets, commits, and diffs by path or URL instead of copying them.
Capture only state not already durable:

- goal and selected scope;
- verified current state and exact evidence boundary;
- settled decisions;
- uncommitted or unpublished artifacts;
- blockers and owner decisions still needed;
- one concrete next action;
- relevant skills for the resumed task.

Distinguish designed, approved, implemented, committed, published, merged,
deployed, and verified. Do not collapse them into “done.”

Redact credentials, secret identifiers when sensitive, raw logs, requests,
provider metadata, state, application data, and personal information. State
where protected evidence can be re-run rather than copying it.

The handoff is complete when a fresh agent can take the named next action
without reconstructing hidden conversation history and without mistaking an
unapproved or undeployed change for completed work.
