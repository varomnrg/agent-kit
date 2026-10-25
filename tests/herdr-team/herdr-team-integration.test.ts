import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newTeam } from "../../integrations/herdr-team/model.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { HerdrAdapter } from "../../integrations/herdr-team/herdr-adapter.ts";
import { listTeams, readTeam, writeTeam } from "../../integrations/herdr-team/store.ts";

const options = { maxActiveTeams: 8, maxWorkingMembers: 4, historyLimit: 20 };
const makeContext = (cwd = "/repo", ui: Record<string, any> = {}) => ({
  cwd,
  mode: "tui",
  hasUI: true,
  sessionManager: { getSessionId: () => "session", getSessionFile: () => "/session.jsonl" },
  ui: { notify: (...args: unknown[]) => args, setWidget: () => {}, ...ui },
}) as unknown as ExtensionContext;
const makeAdapter = (live = true): HerdrAdapter => ({
  snapshot: async () => ({ agents: live ? [{ pane_id: "pane-a", foreground_cwd: "/repo", agent_status: "working" }, { pane_id: "pane-b", foreground_cwd: "/repo", agent_status: "working" }] : [] }),
  prompt: async () => ({ ok: true }),
  wait: async () => {},
});
const add = (team: any, name: string, paneId: string) => team.members.push({ name, paneId, purpose: "test", expectedCwd: "/repo", lifecycle: "until-mission-complete", createdAt: "a", updatedAt: "a" });

function fakePi() {
  const tools: any[] = [];
  const commands: any[] = [];
  const events = new Map<string, Function[]>();
  const sent: any[] = [];
  const watcherCalls: any[] = [];
  const pi: any = {
    registerTool: (tool: any) => tools.push(tool),
    registerCommand: (_name: string, command: any) => commands.push(command),
    on: (name: string, handler: Function) => events.set(name, [...(events.get(name) ?? []), handler]),
    sendMessage: async (...args: any[]) => sent.push(args),
  };
  return { pi, tools, commands, events, sent, watcherCalls };
}

function watcherFactory(captured: any[]) {
  return (options: any) => {
    const watcher = { options, starts: 0, stops: 0, wakes: [] as any[], start: async () => { watcher.starts++; }, stop: async () => { watcher.stops++; }, enqueue: (wake: any) => { watcher.wakes.push(wake); return true; } };
    captured.push(watcher);
    return watcher;
  };
}

async function callTool(tool: any, params: any, ctx: ExtensionContext) {
  return tool.execute("test", params, undefined, undefined, ctx);
}

 test("registered handlers invoke every legacy and new action with exact team targeting", async () => {
  process.env.HERDR_PANE_ID = "coord";
  const stateDir = await mkdtemp(join(tmpdir(), "herdr-integration-actions-"));
  const first = newTeam({ id: "first", objective: "first objective", repository: "/repo", ownerSessionId: "session", ownerPaneId: "coord" });
  add(first, "worker", "pane-a");
  await writeTeam(first, undefined, stateDir);
  const second = newTeam({ id: "second", objective: "second objective", repository: "/repo", ownerSessionId: "other", ownerPaneId: "coord" });
  await writeTeam(second, undefined, stateDir);
  const fake = fakePi();
  process.env.HERDR_TEAM_POLICY_PATH = "false";
  const { default: register } = await import("../../integrations/herdr-team/index.ts");
  let live = true;
  const testAdapter: HerdrAdapter = { snapshot: async () => ({ agents: live ? [{ pane_id: "pane-a", foreground_cwd: "/repo", agent_status: "working" }, { pane_id: "pane-b", foreground_cwd: "/repo", agent_status: "working" }] : [] }), prompt: async () => ({ ok: true }), wait: async () => {} };
  register(fake.pi, { stateDir, adapter: testAdapter, options, watcherFactory: watcherFactory(fake.watcherCalls) as any });
  const tool = fake.tools.find((item) => item.name === "herdr_team_registry");
  const ctx = makeContext();

  assert.match((await callTool(tool, { action: "create", teamId: "created", objective: "created objective" }, ctx)).content[0].text, /Created dynamic team created/);
  assert.match((await callTool(tool, { action: "add", teamId: "created", member: "new-worker", paneId: "pane-b", purpose: "test", expectedCwd: "/repo" }, ctx)).content[0].text, /Registered/);
  assert.match((await callTool(tool, { action: "status" }, ctx)).content[0].text, /first|created/);
  assert.match((await callTool(tool, { action: "inspect", teamId: "first" }, ctx)).content[0].text, /Team first/);
  assert.match((await callTool(tool, { action: "retain", teamId: "first", member: "worker", retentionReason: "follow-up" }, ctx)).content[0].text, /Retained/);
  const liveRetire = await callTool(tool, { action: "retire", teamId: "created", member: "new-worker", releaseVerified: true }, ctx);
  assert.match(liveRetire.content[0].text, /cleanup-required/);
  const created = await readTeam("created", stateDir); created.members.find((member) => member.name === "new-worker")!.lifecycle = "cleanup-required"; created.members.find((member) => member.name === "new-worker")!.retentionReason = "cleanup"; await writeTeam(created, created.revision, stateDir);
  live = false;
  const refused = await callTool(tool, { action: "retire", teamId: "created", member: "new-worker" }, ctx);
  assert.match(refused.content[0].text, /releaseVerified/);
  const releasedTeam = await readTeam("created", stateDir); releasedTeam.members.find((member) => member.name === "new-worker")!.lifecycle = "cleanup-required"; releasedTeam.members.find((member) => member.name === "new-worker")!.retentionReason = "cleanup"; await writeTeam(releasedTeam, releasedTeam.revision, stateDir);
  live = false; const released = await callTool(tool, { action: "retire", teamId: "created", member: "new-worker", releaseVerified: true }, ctx);
  assert.match(released.content[0].text, /Released/);
  const blockedRetire = await callTool(tool, { action: "retire", teamId: "first" }, ctx); assert.match(blockedRetire.content[0].text, /members or assignments remain/);
  const retained = await readTeam("first", stateDir); retained.members[0].lifecycle = "released"; retained.members[0].retentionReason = undefined; await writeTeam(retained, retained.revision, stateDir);
  assert.match((await callTool(tool, { action: "retire", teamId: "first" }, ctx)).content[0].text, /Retired/);
  assert.match((await callTool(tool, { action: "adopt", teamId: "second" }, ctx)).content[0].text, /Adopted/);
  live = true;

  const adopted = await readTeam("second", stateDir); add(adopted, "dispatch-worker", "pane-b"); await writeTeam(adopted, adopted.revision, stateDir);
  const dispatch = await callTool(tool, { action: "managed_dispatch", assignments: [{ teamId: "second", member: "dispatch-worker", title: "mission", objective: "objective", scope: "scope", expectedOutput: "artifact", prompt: "PRIVATE PROMPT" }] }, ctx);
  const assignment = JSON.parse(dispatch.content[0].text)[0].assignmentId;
  const secondAfter = await readTeam("second", stateDir); secondAfter.assignments[0].state = "awaiting-review"; await writeTeam(secondAfter, secondAfter.revision, stateDir);
  const outcome = await callTool(tool, { action: "record_outcome", teamId: "second", assignmentId: assignment, outcome: "accepted", summary: "accepted" }, ctx);
  assert.match(outcome.content[0].text, /accepted/);
  assert.equal(JSON.stringify(await listTeams(stateDir)).includes("PRIVATE PROMPT"), false);
});

test("session start contains lock contention instead of crashing Pi", async () => {
  process.env.HERDR_PANE_ID = "coord"; process.env.HERDR_TEAM_POLICY_PATH = "false";
  const stateDir = await mkdtemp(join(tmpdir(), "herdr-integration-lock-contention-")); const team = newTeam({ id: "owned", objective: "owned", repository: "/repo", ownerSessionId: "session", ownerPaneId: "coord" }); await writeTeam(team, undefined, stateDir);
  await (await import("node:fs/promises")).writeFile(join(stateDir, "coordinator.lock"), JSON.stringify({ version: 1, pid: process.pid, ownerId: "other-live-session", token: "live", createdAt: new Date().toISOString() }));
  const notices: any[] = []; const fake = fakePi(); process.env.HERDR_TEAM_POLICY_PATH = "false"; const { default: register } = await import("../../integrations/herdr-team/index.ts"); register(fake.pi, { stateDir, adapter: makeAdapter(), options, watcherFactory: watcherFactory(fake.watcherCalls) as any }); const ctx = makeContext("/repo", { notify: (...args: any[]) => notices.push(args) });
  await fake.events.get("session_start")?.[0](undefined, ctx);
  assert.ok(notices.some(([message, level]) => level === "warning" && /recovery deferred.*lock timed out/i.test(message))); assert.equal(fake.watcherCalls.length, 1);
});

test("events cover two owned teams, one adoptable team, complete reminders, and actionable-only settle", async () => {
  process.env.HERDR_PANE_ID = "coord";
  const stateDir = await mkdtemp(join(tmpdir(), "herdr-integration-events-"));
  for (const [id, owner, pane] of [["owned-a", "session", "coord"], ["owned-b", "session", "coord"], ["adoptable", "other", "coord"]]) {
    const team = newTeam({ id, objective: id, repository: "/repo", ownerSessionId: owner, ownerPaneId: pane }); add(team, `${id}-worker`, `${id}-pane`); if (id === "owned-b") { team.members[0].lifecycle = "retained-for-follow-up"; team.members[0].retentionReason = "held"; } await writeTeam(team, undefined, stateDir);
  }
  const fake = fakePi(); process.env.HERDR_TEAM_POLICY_PATH = "false";
  const { default: register } = await import("../../integrations/herdr-team/index.ts"); let live = true; const testAdapter: HerdrAdapter = { snapshot: async () => ({ agents: live ? [{ pane_id: "pane-a", foreground_cwd: "/repo", agent_status: "working" }, { pane_id: "pane-b", foreground_cwd: "/repo", agent_status: "working" }] : [] }), prompt: async () => ({ ok: true }), wait: async () => {} }; register(fake.pi, { stateDir, adapter: testAdapter, options, watcherFactory: watcherFactory(fake.watcherCalls) as any }); const ctx = makeContext();
  const firstGate = await fake.events.get("agent_before_settle")?.[0]({ outcome: "completed", context: { canContinue: true } }, ctx); assert.match(firstGate.entries[0].content, /owned-a/); assert.doesNotMatch(firstGate.entries[0].content, /owned-b|adoptable/);
  await fake.events.get("session_start")?.[0](undefined, ctx);
  const reminder = await fake.events.get("before_agent_start")?.[0](undefined, ctx);
  assert.match(reminder.message.content, /owned-a/); assert.match(reminder.message.content, /owned-b/); assert.match(reminder.message.content, /Adoptable team adoptable|adoptable/);
  const gate = await fake.events.get("agent_before_settle")?.[0]({ outcome: "completed", context: { canContinue: true } }, ctx);
  assert.equal(gate, undefined);
  const retained = await readTeam("owned-b", stateDir); retained.members[0].lifecycle = "retained-for-follow-up"; retained.members[0].retentionReason = "held"; await writeTeam(retained, retained.revision, stateDir);
  await fake.events.get("agent_start")?.[0]();
  await fake.events.get("before_agent_start")?.[0](undefined, ctx);
  await callTool(fake.tools.find((item) => item.name === "herdr_team_registry"), { action: "status" }, ctx);
  const retainedGate = await fake.events.get("agent_before_settle")?.[0]({ outcome: "completed", context: { canContinue: true } }, ctx);
  assert.equal(retainedGate, undefined);
});

test("blocking request tool queues one secret-free wake and refreshes the widget", async () => {
  process.env.HERDR_ENV = "1"; process.env.HERDR_PANE_ID = "pane-a"; process.env.HERDR_TEAM_POLICY_PATH = "false";
  const stateDir = await mkdtemp(join(tmpdir(), "herdr-integration-request-wake-"));
  const source = newTeam({ id: "source", objective: "source", repository: "/repo", ownerSessionId: "session", ownerPaneId: "coord" }); add(source, "worker", "pane-a"); await writeTeam(source, undefined, stateDir);
  const destination = newTeam({ id: "destination", objective: "destination", repository: "/repo", ownerSessionId: "session", ownerPaneId: "coord" }); add(destination, "helper", "pane-b"); await writeTeam(destination, undefined, stateDir);
  const fake = fakePi(); const widgets: any[] = [];
  const { default: register } = await import("../../integrations/herdr-team/index.ts"); register(fake.pi, { stateDir, adapter: makeAdapter(false), options, watcherFactory: watcherFactory(fake.watcherCalls) as any });
  const ctx = makeContext("/repo", { setWidget: (...args: any[]) => widgets.push(args) }); await fake.events.get("session_start")?.[0](undefined, ctx);
  // The member tool derives its identity from the pane; use a live matching snapshot for creation.
  fake.watcherCalls[0].options.adapter.snapshot = async () => ({ agents: [{ pane_id: "pane-a", foreground_cwd: "/repo", agent_status: "idle" }] });
  const tool = fake.tools.find(item => item.name === "herdr_cross_team_request");
  const result = await callTool(tool, { destinationTeamId: "destination", title: "help", question: "SECRET QUESTION", reason: "SECRET REASON", blocking: true }, ctx);
  assert.equal(result.isError, undefined); assert.equal(fake.watcherCalls[0].wakes.length, 1); assert.equal(fake.watcherCalls[0].wakes[0].requestId, JSON.parse(result.content[0].text).id);
  assert.doesNotMatch(JSON.stringify(fake.watcherCalls[0].wakes), /SECRET QUESTION|SECRET REASON/); assert.ok(widgets.some(args => args[0] === "herdr-teams" && Array.isArray(args[1])));
});

test("automatic wake includes blocking request IDs only from the watcher owner", async () => {
  process.env.HERDR_PANE_ID = "coord"; process.env.HERDR_TEAM_POLICY_PATH = "false";
  const stateDir = await mkdtemp(join(tmpdir(), "herdr-integration-owner-wake-"));
  for (const [id, owner, requestId] of [["mine", "session", "mine-request"], ["theirs", "other", "their-request"]]) { const team = newTeam({ id, objective: id, repository: "/repo", ownerSessionId: owner, ownerPaneId: "coord" }); add(team, `${id}-worker`, `${id}-pane`); team.requests = [{ id: requestId, sourceTeamId: id, sourceMember: `${id}-worker`, sourcePaneId: `${id}-pane`, destination: { capability: "review" }, title: "secret title", question: "secret question", reason: "secret reason", blocking: true, artifactPaths: [], state: "open", createdAt: "a", updatedAt: "a" }]; await writeTeam(team, undefined, stateDir); }
  const fake = fakePi(); const { default: register } = await import("../../integrations/herdr-team/index.ts"); register(fake.pi, { stateDir, adapter: makeAdapter(false), options, watcherFactory: watcherFactory(fake.watcherCalls) as any }); const ctx = makeContext(); await fake.events.get("session_start")?.[0](undefined, ctx);
  await fake.watcherCalls[0].options.send([{ teamId: "mine", memberName: "mine-worker", state: "blocked", sequence: 1, priority: 0 }]); const serialized = JSON.stringify(fake.sent[0]); assert.match(serialized, /mine-request/); assert.doesNotMatch(serialized, /their-request|secret question|secret reason|secret title/);
});

test("actual watcher send callback reaches pi.sendMessage as a secret-free followUp and shutdown stops once", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "herdr-integration-wake-")); const team = newTeam({ id: "wake", objective: "wake", repository: "/repo", ownerSessionId: "session", ownerPaneId: "coord" }); add(team, "worker", "pane-a"); await writeTeam(team, undefined, stateDir);
  const fake = fakePi(); process.env.HERDR_TEAM_POLICY_PATH = "false";
  const { default: register } = await import("../../integrations/herdr-team/index.ts"); register(fake.pi, { stateDir, adapter: makeAdapter(), options, watcherFactory: watcherFactory(fake.watcherCalls) as any }); const ctx = makeContext(); await fake.events.get("session_start")?.[0](undefined, ctx);
  const send = fake.watcherCalls[0].options.send; await send([{ teamId: "wake", memberName: "worker", state: "blocked", sequence: 1, priority: 0 }]);
  assert.equal(fake.sent[0][1].deliverAs, "followUp"); assert.equal(fake.sent[0][1].triggerTurn, true); assert.match(fake.sent[0][0].content, /wake\/worker: blocked/); assert.doesNotMatch(JSON.stringify(fake.sent[0]), /PRIVATE PROMPT/);
  await fake.events.get("session_shutdown")?.[0](); await fake.events.get("session_shutdown")?.[0](); assert.equal(fake.watcherCalls[0].stops, 1);
});
