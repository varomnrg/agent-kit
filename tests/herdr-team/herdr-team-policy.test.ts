import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPolicy } from "../../integrations/herdr-team/index.ts";
import { resolveStateDir } from "../../integrations/herdr-team/store.ts";

test("policy maps all managed fields", async () => { const d = await mkdtemp(join(tmpdir(), "policy-")); const p = join(d, "policy.json"); await writeFile(p, JSON.stringify({ max_active_teams: 8, max_working_members: 4, assignment_history_per_member: 20, attention_coalesce_ms: 250 })); assert.deepEqual(await loadPolicy(p, { maxActiveTeams: 1, maxWorkingMembers: 1 }), { maxActiveTeams: 8, maxWorkingMembers: 4, historyLimit: 20, attentionCoalesceMs: 250 }); });
test("invalid or missing managed policy rejects", async () => { const d = await mkdtemp(join(tmpdir(), "policy-")); await assert.rejects(() => loadPolicy(join(d, "missing.json"), { maxActiveTeams: 1, maxWorkingMembers: 1 }), /ENOENT/); const p = join(d, "bad.json"); await writeFile(p, "{}"); await assert.rejects(() => loadPolicy(p, { maxActiveTeams: 1, maxWorkingMembers: 1 }), /Invalid/); });
test("state path joins XDG_STATE_HOME and default home state", () => { assert.equal(resolveStateDir({ XDG_STATE_HOME: "/state" } as NodeJS.ProcessEnv, "/home/u"), "/state/pi/herdr-teams"); assert.equal(resolveStateDir({} as NodeJS.ProcessEnv, "/home/u"), "/home/u/.local/state/pi/herdr-teams"); });
