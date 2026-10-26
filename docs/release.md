# Release process

1. Regenerate and check `catalog.json`.
2. Run source, selection, Herdr-team, and clean-home tests from a fresh install.
3. Review provenance, compatibility files, package version, and changelog.
4. Commit the exact release candidate.
5. Present the commit, intended tag, verification, and effect for approval.
6. Create an annotated immutable tag only after that approval.

The first candidate was `v0.1.0`. Corrections to a candidate use a new
`v0.1.x`; never move a tag. `v1.0.0` promotes the exact behavior proven on both
managed homelab hosts. Repository visibility changes require a separate
publication review.
