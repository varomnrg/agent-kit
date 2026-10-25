# Install in Pi

Pin an immutable Git tag:

```bash
pi install git:github.com/varomnrg/agent-kit@v0.1.0
```

For a private repository, use the consumer's existing authenticated Git
transport. Never place a token in Pi settings or the package source.

Render the desired selection and place its `skills` and `extensions` arrays on
the package object in `~/.pi/agent/settings.json` through the environment's
configuration owner. Example:

```json
{
  "source": "git:github.com/varomnrg/agent-kit@v0.1.0",
  "skills": ["skills/grill", "skills/grill-with-docs"],
  "extensions": []
}
```

Do not manually copy skill directories alongside the package; duplicate names
make routing dependent on discovery precedence.
