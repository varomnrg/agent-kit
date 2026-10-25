import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newTeam } from "../../integrations/herdr-team/model.ts";
import { writeTeam } from "../../integrations/herdr-team/store.ts";
import { createWatcherManager } from "../../integrations/herdr-team/watcher.ts";
const dir = () => mkdtemp(join(tmpdir(), "herdr-manager-test-"));
const member = (name: string, paneId: string) => ({ name, paneId, purpose: "test", expectedCwd: "/repo", lifecycle: "until-mission-complete" as const, createdAt: "a", updatedAt: "a" });
const adapter = { snapshot: async () => ({ agents: [] }), prompt: async () => ({ ok: true as const }), wait: async () => {} };

test("manager generations reconcile changes without duplicate watchers and stop aborts future starts", async () => {
  const stateDir = await dir(); const team = newTeam({ id: "a", objective: "a", repository: "/repo", ownerSessionId: "s", ownerPaneId: "p" }); team.members.push(member("m", "pane-a")); await writeTeam(team, undefined, stateDir);
  const calls: any[] = []; const generations: number[] = []; const waits: Array<() => void> = [];
  const generationWaiters = new Map<number, () => void>();
  const sleep = async (_ms: number, signal: AbortSignal) => {
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
      waits.push(resolve);
      signal.addEventListener("abort", resolve, { once: true });
    });
  };
  const manager = createWatcherManager({ ownerSessionId: "s", coalesceMs: 0, maxWorkingMembers: 2, adapter, stateDir, send: async () => {}, reconcileMs: 1, sleep, onGeneration: (generation) => { generations.push(generation); generationWaiters.get(generation)?.(); }, watcherFactory: () => { const watcher = { starts: 0, stops: 0, start: async () => { watcher.starts++; }, stop: async () => { watcher.stops++; } }; calls.push(watcher); return watcher; } });
  const generation = (value: number) => generations.length >= value ? Promise.resolve() : new Promise<void>((resolve) => generationWaiters.set(value, resolve));
  const run = manager.start(); await generation(1); assert.equal(calls.length, 1); await Promise.resolve(); assert.equal(calls.length, 1);
  team.members.push(member("new", "pane-b")); const current = await (await import("../../integrations/herdr-team/store.ts")).readTeam("a", stateDir); team.revision = current.revision; await writeTeam(team, team.revision, stateDir); waits.shift()?.(); await generation(2); assert.equal(calls.length, 2); assert.equal(calls[0].stops, 1);
  team.ownerSessionId = "other"; const latest = await (await import("../../integrations/herdr-team/store.ts")).readTeam("a", stateDir); team.revision = latest.revision; await writeTeam(team, team.revision, stateDir); waits.shift()?.(); await generation(3); assert.equal(calls.length, 2); assert.equal(calls[1].stops, 1);
  await manager.stop(); waits.forEach(resolve => resolve()); await run; const count = calls.length; await Promise.resolve(); assert.equal(calls.length, count);
});
