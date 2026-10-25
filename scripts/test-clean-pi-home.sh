#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
real_settings="${HOME}/.pi/agent/settings.json"
before="missing"
[[ -f "$real_settings" ]] && before="$(sha256sum "$real_settings" | cut -d' ' -f1)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/agent-kit-clean-home.XXXXXX")"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

inspect() {
  local selection="$1" output="$tmp/${2}.json"
  HOME="$tmp/home" PI_OFFLINE=1 node "$root/scripts/inspect-pi-resources.mjs" "$selection" >"$output"
  node --input-type=module - "$output" "$3" "$4" <<'JS'
import { readFile } from "node:fs/promises";
const [path, expectedSkills, expectedExtensions] = process.argv.slice(2);
const actual = JSON.parse(await readFile(path, "utf8"));
const parse = (value) => value ? value.split(",").filter(Boolean).sort() : [];
if (JSON.stringify(actual.skills) !== JSON.stringify(parse(expectedSkills))) throw new Error(`skill mismatch: ${JSON.stringify(actual.skills)}`);
if (JSON.stringify(actual.extensions) !== JSON.stringify(parse(expectedExtensions))) throw new Error(`extension mismatch: ${JSON.stringify(actual.extensions)}`);
if (actual.diagnostics.length) throw new Error(`resource diagnostics: ${actual.diagnostics.join("; ")}`);
JS
}

mkdir -p "$tmp/home"
inspect core core 'agent-retro,compass-mode,grill,grill-with-docs,handoff' ''
inspect grill-with-docs single 'grill,grill-with-docs' ''
inspect development development 'agent-instructions,agent-retro,codebase-design,compass-mode,diagnosing-bugs,domain-modeling,grill,grill-with-docs,handoff' ''
inspect development,+integration:herdr-team herdr 'agent-instructions,agent-retro,codebase-design,compass-mode,diagnosing-bugs,domain-modeling,grill,grill-with-docs,handoff,herdr-team' 'integrations/herdr-team/index.ts'

after="missing"
[[ -f "$real_settings" ]] && after="$(sha256sum "$real_settings" | cut -d' ' -f1)"
[[ "$before" == "$after" ]] || { echo "operator Pi settings changed" >&2; exit 1; }
printf 'clean-home Pi discovery passed; operator settings %s\n' "$after"
