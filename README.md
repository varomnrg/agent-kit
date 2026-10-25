# Agent Kit

A private-first, modular catalog of Timothy's curated agent skills.

Agent Kit is catalog-first rather than runtime-first. Consumers may select one
skill, a named bundle in a later release, or the complete catalog. Pi is the
first tested consumer. Herdr-team is an optional integration; the other skills
do not require Herdr.

## Initial catalog

- `compass-mode`
- `grill`
- `grill-with-docs`
- `diagnosing-bugs`
- `codebase-design`
- `domain-modeling`
- `agent-instructions`
- `agent-retro`
- `handoff`
- optional `herdr-team`

## Development

```bash
npm install
npm test
npm run validate
```

This repository contains no machine credentials, host authority, live state,
or environment-specific deployment policy. Consumers own installation and
policy.
