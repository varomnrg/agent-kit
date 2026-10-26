# Agent Kit

A public, modular catalog of Timothy's curated agent skills.

Agent Kit is catalog-first rather than runtime-first. Consumers may select one
skill, a named bundle, or the complete catalog. Pi is the first tested consumer.
Herdr-team is an optional integration; the other skills do not require Herdr.

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

## Install with Pi

Install an immutable reviewed release:

```bash
pi install git:github.com/varomnrg/agent-kit@v0.1.0
```

Use Pi's package configuration to enable only the skills or optional integrations
you want. See [`docs/install-pi.md`](docs/install-pi.md) for filtered package
examples and bundle rendering.

## Development

```bash
npm ci
npm test
npm run validate
npm run catalog:check
npm run test:clean-home
```

This repository contains no machine credentials, host authority, live state,
or environment-specific deployment policy. Consumers own installation and
policy.
