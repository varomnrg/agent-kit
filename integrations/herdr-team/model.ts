export const SCHEMA_VERSION = 2;
export const MAX_ACTIVE_TEAMS = 8;
export const ASSIGNMENT_HISTORY_LIMIT = 20;
export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type TeamStatus = "active" | "retired";
export type MemberLifecycle = "one-task" | "until-mission-complete" | "retained-for-follow-up" | "cleanup-required" | "released";
export type AssignmentState = "reserved" | "active" | "awaiting-review" | "accepted" | "follow-up-required" | "failed" | "cancelled";
export type LiveState = "working" | "idle" | "done" | "blocked" | "unknown" | "missing" | string;
export type AssignmentOutcome = { state: "accepted" | "follow-up-required" | "failed" | "cancelled"; summary: string };
export type Assignment = {
  id: string; teamId: string; memberName: string; paneId: string; title: string; objective: string;
  scope: string; expectedOutput: string; artifactPaths: string[]; acceptance: string[]; deadline?: string;
  state: AssignmentState; managed: boolean; createdAt: string; updatedAt: string;
  delivery?: { status: "sent" | "failed"; reasonCode?: string }; outcome?: AssignmentOutcome;
};
export type TeamMember = {
  name: string; paneId: string; purpose: string; scope?: string; expectedCwd: string; expectedRef?: string;
  lifecycle: MemberLifecycle; retentionReason?: string; createdAt: string; updatedAt: string;
  currentAssignmentId?: string; pendingBlockingRequestIds?: string[]; lastObservedState?: LiveState; lastObservedSequence?: number;
};
export type RequestState = "open" | "routed" | "answered" | "rejected" | "deferred";
export type CrossTeamRequest = { id: string; sourceTeamId: string; sourceMember: string; sourcePaneId: string; destination: { teamId: string } | { capability: string }; title: string; question: string; reason: string; blocking: boolean; artifactPaths: string[]; state: RequestState; createdAt: string; updatedAt: string; resolution?: { summary: string; destinationTeamId?: string; assignmentId?: string; capability?: string } };
export type Attention = { sequence: number; eventId?: string; teamId: string; memberName: string; requestId?: string; state: LiveState; transitionSequence?: number; createdAt: string; observedAt?: string; acknowledgedAt?: string; delivered?: boolean };
export type TeamRecord = {
  schemaVersion: 2; revision: number; id: string; status: TeamStatus; objective: string; repository: string;
  ownerSessionId: string; ownerSessionFile?: string; ownerPaneId?: string; createdAt: string; updatedAt: string;
  lastCheckedAt?: string; members: TeamMember[]; assignments: Assignment[]; attention: Attention[]; requests?: CrossTeamRequest[];
};

const MEMBER_LIFECYCLES = new Set<MemberLifecycle>(["one-task", "until-mission-complete", "retained-for-follow-up", "cleanup-required", "released"]);
const ASSIGNMENT_STATES = new Set<AssignmentState>(["reserved", "active", "awaiting-review", "accepted", "follow-up-required", "failed", "cancelled"]);
export function now() { return new Date().toISOString(); }
export function safeId(value: string) { const id = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64); if (!ID_PATTERN.test(id)) throw new Error("Team IDs must use lowercase letters, digits, '_' or '-' and be at most 64 characters"); return id; }
export function newTeam(input: { id: string; objective: string; repository: string; ownerSessionId: string; ownerSessionFile?: string; ownerPaneId?: string }): TeamRecord { const stamp = now(); return { schemaVersion: 2, revision: 0, id: safeId(input.id), status: "active", objective: input.objective.trim(), repository: input.repository, ownerSessionId: input.ownerSessionId, ownerSessionFile: input.ownerSessionFile, ownerPaneId: input.ownerPaneId, createdAt: stamp, updatedAt: stamp, members: [], assignments: [], attention: [], requests: [] }; }
export function migrateTeam(value: unknown): TeamRecord {
  if (!value || typeof value !== "object") throw new Error("Team state is not an object");
  const raw = value as Record<string, any>;
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) throw new Error("Unsupported team state schema");
  return { ...raw, schemaVersion: 2, revision: typeof raw.revision === "number" && raw.revision >= 0 ? raw.revision : 0, members: Array.isArray(raw.members) ? raw.members.map((m: any) => ({ ...m })) : [], assignments: Array.isArray(raw.assignments) ? raw.assignments.map((a: any) => ({ ...a })) : [], attention: Array.isArray(raw.attention) ? raw.attention.map((a: any) => ({ ...a })) : [], requests: Array.isArray(raw.requests) ? raw.requests.map((r: any) => ({ ...r })) : [] } as TeamRecord;
}
export function validateTeam(value: unknown): TeamRecord {
  const team = migrateTeam(value);
  if (!ID_PATTERN.test(team.id) || (team.status !== "active" && team.status !== "retired") || typeof team.objective !== "string") throw new Error("Invalid team identity or lifecycle");
  if (!team.repository || !team.ownerSessionId || !team.createdAt || !team.updatedAt || !Array.isArray(team.members) || !Array.isArray(team.assignments) || !Array.isArray(team.attention)) throw new Error("Invalid team ownership state");
  const requestList = team.requests ?? []; const unresolvedRequests = requestList.filter(r => ["open", "routed", "deferred"].includes(r.state)); const resolvedRequests = requestList.filter(r => ["answered", "rejected"].includes(r.state)); if (resolvedRequests.length > 20) throw new Error("Cross-team request history exceeds twenty resolved requests");
  for (const request of requestList) { const destination = request.destination; const destinationValid = destination && typeof destination === "object" && ((Object.keys(destination).length === 1 && typeof (destination as any).teamId === "string" && ID_PATTERN.test((destination as any).teamId)) || (Object.keys(destination).length === 1 && typeof (destination as any).capability === "string" && (destination as any).capability.trim().length > 0 && (destination as any).capability.length <= 200 && !/[\u0000-\u001f]/.test((destination as any).capability))); if (!request.id || request.sourceTeamId !== team.id || !request.sourceMember || !request.sourcePaneId || !destinationValid || !request.title || !request.question || !request.reason || request.title.length > 200 || request.question.length > 4000 || request.reason.length > 2000 || typeof request.blocking !== "boolean" || !Array.isArray(request.artifactPaths) || request.artifactPaths.length > 20 || !["open", "routed", "answered", "rejected", "deferred"].includes(request.state)) throw new Error("Invalid cross-team request"); if ([request.title, request.reason, ...request.artifactPaths].some(value => typeof value !== "string" || value.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(request.question)) throw new Error("Invalid request content"); if (request.resolution?.capability !== undefined && (typeof request.resolution.capability !== "string" || !request.resolution.capability.trim() || request.resolution.capability.length > 200 || /[\u0000-\u001f]/.test(request.resolution.capability))) throw new Error("Invalid request resolution capability"); if (["answered", "rejected"].includes(request.state) && (!request.resolution || !request.resolution.summary || request.resolution.summary.length > 1000)) throw new Error("Terminal request requires bounded resolution"); }
  const names = new Set<string>(), panes = new Set<string>();
  for (const member of team.members) {
    if (!member || !member.name || !member.paneId || !member.purpose || !member.expectedCwd || !member.createdAt || !member.updatedAt || !MEMBER_LIFECYCLES.has(member.lifecycle)) throw new Error("Invalid team member state");
    if (names.has(member.name)) throw new Error(`Duplicate team member name ${member.name}`); names.add(member.name);
    if (member.lifecycle !== "released") { if (panes.has(member.paneId)) throw new Error(`Duplicate active team pane ${member.paneId}`); panes.add(member.paneId); }
    if (["retained-for-follow-up", "cleanup-required"].includes(member.lifecycle) && !member.retentionReason) throw new Error(`Member ${member.name} has no retention reason`);
  }
  for (const assignment of team.assignments) {
    if (!assignment.id || assignment.teamId !== team.id || !names.has(assignment.memberName) || !assignment.paneId || !assignment.title || !assignment.objective || !assignment.scope || !assignment.expectedOutput || !Array.isArray(assignment.artifactPaths) || !Array.isArray(assignment.acceptance) || !ASSIGNMENT_STATES.has(assignment.state)) throw new Error("Invalid assignment state");
    if ("prompt" in assignment) throw new Error("Assignment must not persist prompt text");
  }
  return team;
}
export function validateTeamCollection(teams: TeamRecord[], maxActiveTeams = MAX_ACTIVE_TEAMS) {
  const active = teams.filter(team => team.status === "active");
  if (active.length > maxActiveTeams) throw new Error(`maximum of ${maxActiveTeams} active teams exceeded`);
  const panes = new Set<string>();
  for (const team of active) for (const member of team.members.filter(member => member.lifecycle !== "released")) {
    if (panes.has(member.paneId)) throw new Error(`Pane ${member.paneId} belongs to multiple active teams`);
    panes.add(member.paneId);
  }
  return teams;
}
export const REQUEST_RESOLVED_LIMIT = 20;
const UNRESOLVED_REQUEST = new Set<RequestState>(["open", "routed", "deferred"]);
export function retainRequests(requests: CrossTeamRequest[], limit = REQUEST_RESOLVED_LIMIT) {
  const unresolved = requests.filter(r => UNRESOLVED_REQUEST.has(r.state));
  const resolved = requests.filter(r => !UNRESOLVED_REQUEST.has(r.state)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)).slice(0, limit);
  return [...unresolved, ...resolved];
}
export function sanitizeHistory(team: TeamRecord, memberName: string, limit = ASSIGNMENT_HISTORY_LIMIT) {
  const terminal = new Set<AssignmentState>(["accepted", "follow-up-required", "failed", "cancelled"]);
  const history = team.assignments.filter(a => a.memberName === memberName && terminal.has(a.state));
  if (history.length > limit) { const keep = new Set(history.slice(-limit).map(a => a.id)); team.assignments = team.assignments.filter(a => a.memberName !== memberName || !terminal.has(a.state) || keep.has(a.id)); }
}
