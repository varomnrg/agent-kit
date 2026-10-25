import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { HerdrSnapshot } from "./herdr-adapter.ts";
import type { TeamRecord } from "./model.ts";

export type MemberSummary = { name: string; purpose: string; pane: string; liveState: string; managed: boolean; assignment?: { title: string; state: string; deadline?: string }; attention: number };
export type TeamSummary = { id: string; objective: string; lifecycle: string; memberCount: number; assignmentCount: number; unresolvedRequests: number; attention: number; actionable: boolean; members: MemberSummary[] };
export type DashboardSnapshot = { activeTeams: number; maxTeams: number; workingSlots: number; maxWorkingSlots: number; counts: { working: number; blocked: number; awaitingReview: number; attention: number; unmanaged: number }; teams: TeamSummary[]; revision: number };
const order = (m: MemberSummary) => ({ blocked: 0, unknown: 0, missing: 0, "awaiting-review": 1, working: 2, idle: 3, done: 4 }[m.liveState] ?? 5);
export function buildDashboardSnapshot(teams: readonly TeamRecord[], snapshot: HerdrSnapshot, maxTeams = 8, maxWorkingSlots = 2): DashboardSnapshot {
  const active = teams.filter(t => t.status === "active");
  let workingSlots = 0, working = 0, blocked = 0, awaitingReview = 0, attention = 0, unmanaged = 0;
  const summaries = active.map(team => {
    const members = team.members.filter(m => m.lifecycle !== "released").map(m => {
      const live = snapshot.agents?.find(a => a.pane_id === m.paneId); const assignment = m.currentAssignmentId ? team.assignments.find(a => a.id === m.currentAssignmentId) : undefined;
      const state = live?.agent_status ?? m.lastObservedState ?? "missing"; if (state === "working") { working++; workingSlots++; } if (["blocked", "unknown", "missing"].includes(state)) blocked++;
      if (assignment?.state === "awaiting-review") awaitingReview++; const memberAttention = team.attention.filter(a => a.memberName === m.name && !a.acknowledgedAt).length; attention += memberAttention;
      if (state === "working" && !assignment) unmanaged++;
      return { name: m.name, purpose: m.purpose, pane: m.paneId, liveState: state, managed: !!assignment, assignment: assignment && { title: assignment.title, state: assignment.state, deadline: assignment.deadline }, attention: memberAttention };
    }).sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
    const unresolvedRequests = (team.requests ?? []).filter(r => ["open", "routed", "deferred"].includes(r.state)).length;
    const teamAttention = team.attention.filter(a => !a.acknowledgedAt).length;
    return { id: team.id, objective: team.objective, lifecycle: team.status, memberCount: members.length, assignmentCount: team.assignments.length, unresolvedRequests, attention: teamAttention, actionable: teamAttention > 0 || unresolvedRequests > 0 || members.some(m => ["blocked", "unknown", "missing"].includes(m.liveState)), members };
  }).sort((a, b) => Number(b.actionable) - Number(a.actionable) || a.id.localeCompare(b.id));
  return Object.freeze({ activeTeams: active.length, maxTeams, workingSlots, maxWorkingSlots, counts: Object.freeze({ working, blocked, awaitingReview, attention, unmanaged }), teams: Object.freeze(summaries.map(t => Object.freeze({ ...t, members: Object.freeze(t.members) }))), revision: teams.reduce((n, t) => n + t.revision, 0) });
}
export function widgetLine(view: DashboardSnapshot, width = 120) { if (!view.activeTeams) return undefined; const full = `Teams ${view.activeTeams}/${view.maxTeams} · slots ${view.workingSlots}/${view.maxWorkingSlots} · working ${view.counts.working} · blocked ${view.counts.blocked} · review ${view.counts.awaitingReview} · attention ${view.counts.attention}`; if (visibleWidth(full) <= width) return full; const essential = `Teams ${view.activeTeams}/${view.maxTeams} · slots ${view.workingSlots}/${view.maxWorkingSlots} · attention ${view.counts.attention}`; return visibleWidth(essential) <= width ? essential : truncateToWidth(essential, width, "…"); }
export function dashboardText(view: DashboardSnapshot) { return view.teams.map(t => `${t.id}: ${t.objective} (${t.members.length} members, ${t.unresolvedRequests} requests, ${t.attention} attention)`).join("\n") || "No active Herdr teams."; }
