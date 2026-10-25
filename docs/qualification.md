# Qualifying external capabilities

An environment may track the latest third-party capability only through an
isolated candidate test and last-known-good promotion. Agent Kit records the
contract; the environment owner performs it.

- `pi-subagents`: a fresh process launches one asynchronous worker and receives
  the expected bounded result.
- `pi-web-access`: a fresh process registers the expected tools without making
  a material external change.
- `@ff-labs/pi-fff`: a bounded fixture search returns the expected path.
- Herdr: client/server versions agree and a temporary team lifecycle passes.

A failed candidate records a sanitized reason and leaves the last known-good
version active. Qualification never grants deployment, publication, secret, or
infrastructure authority.
