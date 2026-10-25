import { matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { DashboardSnapshot, TeamSummary, MemberSummary } from "./dashboard.ts";
import { dashboardText } from "./dashboard.ts";

export type RequestView = { id: string; sourceTeamId: string; sourceMember: string; destination: string; title: string; question: string; reason: string; blocking: boolean; state: string; artifactPaths: string[]; resolution?: { summary: string } };
export type TeamsUIActions = {
  refresh: () => Promise<{ snapshot: DashboardSnapshot; requests: RequestView[]; revision: number }>;
  acknowledgeMember?: (teamId: string, member: string) => Promise<void>;
  retain?: (teamId: string, member: string, reason: string) => Promise<void>;
  confirm?: (title: string, message: string) => Promise<boolean>;
  input?: (title: string, message: string) => Promise<string | undefined>;
  release?: (teamId: string, member: string) => Promise<void>;
  retire?: (teamId: string) => Promise<void>;
  acknowledgeRequest?: (teamId: string, requestId: string) => Promise<void>;
  focus?: (pane: string) => Promise<void>;
  notify?: (message: string) => void;
};

type Selection = { kind: "team" | "member" | "request"; team?: TeamSummary; member?: MemberSummary; request?: RequestView };
export type TeamsComponent = Component & { selection?: () => Selection | undefined; scrollOffset?: () => number };

function line(theme: Theme, text: string, width: number, selected = false) {
  const prefix = selected ? theme.fg("accent", "› ") : "  ";
  return truncateToWidth(prefix + text, width);
}

export function createTeamsComponent(initial: DashboardSnapshot, initialRequests: RequestView[], theme: Theme, done: (value?: unknown) => void, actions: TeamsUIActions, tui: { requestRender(): void; terminal?: { rows: number; columns?: number } }): TeamsComponent {
  let view = initial;
  let requests = initialRequests;
  let revision = initial.revision;
  let teamIndex = 0, childIndex = -1;
  let mode: "teams" | "members" | "detail" = "teams";
  let detail: Selection | undefined;
  let busy = false;
  let viewportHeight = 12; let scrollOffset = 0;
  const selected = (): Selection | undefined => {
    const team = view.teams[teamIndex];
    if (!team) return undefined;
    if (mode === "teams") return { kind: "team", team };
    const member = team.members[childIndex];
    if (member) return { kind: "member", team, member };
    const teamRequests = requests.filter(r => r.sourceTeamId === team.id).sort((a, b) => Number(b.state === "open") - Number(a.state === "open") || b.id.localeCompare(a.id));
    const request = teamRequests[childIndex - team.members.length];
    if (request) return { kind: "request", team, request };
    return { kind: "team", team };
  };
  const reload = async () => { const next = await actions.refresh(); view = next.snapshot; requests = next.requests; revision = next.revision; teamIndex = Math.min(teamIndex, Math.max(0, view.teams.length - 1)); childIndex = -1; mode = "teams"; tui.requestRender(); };
  const activate = async () => {
    const current = selected(); if (!current) return;
    if (mode === "teams") { mode = "members"; childIndex = 0; tui.requestRender(); return; }
    if (mode === "members") { detail = current; mode = "detail"; if (current.member && actions.acknowledgeMember) await actions.acknowledgeMember(current.team!.id, current.member.name); if (current.request && actions.acknowledgeRequest) await actions.acknowledgeRequest(current.team!.id, current.request.id); tui.requestRender(); return; }
  };
  const mutate = async (fn: (() => Promise<void>) | undefined, label: string) => { if (!fn || busy) return; const before = revision; busy = true; try { const latest = await actions.refresh(); if (latest.revision !== before) { view = latest.snapshot; requests = latest.requests; revision = latest.revision; mode = "teams"; childIndex = -1; tui.requestRender(); await actions.confirm?.("State changed", "The dashboard changed. Review the refreshed exact IDs and confirm again."); return; } try { await fn(); } catch (error) { actions.notify?.(error instanceof Error ? error.message : String(error)); } await reload(); } finally { busy = false; tui.requestRender(); } void label; };
  const component: TeamsComponent = {
    selection: selected,
    render(width) {
      if (tui.terminal?.rows) viewportHeight = Math.max(4, Math.floor(tui.terminal.rows * 0.8));
      const team = view.teams[teamIndex]; const lines: string[] = [theme.fg("accent", theme.bold(" Herdr Teams ")), theme.fg("muted", `${view.activeTeams}/${view.maxTeams} teams · ${view.counts.attention} attention · Esc closes`), ""];
      if (!team) return lines.concat([theme.fg("dim", "No active teams."), "", theme.fg("dim", "Enter/Esc")]).map(x => truncateToWidth(x, width));
      if (mode === "teams") { view.teams.forEach((t, i) => lines.push(line(theme, `${t.id} — ${t.objective} [${t.members.length} members, ${t.unresolvedRequests} requests, ${t.attention} attention]`, width, i === teamIndex))); lines.push("", theme.fg("dim", "↑↓/jk navigate · Enter members · q/Esc close")); }
      else if (mode === "members") { lines.push(line(theme, `${team.id} — ${team.objective}`, width)); team.members.forEach((m, i) => lines.push(line(theme, `${m.name} · ${m.liveState}${m.managed ? " · managed" : " · unmanaged"}${m.attention ? ` · attention ${m.attention}` : ""}`, width, i === childIndex))); requests.filter(r => r.sourceTeamId === team.id).sort((a, b) => Number(b.state === "open") - Number(a.state === "open") || b.id.localeCompare(a.id)).forEach((r, i) => lines.push(line(theme, `Request ${r.id} · ${r.state} · ${r.title}`, width, i + team.members.length === childIndex))); lines.push("", theme.fg("dim", "Enter details · Esc teams")); }
      else if (detail?.member) { const m = detail.member; lines.push(theme.fg("success", `${team.id}/${m.name}`), `Purpose: ${m.purpose}`, `Pane: ${m.pane}`, `State: ${m.liveState}`, `Assignment: ${m.assignment?.title ?? "none"}`, "", theme.fg("dim", "f focus · r retain · x release · Esc back")); }
      else if (detail?.request) { const r = detail.request; lines.push(theme.fg("success", `Request ${r.id}`), `Source: ${r.sourceMember}`, `Destination: ${r.destination}`, `Blocking: ${r.blocking}`, `State: ${r.state}`, `Title: ${r.title}`, `Question: ${r.question}`, `Reason: ${r.reason}`, `Artifacts: ${r.artifactPaths.join(", ") || "none"}`, r.resolution ? `Resolution: ${r.resolution.summary}` : "", "", theme.fg("dim", "Esc back")); }
      const body = lines.map(x => truncateToWidth(x, width)); const selectedRow = mode === "teams" ? teamIndex + 3 : childIndex + 4; const maxOffset = Math.max(0, body.length - viewportHeight); if (selectedRow < scrollOffset) scrollOffset = selectedRow; if (selectedRow >= scrollOffset + viewportHeight) scrollOffset = selectedRow - viewportHeight + 1; scrollOffset = Math.max(0, Math.min(scrollOffset, maxOffset)); return body.slice(scrollOffset, scrollOffset + viewportHeight);
    },
    invalidate() { scrollOffset = Math.max(0, scrollOffset); },
    scrollOffset: () => scrollOffset,
    async handleInput(data) {
      if (matchesKey(data, "escape") || matchesKey(data, "q")) { if (mode === "teams") done(); else { mode = mode === "detail" ? "members" : "teams"; if (mode === "teams") childIndex = -1; tui.requestRender(); } return; }
      if (matchesKey(data, "up") || matchesKey(data, "k")) { if (mode === "teams") teamIndex = Math.max(0, teamIndex - 1); else childIndex = Math.max(0, childIndex - 1); tui.requestRender(); return; }
      if (matchesKey(data, "down") || matchesKey(data, "j")) { if (mode === "teams") teamIndex = Math.min(view.teams.length - 1, teamIndex + 1); else { const team = view.teams[teamIndex]; const count = (team?.members.length ?? 0) + requests.filter(r => r.sourceTeamId === team?.id).length; childIndex = Math.min(Math.max(0, count - 1), childIndex + 1); } tui.requestRender(); return; }
      if (matchesKey(data, "enter")) { await activate(); return; }
      if (matchesKey(data, "t") && (mode === "teams" || mode === "members" || mode === "detail")) { const team = view.teams[teamIndex]; if (team && (!actions.confirm || await actions.confirm("Retire team", `${team.id}: registry metadata only; no pane is closed`))) await mutate(actions.retire ? () => actions.retire!(team.id) : undefined, "retire"); return; }
      if (mode === "detail" && detail?.member) {
        if (matchesKey(data, "f")) { const pane = detail.member.pane; done(); await actions.focus?.(pane); return; }
        if (matchesKey(data, "r")) { const reason = actions.input ? await actions.input("Retain member", `${detail!.team!.id}/${detail!.member!.name} reason`) : undefined; if (reason?.trim() && (!actions.confirm || await actions.confirm("Retain member", `${detail!.team!.id}/${detail!.member!.name}: ${reason}`))) await mutate(actions.retain ? () => actions.retain!(detail!.team!.id, detail!.member!.name, reason.trim()) : undefined, "retain"); }
        if (matchesKey(data, "x")) { if (!actions.confirm || await actions.confirm("Release member", `${detail!.team!.id}/${detail!.member!.name}`)) await mutate(actions.release ? () => actions.release!(detail!.team!.id, detail!.member!.name) : undefined, "release"); }
        if (matchesKey(data, "t")) await mutate(actions.retire ? () => actions.retire!(detail!.team!.id) : undefined, "retire");
      }
    },
  };
  void dashboardText;
  void visibleWidth;
  return component;
}
