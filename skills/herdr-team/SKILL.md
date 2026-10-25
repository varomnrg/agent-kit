---
name: herdr-team
description: Build and coordinate a dynamic, persistent team of visible agents in Herdr. Use when the user asks for a Herdr team, reusable agent panes, persistent delegated ownership, or visible team monitoring. Requires HERDR_ENV=1.
metadata:
  agent-kit:
    kind: primary
    requires: []
    optional: []
    integration: herdr-team
---

# Herdr team

Use persistent visible agents only when continuity, direct steering, reusable
context, or monitored ownership earns their lifecycle cost. Prefer bounded
subagents for one-time work and ordinary command panes for tests, logs, and
servers.

## Preconditions

1. Require `HERDR_ENV=1` for topology changes.
2. Inspect compatible Herdr status and current team registry.
3. Reuse or adopt compatible ownership before creating another team.
4. Apply the consumer's capacity, delegation, approval, and repository policy.

## Team contract

Keep the coordinator responsible for intent, decisions, acceptance, and
publication. Give every member a bounded assignment: objective, repository and
ref, authority, writable scope, constraints, expected output, verification, and
stop conditions. Use one writer per checkout or worktree and never overlap
write ownership.

Creating a registry record does not create a pane. Create only topology the
user authorized, parse live pane identities from Herdr, register each member,
and verify cwd and ref. Registry state is coordination metadata, never proof of
startup or success.

## Dispatch and review

Before follow-up, verify the member remains live, compatible, unblocked, and in
the expected checkout. Send a complete assignment, not “continue.” Treat idle
or done as lifecycle signals only. Consume the artifact and independently
record `accepted`, `follow-up-required`, `failed`, or `cancelled`.

## Retain and retire

Retain only for a credible near-term follow-up with a stated reason. At
completion, inspect work and active commands, obtain confirmation before closing
panes or tabs, verify absence, release members, and retire the team. A live pane
marked for closure remains cleanup-required. Never kill a pane, answer an agent
approval prompt, adopt unowned work, or hide a retained member automatically.
