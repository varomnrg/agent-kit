import { randomUUID } from "node:crypto";

import {
  now,
  retainRequests,
  sanitizeHistory,
  validateTeamCollection,
  type Assignment,
  type TeamMember,
  type TeamRecord,
} from "./model.ts";
import { listTeams, readTeam, recoverPendingTransaction, withOwnerLock, writeTeam, writeTeamsAtomic } from "./store.ts";
import type { HerdrAdapter, HerdrSnapshot, LiveAgent } from "./herdr-adapter.ts";
import type { LockOptions } from "./store.ts";

export type DispatchAssignment = {
  teamId: string;
  member: string;
  title: string;
  objective: string;
  scope: string;
  expectedOutput: string;
  prompt: string;
  artifactPaths?: string[];
  acceptance?: string[];
  deadline?: string;
  /** Internal idempotency key; never exposed by the registered tool schema. */
  assignmentId?: string;
};
export type DispatchInput = { assignments: DispatchAssignment[] };
export type DispatchResult = {
  assignmentId?: string;
  teamId: string;
  member: string;
  result: "sent" | "failed";
  reasonCode?: string;
};
export type CapacityHolder = { teamId?: string; member: string; title?: string; managed: boolean };
export type DispatchRejection = Error & { holders?: CapacityHolder[]; urgent?: boolean };
export type RequestInput = { destinationTeamId?: string; capability?: string; title: string; question: string; reason: string; blocking: boolean; artifactPaths?: string[]; onAttention?: (event: { teamId: string; memberName: string; requestId: string; sequence: number }) => Promise<void> | void };
function requestText(value: string, field: string, limit: number) { validateText(value, field, limit); if (/[\u0000-\u001f]/.test(value)) throw new Error(`${field} contains control characters`); }
export type CoordinatorOptions = {
  maxActiveTeams?: number;
  maxWorkingMembers: number;
  historyLimit?: number;
  maxTitleLength?: number;
  maxObjectiveLength?: number;
  maxScopeLength?: number;
  maxExpectedOutputLength?: number;
  maxArrayItems?: number;
};

const actionable = (state: Assignment["state"]) => ["reserved", "active", "awaiting-review"].includes(state);
const liveCwd = (agent: LiveAgent) => agent.foreground_cwd ?? agent.cwd;
const ownedTeams = (teams: TeamRecord[], sessionId: string) => teams.filter((team) => team.status === "active" && team.ownerSessionId === sessionId);
export async function recoverCoordinatorRuntime(sessionId: string, adapter: HerdrAdapter, stateDir: string) { return withCoordinatorLock(sessionId, adapter, stateDir, async () => { await recoverPendingTransaction(stateDir); const teams = await listTeams(stateDir); const owned = teams.filter(t => t.status === "active" && t.ownerSessionId === sessionId); for (const team of owned) { let changed = false; for (const request of team.requests ?? []) { if (request.state !== "routed" || request.resolution?.summary !== "routing") continue; const assignmentId = request.resolution.assignmentId; const assignmentTeam = assignmentId ? owned.find(t => t.assignments.some(a => a.id === assignmentId)) : undefined; const assignment = assignmentTeam?.assignments.find(a => a.id === assignmentId); if (assignment?.state === "active" && assignment.delivery?.status === "sent") request.resolution.summary = "routed"; else { if (assignmentTeam && assignment) { assignmentTeam.assignments = assignmentTeam.assignments.filter(a => a.id !== assignment.id); const member = assignmentTeam.members.find(m => m.currentAssignmentId === assignment.id); if (member) member.currentAssignmentId = undefined; if (assignmentTeam.id !== team.id) await writeTeam(assignmentTeam, assignmentTeam.revision, stateDir); } request.state = "open"; request.resolution = undefined; } request.updatedAt = now(); changed = true; } if (changed) await writeTeam(team, team.revision, stateDir); } }); }
export async function withCoordinatorLock<T>(sessionId: string, adapter: HerdrAdapter, stateDir: string, fn: () => Promise<T>): Promise<T> { return withOwnerLock(fn, stateDir, lockOptions(sessionId, adapter, stateDir)); }
function processAlive(pid: number) { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (error: any) { return error?.code === "EPERM"; } }
function lockOptions(sessionId: string, adapter: HerdrAdapter, stateDir: string): LockOptions { return { ownerId: sessionId, isOwnerAlive: async (owner) => { if (owner.pid === process.pid || owner.ownerId === sessionId) return true; if (!processAlive(owner.pid)) return false; const teams = await listTeams(stateDir); if (teams.some(team => team.status === "active" && team.ownerSessionId === owner.ownerId)) return undefined; await adapter.snapshot(); return false; }, reconcileStaleLock: async (owner) => !processAlive(owner.pid) || !(await listTeams(stateDir)).some(team => team.status === "active" && team.ownerSessionId === owner.ownerId) }; }

function rejection(message: string, holders?: CapacityHolder[], urgent = false): DispatchRejection {
  const result = new Error(message) as DispatchRejection;
  result.holders = holders;
  result.urgent = urgent;
  return result;
}

export function validateBatchEntries(assignments: DispatchAssignment[]) {
  const keys = new Set<string>();
  for (const assignment of assignments) {
    const key = `${assignment.teamId}/${assignment.member}`;
    if (keys.has(key)) throw new Error(`duplicate batch entry ${key}`);
    keys.add(key);
  }
}

function validateText(value: string, field: string, limit: number) {
  if (!value?.trim()) throw new Error(`${field} must not be empty`);
  if (value.length > limit) throw new Error(`${field} exceeds maximum length`);
}

function validateDispatchItem(item: DispatchAssignment, options: CoordinatorOptions) {
  validateText(item.title, "title", options.maxTitleLength ?? 200);
  validateText(item.objective, "objective", options.maxObjectiveLength ?? 2000);
  validateText(item.scope, "scope", options.maxScopeLength ?? 2000);
  validateText(item.expectedOutput, "expectedOutput", options.maxExpectedOutputLength ?? 2000);
  if (!item.prompt?.trim()) throw new Error("prompt must not be empty");
  if ((item.artifactPaths?.length ?? 0) > (options.maxArrayItems ?? 20) || (item.acceptance?.length ?? 0) > (options.maxArrayItems ?? 20)) throw new Error("assignment arrays exceed maximum length");
}

export function capacityHolders(teams: TeamRecord[], snapshot: HerdrSnapshot) {
  const holders: CapacityHolder[] = [];
  for (const team of teams) for (const member of team.members.filter((item) => item.lifecycle !== "released")) {
    const agent = snapshot.agents?.find((item) => item.pane_id === member.paneId);
    const assignment = member.currentAssignmentId ? team.assignments.find((item) => item.id === member.currentAssignmentId) : undefined;
    if (agent?.agent_status !== "working" && assignment?.state !== "reserved") continue;
    holders.push({ teamId: team.id, member: member.name, title: assignment?.title, managed: !!assignment });
  }
  return holders;
}

export function slotCount(teams: TeamRecord[], snapshot: HerdrSnapshot) {
  const live = new Set<string>();
  const reserved = new Set<string>();
  for (const team of teams) for (const member of team.members.filter((item) => item.lifecycle !== "released")) {
    const agent = snapshot.agents?.find((item) => item.pane_id === member.paneId);
    if (agent?.agent_status === "working") live.add(member.paneId);
    for (const assignment of team.assignments.filter((item) => ["reserved", "active"].includes(item.state) && item.paneId === member.paneId)) if (!live.has(member.paneId)) reserved.add(member.paneId);
  }
  return live.size + reserved.size;
}

const noOpAdapter = { snapshot: async () => ({ agents: [] }), prompt: async () => ({ ok: true as const }), wait: async () => {} } as HerdrAdapter;
export async function createTeam(sessionId: string, input: { id: string; objective: string; repository: string; ownerSessionFile?: string; ownerPaneId?: string }, options: CoordinatorOptions, stateDir: string, adapter: HerdrAdapter = noOpAdapter) {
  return withCoordinatorLock(sessionId, adapter, stateDir, async () => {
    const teams = await listTeams(stateDir);
    if (ownedTeams(teams, sessionId).length >= (options.maxActiveTeams ?? 8)) throw new Error("maximum active team limit reached");
    if (teams.some((team) => team.id === input.id && team.status === "active")) throw new Error(`Active team ${input.id} already exists`);
    const { newTeam } = await import("./model.ts");
    const team = newTeam({ ...input, ownerSessionId: sessionId });
    await writeTeam(team, undefined, stateDir);
    return team;
  });
}

export async function adoptTeam(sessionId: string, teamId: string, identity: { paneId?: string; cwd: string }, options: CoordinatorOptions, stateDir: string, adapter: HerdrAdapter = noOpAdapter) {
  return withCoordinatorLock(sessionId, adapter, stateDir, async () => {
    const teams = await listTeams(stateDir);
    const team = teams.find((item) => item.id === teamId);
    if (!team || team.status !== "active") throw new Error(`Team ${teamId} is not active`);
    if (team.ownerPaneId !== identity.paneId || team.repository !== identity.cwd) throw new Error("Cannot adopt team outside the matching coordinator pane and cwd");
    if (ownedTeams(teams, sessionId).length >= (options.maxActiveTeams ?? 8)) throw new Error("maximum active team limit reached");
    team.ownerSessionId = sessionId;
    team.updatedAt = now();
    await writeTeam(team, team.revision, stateDir);
    return team;
  }, stateDir);
}

export async function addMember(sessionId: string, teamId: string, input: { member: string; paneId: string; purpose: string; scope?: string; expectedCwd: string; expectedRef?: string; lifecycle?: TeamMember["lifecycle"] }, adapter: HerdrAdapter, _options: CoordinatorOptions, stateDir: string) {
  return withCoordinatorLock(sessionId, adapter, stateDir, async () => {
    const teams = await listTeams(stateDir);
    const team = teams.find((item) => item.id === teamId);
    if (!team || team.status !== "active" || team.ownerSessionId !== sessionId) throw new Error(`teamId ${teamId} is not owned by this coordinator`);
    if (teams.some((item) => item.status === "active" && item.members.some((member) => member.lifecycle !== "released" && member.paneId === input.paneId))) throw new Error(`Pane ${input.paneId} is already registered in an active team`);
    const live = (await adapter.snapshot()).agents?.find((agent) => agent.pane_id === input.paneId);
    if (!live || liveCwd(live) !== input.expectedCwd) throw new Error(`Pane ${input.paneId} cwd does not match expected ${input.expectedCwd}`);
    if (team.members.some((member) => member.name === input.member)) throw new Error(`Member name ${input.member} is already recorded`);
    const stamp = now();
    team.members.push({ name: input.member, paneId: input.paneId, purpose: input.purpose, scope: input.scope, expectedCwd: input.expectedCwd, expectedRef: input.expectedRef, lifecycle: input.lifecycle ?? "until-mission-complete", createdAt: stamp, updatedAt: stamp });
    await writeTeam(team, team.revision, stateDir);
    return team;
  });
}

export async function retainMember(sessionId: string, teamId: string, memberName: string, reason: string, adapter: HerdrAdapter, stateDir: string) {
  return withCoordinatorLock(sessionId, adapter, stateDir, async () => {
    const team = await readTeam(teamId, stateDir);
    const member = team.members.find((item) => item.name === memberName && item.lifecycle !== "released");
    if (team.ownerSessionId !== sessionId || !member) throw new Error("member is not owned or active");
    const live = (await adapter.snapshot()).agents?.find((agent) => agent.pane_id === member.paneId);
    if (!live || liveCwd(live) !== member.expectedCwd) throw new Error("live cwd verification failed");
    member.lifecycle = "retained-for-follow-up";
    member.retentionReason = reason;
    member.updatedAt = now();
    await writeTeam(team, team.revision, stateDir);
    return team;
  });
}

export async function releaseMember(sessionId: string, teamId: string, memberName: string, releaseVerified: boolean, adapter: HerdrAdapter, stateDir: string) {
  return withCoordinatorLock(sessionId, adapter, stateDir, async () => {
    const team = await readTeam(teamId, stateDir);
    const member = team.members.find((item) => item.name === memberName && item.lifecycle !== "released");
    if (team.ownerSessionId !== sessionId || !member) throw new Error("member is not owned or active");
    const live = (await adapter.snapshot()).agents?.some((agent) => agent.pane_id === member.paneId);
    if (live) {
      member.lifecycle = "cleanup-required";
      member.retentionReason = "registry retirement requested; live pane requires explicit closure";
    } else if (!releaseVerified) {
      throw new Error("Member pane is absent; repeat retire with releaseVerified=true after confirming no unresolved work remains.");
    } else member.lifecycle = "released";
    member.updatedAt = now();
    await writeTeam(team, team.revision, stateDir);
    return team;
  });
}

export async function retireTeam(sessionId: string, teamId: string, stateDir: string, adapter: HerdrAdapter = noOpAdapter) {
  return withCoordinatorLock(sessionId, adapter, stateDir, async () => {
    const team = await readTeam(teamId, stateDir);
    if (team.ownerSessionId !== sessionId) throw new Error(`teamId ${teamId} is not owned by this coordinator`);
    if (team.members.some((member) => member.lifecycle !== "released") || team.assignments.some((assignment) => actionable(assignment.state))) throw new Error(`Cannot retire team ${teamId}; members or assignments remain`);
    team.status = "retired";
    team.updatedAt = now();
    await writeTeam(team, team.revision, stateDir);
    return team;
  }, stateDir);
}

export async function createCrossTeamRequest(_memberSessionId: string, input: RequestInput, adapter: HerdrAdapter, options: CoordinatorOptions, stateDir: string, identity: { paneId: string; cwd: string }) {
  if ((!!input.destinationTeamId) === (!!input.capability)) throw new Error("exactly one destinationTeamId or capability is required");
  requestText(input.title, "title", 200); requestText(input.question, "question", 4000); requestText(input.reason, "reason", 2000); if (input.capability !== undefined) { requestText(input.capability, "capability", 200); }
  return withCoordinatorLock(`member:${identity.paneId}`, adapter, stateDir, async () => {
    const teams = await listTeams(stateDir); const memberships = teams.filter(t => t.status === "active").flatMap(t => t.members.filter(m => m.lifecycle !== "released" && m.paneId === identity.paneId).map(m => ({ team: t, member: m })));
    const live = (await adapter.snapshot()).agents?.filter(a => a.pane_id === identity.paneId);
    if (memberships.length !== 1 || live?.length !== 1 || (live[0]?.foreground_cwd ?? live[0]?.cwd) !== identity.cwd) throw new Error("calling pane is not an active registered member with matching live cwd");
    const source = memberships[0].team; const member = memberships[0].member;
    if (input.destinationTeamId) { const destination = teams.find(t => t.id === input.destinationTeamId && t.status === "active" && t.ownerSessionId === source.ownerSessionId); if (!destination || destination.id === source.id) throw new Error("destination team is not another active team owned by this coordinator"); }
    const stamp = now(); const request = { id: randomUUID(), sourceTeamId: source.id, sourceMember: member.name, sourcePaneId: member.paneId, destination: input.destinationTeamId ? { teamId: input.destinationTeamId } : { capability: input.capability! }, title: input.title, question: input.question, reason: input.reason, blocking: input.blocking, artifactPaths: (input.artifactPaths ?? []).slice(0, 20).map(path => { if (!path || path.length > 500 || /[\u0000-\u001f]/.test(path)) throw new Error("invalid artifact path"); return path; }), state: "open" as const, createdAt: stamp, updatedAt: stamp };
    const existing = (source.requests ?? []).find(r => r.sourcePaneId === member.paneId && r.state === "open" && r.title === input.title && r.question === input.question);
    if (existing) return { id: existing.id, state: existing.state };
    source.requests = [...(source.requests ?? []), request]; source.requests = retainRequests(source.requests); if (input.blocking) { const liveState = live[0]?.agent_status; if (liveState === "working") member.pendingBlockingRequestIds = [...new Set([...(member.pendingBlockingRequestIds ?? []), request.id])]; else member.lastObservedState = "blocked"; const assignment = member.currentAssignmentId ? source.assignments.find(a => a.id === member.currentAssignmentId) : undefined; if (assignment && liveState !== "working" && ["reserved", "active"].includes(assignment.state)) { assignment.state = "awaiting-review"; assignment.updatedAt = stamp; member.currentAssignmentId = undefined; } const sequence = (source.attention.at(-1)?.sequence ?? 0) + 1; source.attention.push({ sequence, eventId: randomUUID(), teamId: source.id, memberName: member.name, requestId: request.id, state: "blocked", createdAt: stamp, delivered: false }); }
    await writeTeam(source, source.revision, stateDir); if (input.blocking) await input.onAttention?.({ teamId: source.id, memberName: member.name, requestId: request.id, sequence: source.attention.at(-1)!.sequence }); return { id: request.id, state: request.state };
  });
}

export async function routeCrossTeamRequest(sessionId: string, requestId: string, destination: DispatchAssignment, expectedRevision: number, adapter: HerdrAdapter, options: CoordinatorOptions, stateDir: string) {
  const routeAssignmentId = randomUUID();
  const admission = await withCoordinatorLock(sessionId, adapter, stateDir, async () => { const teams = await listTeams(stateDir); const source = teams.find(t => t.ownerSessionId === sessionId && (t.requests ?? []).some(r => r.id === requestId)); const request = source?.requests?.find(r => r.id === requestId); const target = teams.find(t => t.id === destination.teamId && t.status === "active" && t.ownerSessionId === sessionId); const destinationMatches = request && (("teamId" in request.destination && request.destination.teamId === destination.teamId) || ("capability" in request.destination && !!destination.teamId)); if (!source || source.revision !== expectedRevision || !request || request.state !== "open" || !target || target.id === source.id || !destinationMatches) throw new Error("request ownership, revision, state, or destination validation failed"); request.state = "routed"; request.resolution = { summary: "routing", destinationTeamId: destination.teamId, assignmentId: routeAssignmentId }; if ("capability" in request.destination) request.resolution.capability = request.destination.capability; request.updatedAt = now(); await writeTeam(source, source.revision, stateDir); return { revision: (await readTeam(source.id, stateDir)).revision }; });
  let result: Awaited<ReturnType<typeof managedDispatch>>;
  try { result = await managedDispatch(sessionId, { assignments: [{ ...destination, assignmentId: routeAssignmentId }] }, adapter, options, stateDir); }
  catch (error) { await withCoordinatorLock(sessionId, adapter, stateDir, async () => { const source = (await listTeams(stateDir)).find(t => t.ownerSessionId === sessionId && (t.requests ?? []).some(r => r.id === requestId)); const request = source?.requests?.find(r => r.id === requestId); if (source && request?.state === "routed" && request.resolution?.summary === "routing") { request.state = "open"; request.resolution = undefined; request.updatedAt = now(); await writeTeam(source, source.revision, stateDir); } }); throw error; }
  if (result[0]?.result !== "sent") { await withCoordinatorLock(sessionId, adapter, stateDir, async () => { const target = await readTeam(destination.teamId, stateDir); const assignment = target.assignments.find(a => a.id === result[0]?.assignmentId); if (assignment?.state === "failed") { target.assignments = target.assignments.filter(a => a.id !== assignment.id); const member = target.members.find(m => m.name === assignment.memberName); if (member?.currentAssignmentId === assignment.id) member.currentAssignmentId = undefined; await writeTeam(target, target.revision, stateDir); } const source = (await listTeams(stateDir)).find(t => t.ownerSessionId === sessionId && (t.requests ?? []).some(r => r.id === requestId)); const request = source?.requests?.find(r => r.id === requestId); if (source && request?.state === "routed" && request.resolution?.summary === "routing") { request.state = "open"; request.resolution = undefined; request.updatedAt = now(); await writeTeam(source, source.revision, stateDir); } }); throw new Error("request route delivery failed; request remains open"); }
  await withCoordinatorLock(sessionId, adapter, stateDir, async () => { const source = (await listTeams(stateDir)).find(t => t.ownerSessionId === sessionId && (t.requests ?? []).some(r => r.id === requestId)); const request = source?.requests?.find(r => r.id === requestId); if (!source || !request || request.state !== "routed" || request.resolution?.summary !== "routing" || request.resolution.destinationTeamId !== destination.teamId) throw new Error("request changed during route; routed state not recorded"); request.resolution = { ...request.resolution, summary: "routed", assignmentId: result[0].assignmentId }; request.updatedAt = now(); await writeTeam(source, source.revision, stateDir); });
  return result[0];
}

export async function acknowledgeMemberAttention(sessionId: string, teamId: string, memberName: string, adapter: HerdrAdapter, stateDir: string) { return withCoordinatorLock(sessionId, adapter, stateDir, async () => { const team = await readTeam(teamId, stateDir); if (team.ownerSessionId !== sessionId) throw new Error("team is not owned"); const current = team.attention.filter(a => a.memberName === memberName && !a.requestId && !a.acknowledgedAt); if (current.length) { const revision = team.revision; const stamp = now(); current.forEach(event => { event.acknowledgedAt = stamp; }); await writeTeam(team, revision, stateDir); } return current; }); }
export async function acknowledgeRequestAttention(sessionId: string, teamId: string, requestId: string, adapter: HerdrAdapter, stateDir: string) { return withCoordinatorLock(sessionId, adapter, stateDir, async () => { const team = await readTeam(teamId, stateDir); if (team.ownerSessionId !== sessionId) throw new Error("team is not owned"); if (!(team.requests ?? []).some(r => r.id === requestId)) throw new Error("request not found"); const current = team.attention.filter(a => a.requestId === requestId && !a.acknowledgedAt); if (current.length) { const revision = team.revision; const stamp = now(); current.forEach(event => { event.acknowledgedAt = stamp; }); await writeTeam(team, revision, stateDir); } return current; }); }

export async function resolveCrossTeamRequest(sessionId: string, requestId: string, action: "answer" | "reject" | "defer", summary: string, expectedRevision: number, adapter: HerdrAdapter, stateDir: string) {
  if (!Number.isInteger(expectedRevision)) throw new Error("expectedRevision is required");
  const limit = 1000; if (!summary?.trim() || summary.length > limit || /[\u0000-\u001f]/.test(summary)) throw new Error(`${action === "answer" ? "answer" : "reason"} must be non-empty and bounded`);
  return withCoordinatorLock(sessionId, adapter, stateDir, async () => { const teams = await listTeams(stateDir); const source = teams.find(t => t.ownerSessionId === sessionId && (t.requests ?? []).some(r => r.id === requestId)); if (!source || source.revision !== expectedRevision) throw new Error("request is not owned by this coordinator or revision is stale"); const request = source.requests!.find(r => r.id === requestId)!; if (request.state === "routed" && request.resolution?.summary === "routing") throw new Error("request route is in progress"); if (request.state !== "open" && request.state !== "routed" && request.state !== "deferred") throw new Error("request is already terminal"); request.state = action === "answer" ? "answered" : action === "reject" ? "rejected" : "deferred"; request.resolution = { summary: summary.trim().slice(0, 1000) }; request.updatedAt = now(); source.requests = retainRequests(source.requests!); await writeTeam(source, source.revision, stateDir); return { id: request.id, state: request.state }; });
}

export async function managedDispatch(sessionId: string, input: DispatchInput, adapter: HerdrAdapter, options: CoordinatorOptions, stateDir: string) {
  if (!input.assignments.length) throw new Error("assignments must not be empty");
  validateBatchEntries(input.assignments);
  input.assignments.forEach((item) => validateDispatchItem(item, options));
  const entries = await withCoordinatorLock(sessionId, adapter, stateDir, async () => {
    const all = await listTeams(stateDir);
    validateTeamCollection(all, Number.MAX_SAFE_INTEGER);
    const teams = ownedTeams(all, sessionId);
    const snapshot = await adapter.snapshot();
    const holders = capacityHolders(teams, snapshot);
    if (slotCount(teams, snapshot) + input.assignments.length > options.maxWorkingMembers) throw rejection("Working Slots full", holders, holders.some((holder) => !holder.managed));
    const touched = new Map<string, TeamRecord>();
    const prepared: Array<{ team: TeamRecord; member: TeamMember; assignment: Assignment; prompt: string }> = [];
    const panes = new Set<string>();
    for (const item of input.assignments) {
      const team = teams.find((candidate) => candidate.id === item.teamId);
      if (!team) throw new Error(`teamId ${item.teamId} is not owned by this coordinator`);
      const member = team.members.find((candidate) => candidate.name === item.member && candidate.lifecycle !== "released");
      if (!member) throw new Error(`member ${item.member} is not active in team ${team.id}`);
      const live = snapshot.agents?.find((agent) => agent.pane_id === member.paneId);
      if (!live || liveCwd(live) !== member.expectedCwd) throw new Error(`member ${item.member} pane/cwd does not match expected ${member.expectedCwd}`);
      if (panes.has(member.paneId)) throw new Error(`duplicate pane ${member.paneId}`);
      panes.add(member.paneId);
      if (member.currentAssignmentId || team.assignments.some((assignment) => assignment.memberName === member.name && actionable(assignment.state))) throw new Error(`member ${member.name} already has an active assignment`);
      const assignment: Assignment = { id: item.assignmentId ?? randomUUID(), teamId: team.id, memberName: member.name, paneId: member.paneId, title: item.title, objective: item.objective, scope: item.scope, expectedOutput: item.expectedOutput, artifactPaths: item.artifactPaths ?? [], acceptance: item.acceptance ?? [], deadline: item.deadline, state: "reserved", managed: true, createdAt: now(), updatedAt: now() };
      team.assignments.push(assignment);
      member.currentAssignmentId = assignment.id;
      touched.set(team.id, team);
      prepared.push({ team, member, assignment, prompt: item.prompt });
    }
    await writeTeamsAtomic([...touched.values()], stateDir);
    return prepared;
  });
  const results: DispatchResult[] = [];
  for (const entry of entries) {
    const result = await withCoordinatorLock(sessionId, adapter, stateDir, async () => {
      const teams = await listTeams(stateDir); const team = teams.find(t => t.id === entry.team.id); const member = team?.members.find(m => m.name === entry.member.name); const live = (await adapter.snapshot()).agents?.find(a => a.pane_id === entry.member.paneId);
      if (!team || team.status !== "active" || team.ownerSessionId !== sessionId || !member || member.lifecycle === "released" || member.paneId !== entry.member.paneId || member.currentAssignmentId !== entry.assignment.id || team.assignments.find(a => a.id === entry.assignment.id)?.state !== "reserved" || !live || liveCwd(live) !== member.expectedCwd) return { assignmentId: entry.assignment.id, teamId: entry.team.id, member: entry.member.name, result: "failed" as const, reasonCode: "stale-assignment" };
      const sent = await adapter.prompt(entry.member.paneId, entry.prompt);
      return sent.ok ? { assignmentId: entry.assignment.id, teamId: entry.team.id, member: entry.member.name, result: "sent" as const } : { assignmentId: entry.assignment.id, teamId: entry.team.id, member: entry.member.name, result: "failed" as const, reasonCode: sent.reasonCode };
    });
    results.push(result);
  }
  await withCoordinatorLock(sessionId, adapter, stateDir, async () => {
    const teams = await listTeams(stateDir);
    for (const result of results) {
      const team = teams.find((item) => item.id === result.teamId);
      const assignment = team?.assignments.find((item) => item.id === result.assignmentId);
      const member = team?.members.find((item) => item.name === result.member);
      if (!team || !assignment || !member) continue;
      assignment.delivery = result.result === "sent" ? { status: "sent" } : { status: "failed", reasonCode: result.reasonCode };
      assignment.state = result.result === "sent" ? "active" : "failed";
      assignment.updatedAt = now();
      if (result.result === "failed") member.currentAssignmentId = undefined;
      sanitizeHistory(team, member.name, options.historyLimit);
    }
    const changed = teams.filter(team => results.some(result => result.teamId === team.id));
    await writeTeamsAtomic(changed, stateDir);
  });
  return results;
}

export async function recordOutcome(sessionId: string, teamId: string, assignmentId: string, outcome: { state: "accepted" | "follow-up-required" | "failed" | "cancelled"; summary: string }, options: CoordinatorOptions, stateDir: string, adapter: HerdrAdapter) {
  return withCoordinatorLock(sessionId, adapter, stateDir, async () => {
    const team = await readTeam(teamId, stateDir);
    if (team.ownerSessionId !== sessionId) throw new Error("team is not owned");
    const assignment = team.assignments.find((item) => item.id === assignmentId);
    if (!assignment || assignment.state !== "awaiting-review") throw new Error("outcome is allowed only from awaiting-review");
    assignment.state = outcome.state;
    assignment.outcome = { state: outcome.state, summary: outcome.summary.slice(0, 1000) };
    assignment.updatedAt = now();
    const member = team.members.find((item) => item.name === assignment.memberName);
    if (member) member.currentAssignmentId = undefined;
    sanitizeHistory(team, assignment.memberName, options.historyLimit);
    await writeTeam(team, team.revision, stateDir);
    return assignment;
  }, stateDir);
}
