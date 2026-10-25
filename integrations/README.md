# Optional integrations

Agent Kit skills do not require tool integrations unless their selection says so.

## Herdr team

Selecting `integration:herdr-team` enables the `herdr-team` skill and Pi
extension. The consumer supplies a compatible local Herdr installation, policy,
state location, and environment. Agent Kit never installs Herdr or embeds host
paths and credentials.

## External capabilities

Pi subagents, web access, and fast file search remain independently installed
packages. `compatibility/capabilities.json` declares their desired
`latest-qualified` policy and smoke class; it does not install or update them.
