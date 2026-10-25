import { now, type Assignment, type LiveState, type TeamMember, type TeamRecord } from "./model.ts";
import type { HerdrAdapter, HerdrSnapshot } from "./herdr-adapter.ts";
import { listTeams, writeTeam } from "./store.ts";
import { withCoordinatorLock } from "./coordinator.ts";

export type Wake = { teamId: string; memberName: string; state: LiveState; sequence: number; priority: number; urgent?: boolean; requestId?: string };

export type WatcherOptions = {
  ownerSessionId: string;
  coalesceMs: number;
  maxWorkingMembers: number;
  adapter: HerdrAdapter;
  stateDir: string;
  send: (wakes: Wake[]) => Promise<void>;
  now?: () => string;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  schedule?: (ms: number, task: () => void, signal: AbortSignal) => Promise<void>;
  onBaseline?: () => void;
  onTransitionCommitted?: () => void;
  onWakeDelivered?: (wakes: Wake[]) => void;
};

export type Watcher = { start(): Promise<void>; stop(): Promise<void>; enqueue?(wake: Wake): boolean };
export type WatcherManager = Watcher;

const fault = (state: LiveState) => ["blocked", "unknown", "missing"].includes(state);
const terminal = (state: LiveState) => ["idle", "done"].includes(state);
const rank = (state: LiveState) => (fault(state) ? 0 : 1);
const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
const defaultSchedule = async (ms: number, task: () => void, signal: AbortSignal) => {
  await defaultSleep(ms, signal);
  if (!signal.aborted) task();
};

export function coalesceWakes(wakes: Wake[]) {
  return [...new Map(wakes.map((wake) => [`${wake.teamId}/${wake.memberName}/${wake.sequence}`, wake])).values()]
    .sort((a, b) => a.priority - b.priority || a.teamId.localeCompare(b.teamId) || a.memberName.localeCompare(b.memberName));
}

export function shouldWake(previous: LiveState | undefined, next: LiveState) {
  if (previous === undefined) return fault(next);
  if (previous === next) return false;
  return next !== "working";
}

export function slotUnion(teams: TeamRecord[], snapshot: HerdrSnapshot) {
  const live = new Set<string>();
  const reserved = new Set<string>();
  for (const team of teams) {
    for (const member of team.members.filter((item) => item.lifecycle !== "released")) {
      const agent = snapshot.agents?.find((item) => item.pane_id === member.paneId);
      if (agent?.agent_status === "working") live.add(member.paneId);
      for (const assignment of team.assignments.filter((item) => ["reserved", "active"].includes(item.state) && item.paneId === member.paneId)) {
        if (!live.has(member.paneId)) reserved.add(member.paneId);
      }
    }
  }
  return { live, reserved, total: live.size + reserved.size };
}

export function createLifecycleWatcher(options: WatcherOptions): Watcher {
  const controller = new AbortController();
  const running: Promise<void>[] = [];
  const scheduled: Promise<void>[] = [];
  let stopped = false;
  let pending: Wake[] = [];
  let wakeScheduled = false;
  const clock = options.now ?? now;
  const schedule = options.schedule ?? defaultSchedule;

  const deliver = async (batch: Wake[]) => {
    if (!batch.length) return;
    try {
      await options.send(batch);
      options.onWakeDelivered?.(batch);
      await withCoordinatorLock(options.ownerSessionId, options.adapter, options.stateDir, async () => {
        for (const wake of batch) {
          // Acknowledgement is exact-event state; delivery never clears it.
          const team = (await listTeams(options.stateDir)).find(
            (item) => item.id === wake.teamId && item.ownerSessionId === options.ownerSessionId,
          );
          const attention = team?.attention.find(
            (item) => item.sequence === wake.sequence && item.memberName === wake.memberName,
          );
          if (team && attention) {
            attention.delivered = true;
            await writeTeam(team, team.revision, options.stateDir);
          }
        }
      });
    } catch {
      // Keep attention pending if the trusted wake could not be delivered.
    }
  };

  const queueWake = (wake: Wake) => {
    pending.push(wake);
    if (wakeScheduled) return;
    wakeScheduled = true;
    scheduled.push(schedule(options.coalesceMs, async () => {
      wakeScheduled = false;
      const batch = coalesceWakes(pending);
      pending = [];
      await deliver(batch);
    }, controller.signal));
  };

  const transition = async (
    teamId: string,
    memberName: string,
    paneId: string,
    next: LiveState,
    transitionSequence?: number,
    baseline = false,
  ) => withCoordinatorLock(options.ownerSessionId, options.adapter, options.stateDir, async () => {
    const teams = await listTeams(options.stateDir);
    const team = teams.find((item) => item.id === teamId);
    if (!team || team.status !== "active" || team.ownerSessionId !== options.ownerSessionId) return;
    const member = team.members.find((item) => item.name === memberName && item.lifecycle !== "released");
    if (!member || member.paneId !== paneId) return;
    const previous = member.lastObservedState;
    if (transitionSequence !== undefined && member.lastObservedSequence !== undefined && transitionSequence <= member.lastObservedSequence) return;

    member.lastObservedState = next;
    member.lastObservedSequence = transitionSequence;
    if (baseline) {
      if (fault(next) && !team.attention.some((item) => item.memberName === memberName && item.transitionSequence === transitionSequence)) {
        const sequence = (team.attention.at(-1)?.sequence ?? 0) + 1;
        team.attention.push({ sequence, teamId, memberName, state: next, transitionSequence, createdAt: clock(), delivered: false });
        await writeTeam(team, team.revision, options.stateDir);
        queueWake({ teamId, memberName, state: next, sequence, priority: rank(next) });
      } else {
        await writeTeam(team, team.revision, options.stateDir);
      }
      return;
    }
    if (!shouldWake(previous, next)) {
      await writeTeam(team, team.revision, options.stateDir);
      return;
    }

    const assignment = member.currentAssignmentId
      ? team.assignments.find((item) => item.id === member.currentAssignmentId)
      : undefined;
    const assignmentFor = (candidate: TeamMember, record: TeamRecord) => candidate.currentAssignmentId ? record.assignments.find(item => item.id === candidate.currentAssignmentId) : undefined;
    if (member.pendingBlockingRequestIds?.length && next !== "working") { const pending = new Set(member.pendingBlockingRequestIds); member.pendingBlockingRequestIds = []; for (const requestId of pending) { const request = team.requests?.find(r => r.id === requestId && r.blocking && ["open", "routed", "deferred"].includes(r.state)); if (request && assignmentFor(member, team)?.state && ["reserved", "active"].includes(assignmentFor(member, team)!.state)) { const pendingAssignment = assignmentFor(member, team)!; pendingAssignment.state = "awaiting-review"; pendingAssignment.updatedAt = clock(); member.currentAssignmentId = undefined; } } }
    if (assignment && ["reserved", "active"].includes(assignment.state) && (terminal(next) || fault(next))) {
      assignment.state = "awaiting-review";
      assignment.updatedAt = clock();
      member.currentAssignmentId = undefined;
    }
    const sequence = (team.attention.at(-1)?.sequence ?? 0) + 1;
    team.attention.push({ sequence, teamId, memberName, state: next, transitionSequence, createdAt: clock(), delivered: false });
    await writeTeam(team, team.revision, options.stateDir);
    queueWake({ teamId, memberName, state: next, sequence, priority: rank(next) });
    options.onTransitionCommitted?.();
  });

  const memberLoop = async (teamId: string, member: TeamMember, baselineSnapshot: HerdrSnapshot) => {
    const baseline = baselineSnapshot.agents?.find((item) => item.pane_id === member.paneId);
    options.onBaseline?.(); await transition(teamId, member.name, member.paneId, baseline?.agent_status ?? "missing", baseline?.state_change_seq ?? baseline?.revision, true);
    while (!stopped) {
      const team = (await listTeams(options.stateDir)).find((item) => item.id === teamId);
      const currentMember = team?.members.find((item) => item.name === member.name);
      await options.adapter.wait(member.paneId, currentMember?.lastObservedState, controller.signal);
      if (stopped) return;
      const snapshot = await options.adapter.snapshot();
      const freshTeams = await listTeams(options.stateDir);
      const freshTeam = freshTeams.find((item) => item.id === teamId);
      const freshMember = freshTeam?.members.find((item) => item.name === member.name);
      if (!freshTeam || freshTeam.status !== "active" || freshTeam.ownerSessionId !== options.ownerSessionId || !freshMember || freshMember.lifecycle === "released" || freshMember.paneId !== member.paneId) return;
      const agent = snapshot.agents?.find((item) => item.pane_id === member.paneId);
      await transition(teamId, member.name, member.paneId, agent?.agent_status ?? "missing", agent?.state_change_seq ?? agent?.revision);
    }
  };

  return {
    enqueue(wake: Wake) { if (stopped) return false; queueWake(wake); return true; },
    async start() {
      const teams = (await listTeams(options.stateDir)).filter((team) => team.status === "active" && team.ownerSessionId === options.ownerSessionId);
      const snapshot = await options.adapter.snapshot();
      const members = teams.flatMap((team) => team.members.filter((member) => member.lifecycle !== "released").map((member) => ({ teamId: team.id, member })));
      const slots = slotUnion(teams, snapshot);
      if (slots.total > options.maxWorkingMembers) {
        await withCoordinatorLock(options.ownerSessionId, options.adapter, options.stateDir, async () => {
          const current = await listTeams(options.stateDir);
          for (const team of current.filter((item) => item.status === "active" && item.ownerSessionId === options.ownerSessionId)) {
            for (const member of team.members.filter((item) => item.lifecycle !== "released")) {
              if (!snapshot.agents?.some((agent) => agent.pane_id === member.paneId && agent.agent_status === "working")) continue;
              const sequence = (team.attention.at(-1)?.sequence ?? 0) + 1;
              team.attention.push({ sequence, teamId: team.id, memberName: member.name, state: "working", createdAt: clock(), delivered: false });
              await writeTeam(team, team.revision, options.stateDir);
              queueWake({ teamId: team.id, memberName: member.name, state: "working", sequence, priority: 0, urgent: true });
            }
          }
        });
      }
      running.push(...members.map(({ teamId, member }) => memberLoop(teamId, member, snapshot)));
      await Promise.all(running);
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      controller.abort();
      pending = [];
      // Shutdown fences pending wakes; never deliver after stop.
      await Promise.allSettled(scheduled);
    },
  };
}

export type WatcherManagerOptions = WatcherOptions & { reconcileMs?: number; watcherFactory?: (options: WatcherOptions) => Watcher; sleep?: (ms: number, signal: AbortSignal) => Promise<void>; onGeneration?: (generation: number) => void };
export function createWatcherManager(options: WatcherManagerOptions): WatcherManager {
  const controller = new AbortController();
  let stopped = false;
  let current: Watcher | undefined;
  let fingerprint = ""; let generation = 0;
  const interval = options.reconcileMs ?? 250;
  const sleep = options.sleep ?? ((ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  }));
  const factory = options.watcherFactory ?? createLifecycleWatcher;
  const signature = (teams: TeamRecord[]) => teams
    .filter((team) => team.status === "active" && team.ownerSessionId === options.ownerSessionId)
    .flatMap((team) => team.members.filter((member) => member.lifecycle !== "released").map((member) => `${team.id}/${member.name}/${member.paneId}`))
    .sort().join("|");

  return {
    enqueue(wake: Wake) { return current?.enqueue?.(wake) ?? false; },
    async start() {
      while (!stopped) {
        try {
          const teams = await listTeams(options.stateDir);
          const next = signature(teams);
          if (next !== fingerprint) {
            if (current) await current.stop();
            fingerprint = next;
            generation++;
            options.onGeneration?.(generation);
            if (next) {
              current = factory(options);
              void current.start().catch(() => { if (current) void current.stop(); current = undefined; fingerprint = ""; });
            } else current = undefined;
          }
        } catch {
          // A watcher is advisory. Lock contention or transient state I/O must not crash Pi.
        }
        await sleep(interval, controller.signal);
      }
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      controller.abort();
      await current?.stop();
      current = undefined;
    },
  };
}
