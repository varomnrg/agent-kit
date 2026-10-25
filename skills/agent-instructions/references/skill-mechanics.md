# Skill mechanics

## Invocation

Use model invocation when the agent must discover the skill itself or another
skill must route to it. The description is then an always-loaded routing
pointer, so name distinct triggers precisely.

Use explicit invocation when only the human should start the behavior. Set
`disable-model-invocation: true`; keep the description human-facing and short.

## Composition

Prefer standalone primary skills. A composite earns a separate entry point only
when the name makes the composition and its side effects clear.

Declare dependencies in `metadata.agent-kit`:

```yaml
metadata:
  agent-kit:
    kind: primary | composite
    requires: []
    optional: []
```

A required dependency is necessary for the skill's named behavior. An optional
dependency adds a route but its absence must not break the primary behavior.
Never discover and invoke arbitrary neighboring skills.

## Packaging

Match the directory and `name`. Use relative links for bundled references,
scripts, and assets. Keep executable integrations separate from reasoning-only
skills and make their selection explicit.
