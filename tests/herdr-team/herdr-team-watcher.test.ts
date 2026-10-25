import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newTeam } from "../../integrations/herdr-team/model.ts";
import { createLifecycleWatcher, coalesceWakes, shouldWake } from "../../integrations/herdr-team/watcher.ts";
import type { HerdrAdapter, HerdrSnapshot } from "../../integrations/herdr-team/herdr-adapter.ts";
import { readTeam, writeTeam } from "../../integrations/herdr-team/store.ts";

class Deferred<T = void> {
  promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;
  constructor() { this.promise = new Promise<T>((resolve) => { this.resolve = resolve; }); }
}
const nextTurn = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const dir = () => mkdtemp(join(tmpdir(), "herdr-watcher-test-"));
const member = { name: "worker", paneId: "pane-a", purpose: "test", expectedCwd: "/repo", lifecycle: "until-mission-complete" as const, createdAt: "a", updatedAt: "a" };
const setup = async () => { const stateDir = await dir(); const team = newTeam({ id: "a", objective: "o", repository: "/repo", ownerSessionId: "session" }); team.members.push(member); await writeTeam(team, undefined, stateDir); return stateDir; };
function fakeAdapter(states: HerdrSnapshot[]) {
  let index = 0; const waitEntered = new Deferred<void>(); let releaseWait = new Deferred<void>(); let waits = 0;
  const adapter: HerdrAdapter = { snapshot: async () => states[Math.min(index, states.length - 1)], prompt: async () => ({ ok: true }), wait: async (_target, _previous, signal) => { waits++; waitEntered.resolve(); await Promise.race([releaseWait.promise, new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }))]); } };
  return { adapter, waitEntered, advance() { index++; releaseWait.resolve(); releaseWait = new Deferred<void>(); }, get waits() { return waits; } };
}
const watcherOptions = (stateDir: string, adapter: HerdrAdapter, extra: any = {}) => ({ ownerSessionId: "session", coalesceMs: 0, maxWorkingMembers: 2, adapter, stateDir, send: async (batch: any[]) => extra.wakes?.push(...batch), schedule: async (_ms: number, task: () => void, signal: AbortSignal) => { await Promise.resolve(); await Promise.resolve(); if (!signal.aborted) task(); }, ...extra });

test("P14 initial idle/done are quiet and initial fault wakes once", async () => {
  assert.equal(shouldWake(undefined, "idle"), false); assert.equal(shouldWake(undefined, "blocked"), true); assert.equal(shouldWake("blocked", "blocked"), false);
  const stateDir = await setup(); const fake = fakeAdapter([{ agents: [{ pane_id: "pane-a", agent_status: "blocked" }] }]); const wakes: any[] = []; const baseline = new Deferred<void>(); const delivered = new Deferred<void>();
  const watcher = createLifecycleWatcher(watcherOptions(stateDir, fake.adapter, { wakes, onBaseline: () => baseline.resolve(), onWakeDelivered: () => delivered.resolve() })); const run = watcher.start(); await baseline.promise; await delivered.promise; await watcher.stop(); await run; assert.equal(wakes.length, 1);
});

test("P14 re-arms after working and terminal transition awaits explicit barriers", async () => {
  const stateDir = await setup(); const team = await readTeam("a", stateDir); team.assignments.push({ id: "assignment", teamId: "a", memberName: "worker", paneId: "pane-a", title: "t", objective: "o", scope: "s", expectedOutput: "e", artifactPaths: [], acceptance: [], state: "active", managed: true, createdAt: "a", updatedAt: "a" }); team.members[0].currentAssignmentId = "assignment"; await writeTeam(team, team.revision, stateDir);
  const fake = fakeAdapter([{ agents: [{ pane_id: "pane-a", agent_status: "working", state_change_seq: 1 }] }, { agents: [{ pane_id: "pane-a", agent_status: "done", state_change_seq: 2 }] }]); const transition = new Deferred<void>(); const delivered = new Deferred<void>();
  const watcher = createLifecycleWatcher(watcherOptions(stateDir, fake.adapter, { onBaseline: () => {}, onTransitionCommitted: () => transition.resolve(), onWakeDelivered: () => delivered.resolve() })); const run = watcher.start(); await fake.waitEntered.promise; fake.advance(); await transition.promise; await delivered.promise; await watcher.stop(); await run; assert.equal((await readTeam("a", stateDir)).assignments[0].state, "awaiting-review");
});

test("P14 restart fault dedupes after first wake delivery", async () => {
  const stateDir = await setup(); const fake = fakeAdapter([{ agents: [{ pane_id: "pane-a", agent_status: "blocked", state_change_seq: 4 }] }]); const wakes: any[] = []; const firstBaseline = new Deferred<void>(); const firstDelivered = new Deferred<void>();
  const first = createLifecycleWatcher(watcherOptions(stateDir, fake.adapter, { wakes, onBaseline: () => firstBaseline.resolve(), onWakeDelivered: () => firstDelivered.resolve() })); const firstRun = first.start(); await firstBaseline.promise; await firstDelivered.promise; await first.stop(); await firstRun;
  const secondBaseline = new Deferred<void>(); const second = createLifecycleWatcher(watcherOptions(stateDir, fake.adapter, { wakes, onBaseline: () => secondBaseline.resolve() })); const secondRun = second.start(); await secondBaseline.promise; await nextTurn(); await second.stop(); await secondRun; assert.equal(wakes.length, 1);
});

test("P15 coalescing orders faults first", () => { const result = coalesceWakes([{ teamId: "b", memberName: "m", state: "done", sequence: 1, priority: 1 }, { teamId: "a", memberName: "m", state: "blocked", sequence: 1, priority: 0 }, { teamId: "a", memberName: "m", state: "blocked", sequence: 1, priority: 0 }]); assert.deepEqual(result.map((x) => x.state), ["blocked", "done"]); });

test("P16 ownership change fences a wait and shutdown aborts it", async () => {
  const stateDir = await setup(); const fake = fakeAdapter([{ agents: [{ pane_id: "pane-a", agent_status: "working" }] }]); const baseline = new Deferred<void>(); const sent: any[] = [];
  const watcher = createLifecycleWatcher(watcherOptions(stateDir, fake.adapter, { send: async (batch: any[]) => sent.push(...batch), onBaseline: () => baseline.resolve() })); const run = watcher.start(); await baseline.promise; await fake.waitEntered.promise; const team = await readTeam("a", stateDir); team.ownerSessionId = "other"; const latest = await readTeam("a", stateDir); team.revision = latest.revision; await writeTeam(team, team.revision, stateDir); fake.advance(); await watcher.stop(); await run; assert.equal(sent.length, 0); assert.ok(fake.waits >= 1);
});

test("P13 unmanaged over-limit persists and delivers urgent attention", async () => { const stateDir = await setup(); const fake = fakeAdapter([{ agents: [{ pane_id: "pane-a", agent_status: "working" }] }]); const baseline = new Deferred<void>(); const delivered = new Deferred<void>(); const wakes: any[] = []; const watcher = createLifecycleWatcher(watcherOptions(stateDir, fake.adapter, { maxWorkingMembers: 0, wakes, onBaseline: () => baseline.resolve(), onWakeDelivered: () => delivered.resolve() })); const run = watcher.start(); await baseline.promise; await delivered.promise; await watcher.stop(); await run; assert.ok(wakes.some((wake) => wake.urgent)); });
