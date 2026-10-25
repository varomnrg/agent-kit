# Selecting resources

`catalog.json` is generated from skill metadata. Render a selection without
changing a machine:

```bash
node scripts/render-pi-selection.mjs core
node scripts/render-pi-selection.mjs development
node scripts/render-pi-selection.mjs full
node scripts/render-pi-selection.mjs grill,diagnosing-bugs
node scripts/render-pi-selection.mjs development,+integration:herdr-team
```

The JSON output contains ordinary Pi `skills` and `extensions` package filters.
Required dependencies are added. Optional dependencies remain absent unless
selected. No bundle enables an executable integration implicitly.

Bundles:

- `core`: Compass, both grill surfaces, handoff, and agent retro.
- `development`: core plus agent instructions, codebase design, diagnosing bugs,
  and domain modeling.
- `full`: every non-integration skill in this release.
