import { homedir } from "node:os";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { acknowledgeMemberAttention, acknowledgeRequestAttention, addMember, adoptTeam, createCrossTeamRequest, createTeam, managedDispatch, recordOutcome, recoverCoordinatorRuntime, releaseMember, retainMember, retireTeam, resolveCrossTeamRequest, routeCrossTeamRequest } from "./coordinator.ts";
import { buildDashboardSnapshot, dashboardText, widgetLine } from "./dashboard.ts";
import { createTeamsComponent } from "./teams-ui.ts";
import { safeId, type TeamRecord } from "./model.ts";
import { ensureStateDir, listTeams, readTeam, resolveStateDir } from "./store.ts";
import { createHerdrAdapter, type HerdrAdapter } from "./herdr-adapter.ts";
import { createWatcherManager, type Watcher, type Wake } from "./watcher.ts";

const Lifecycle = StringEnum(["one-task", "until-mission-complete", "retained-for-follow-up"] as const);
const Outcome = StringEnum(["accepted", "follow-up-required", "failed", "cancelled"] as const);
const DispatchItem = Type.Object({
  teamId: Type.String(), member: Type.String(), title: Type.String({ minLength: 1, maxLength: 200 }),
  objective: Type.String({ minLength: 1, maxLength: 2000 }), scope: Type.String({ minLength: 1, maxLength: 2000 }),
  expectedOutput: Type.String({ minLength: 1, maxLength: 2000 }), prompt: Type.String({ minLength: 1, maxLength: 20000 }),
  artifactPaths: Type.Optional(Type.Array(Type.String({ maxLength: 500 }), { maxItems: 20 })),
  acceptance: Type.Optional(Type.Array(Type.String({ maxLength: 500 }), { maxItems: 20 })), deadline: Type.Optional(Type.String()),
});
const Params = Type.Object({
  action: StringEnum(["create", "add", "status", "inspect", "retain", "retire", "adopt", "managed_dispatch", "record_outcome", "route_request", "answer_request", "reject_request", "defer_request"] as const),
  teamId: Type.Optional(Type.String()), objective: Type.Optional(Type.String()), member: Type.Optional(Type.String()), paneId: Type.Optional(Type.String()),
  purpose: Type.Optional(Type.String()), scope: Type.Optional(Type.String()), expectedCwd: Type.Optional(Type.String()), expectedRef: Type.Optional(Type.String()),
  retentionReason: Type.Optional(Type.String()), releaseVerified: Type.Optional(Type.Boolean()), lifecycle: Type.Optional(Lifecycle), assignmentId: Type.Optional(Type.String()),
  outcome: Type.Optional(Outcome), summary: Type.Optional(Type.String({ maxLength: 1000 })), answer: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })), reason: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })), assignments: Type.Optional(Type.Array(DispatchItem, { minItems: 1, maxItems: 8 })), requestId: Type.Optional(Type.String()), expectedRevision: Type.Optional(Type.Integer({ minimum: 0 })),
});
const MemberRequestParams = Type.Object({
  destinationTeamId: Type.Optional(Type.String()), capability: Type.Optional(Type.String()),
  title: Type.String({ minLength: 1, maxLength: 200 }), question: Type.String({ minLength: 1, maxLength: 4000 }),
  reason: Type.String({ minLength: 1, maxLength: 2000 }), blocking: Type.Boolean(),
  artifactPaths: Type.Optional(Type.Array(Type.String({ maxLength: 500 }), { maxItems: 20 })),
});

export const herdrFocusArgv = (pane: string) => ({ file: "herdr", args: ["agent", "focus", pane] });
const defaultFocus = async (pane: string) => { const { execFile } = await import("node:child_process"); const argv = herdrFocusArgv(pane); await new Promise<void>((resolve, reject) => execFile(argv.file, argv.args, { timeout: 5000 }, error => error ? reject(error) : resolve())); };
export type ExtensionDeps = { focus?: (pane: string) => Promise<void>; adapter: HerdrAdapter; stateDir: string; policyPath?: string; options: { maxActiveTeams: number; maxWorkingMembers: number; historyLimit?: number; attentionCoalesceMs?: number }; watcherFactory: typeof createWatcherManager };
export function defaultExtensionDeps(): ExtensionDeps { return { adapter: createHerdrAdapter(), stateDir: process.env.HERDR_TEAM_STATE_DIR || resolveStateDir(), policyPath: process.env.HERDR_TEAM_POLICY_PATH || new URL("./policy.json", import.meta.url).pathname, options: { maxActiveTeams: 8, maxWorkingMembers: 2, historyLimit: 20 }, watcherFactory: createWatcherManager }; }
export async function loadPolicy(path: string, fallback: ExtensionDeps["options"]): Promise<ExtensionDeps["options"]> { if (path === "false") return fallback; const { readFile } = await import("node:fs/promises"); const value = JSON.parse(await readFile(path, "utf8")); if (!Number.isInteger(value.max_active_teams) || value.max_active_teams < 1 || !Number.isInteger(value.max_working_members) || value.max_working_members < 1 || !Number.isInteger(value.assignment_history_per_member) || value.assignment_history_per_member < 1 || !Number.isInteger(value.attention_coalesce_ms) || value.attention_coalesce_ms < 0) throw new Error(`Invalid Herdr team policy at ${path}`); return { maxActiveTeams: value.max_active_teams, maxWorkingMembers: value.max_working_members, historyLimit: value.assignment_history_per_member, attentionCoalesceMs: value.attention_coalesce_ms } as ExtensionDeps["options"] & { attentionCoalesceMs: number }; }
const identity = (ctx: ExtensionContext) => ({ sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile(), paneId: process.env.HERDR_PANE_ID, cwd: ctx.cwd });
const requireTeam = (id?: string) => { if (!id) throw new Error("teamId is required for this mutation"); return safeId(id); };
const concise = (team: TeamRecord) => [`Team ${team.id}: ${team.objective}`, ...team.members.filter(m => m.lifecycle !== "released").map(m => `- ${m.name}: ${m.lifecycle}; assignment ${m.currentAssignmentId ?? "none"}`)].join("\n");

export function registerHerdrTeamExtension(pi: ExtensionAPI, supplied?: Partial<ExtensionDeps>) {
  const defaults = defaultExtensionDeps(); const deps: ExtensionDeps = { ...defaults, ...supplied, stateDir: supplied?.stateDir || defaults.stateDir || `${homedir()}/.local/state/pi/herdr-teams` };
  let watcher: Watcher | undefined; let watcherOwnerSessionId: string | undefined; let checked = false; let gate = false; let watching = false;
  const teamsFor = async (ctx: ExtensionContext) => { const me = identity(ctx); const all = await listTeams(deps.stateDir); return { me, owned: all.filter(t => t.status === "active" && t.ownerSessionId === me.sessionId), adoptable: all.filter(t => t.status === "active" && t.ownerSessionId !== me.sessionId && t.ownerPaneId === me.paneId && t.repository === me.cwd) }; };
  const statusText = async (ctx: ExtensionContext) => { checked = true; const x = await teamsFor(ctx); return [...x.owned.map(concise), ...x.adoptable.map(t => `Adoptable team ${t.id} from the previous Pi session in this pane.`)].join("\n\n") || "No active Herdr team is owned by this Pi session."; };
  const sendWakes = async (wakes: Wake[]) => { const bounded = wakes.slice(0, 20); const current = await listTeams(deps.stateDir); const blocking = current.filter(t => t.status === "active" && t.ownerSessionId === watcherOwnerSessionId).flatMap(t => (t.requests ?? []).filter(r => r.blocking && ["open", "routed", "deferred"].includes(r.state)).map(r => `${t.id}/${r.id}`)).slice(0, 20); await pi.sendMessage({ customType: "herdr-team-attention", content: `Herdr attention: ${bounded.map(w => `${w.teamId}/${w.memberName}: ${w.state}`).join("; ")}${blocking.length ? `; blocking requests ${blocking.join(", ")}` : ""}`, display: false, details: { teamIds: bounded.map(w => w.teamId), memberNames: bounded.map(w => w.memberName), sequences: bounded.map(w => w.sequence), blockingRequestIds: blocking } }, { deliverAs: "followUp", triggerTurn: true }); }
  const enqueueWake = (wake: Wake) => { if (!watcher?.enqueue?.(wake)) void sendWakes([wake]); };
  const startWatcher = async (ctx: ExtensionContext) => { if (watching) return; watching = true; const x = await teamsFor(ctx); watcherOwnerSessionId = x.me.sessionId; watcher = deps.watcherFactory({ ownerSessionId: x.me.sessionId, coalesceMs: deps.options.attentionCoalesceMs ?? 250, maxWorkingMembers: deps.options.maxWorkingMembers, adapter: deps.adapter, stateDir: deps.stateDir, send: sendWakes, reconcileMs: 250, onTransitionCommitted: () => { void refreshWidget(ctx); }, onWakeDelivered: () => { void refreshWidget(ctx); } }); void watcher.start(); };
  const refreshWidget = async (ctx: ExtensionContext) => { if (!ctx.hasUI || typeof ctx.ui.setWidget !== "function") return; const view = buildDashboardSnapshot((await listTeams(deps.stateDir)).filter(t => t.ownerSessionId === identity(ctx).sessionId), await deps.adapter.snapshot(), deps.options.maxActiveTeams, deps.options.maxWorkingMembers); const line = widgetLine(view, process.stdout.columns || 120); ctx.ui.setWidget("herdr-teams", line ? [line] : undefined, { placement: "belowEditor" }); };
  const execute = async (ctx: ExtensionContext, p: any): Promise<string> => {
    const x = await teamsFor(ctx); const me = x.me;
    if (p.action === "status") return statusText(ctx);
    checked = true;
    if (p.action === "create") {
      if (process.env.HERDR_ENV !== "1" || !me.paneId) throw new Error("Creating a persistent team requires a Herdr-managed Pi pane");
      return `Created dynamic team ${(await createTeam(me.sessionId, { id: safeId(p.teamId || p.objective), objective: p.objective, repository: me.cwd, ownerSessionFile: me.sessionFile, ownerPaneId: me.paneId }, deps.options, deps.stateDir, deps.adapter)).id}.`;
    }
    if (p.action === "managed_dispatch") return JSON.stringify(await managedDispatch(me.sessionId, { assignments: p.assignments }, deps.adapter, deps.options, deps.stateDir));
    if (["route_request", "answer_request", "reject_request", "defer_request"].includes(p.action) && (!p.requestId || !Number.isInteger(p.expectedRevision))) throw new Error("requestId and integer expectedRevision are required for request resolution");
    if (p.action === "route_request") { const item = p.assignments?.length === 1 ? p.assignments[0] : undefined; if (!item || !item.teamId || !item.member || !item.title || !item.objective || !item.scope || !item.expectedOutput || !item.prompt) throw new Error("route_request requires exactly one complete assignment"); }
    if (["answer_request", "reject_request", "defer_request"].includes(p.action)) { if (!p.requestId) throw new Error("requestId is required"); const text = p.action === "answer_request" ? p.answer : p.reason; if (typeof text !== "string" || !text.trim()) throw new Error(`${p.action === "answer_request" ? "answer" : "reason"} is required`); return JSON.stringify(await resolveCrossTeamRequest(me.sessionId, p.requestId, p.action.slice(0, -8) as any, text, p.expectedRevision, deps.adapter, deps.stateDir)); }
    if (p.action === "route_request") return JSON.stringify(await routeCrossTeamRequest(me.sessionId, p.requestId, p.assignments?.[0], p.expectedRevision, deps.adapter, deps.options, deps.stateDir));
    const id = requireTeam(p.teamId);
    if (p.action === "adopt") return `Adopted team ${(await adoptTeam(me.sessionId, id, { paneId: me.paneId, cwd: me.cwd }, deps.options, deps.stateDir, deps.adapter)).id}.`;
    if (p.action === "record_outcome") return JSON.stringify(await recordOutcome(me.sessionId, id, p.assignmentId, { state: p.outcome, summary: p.summary || "" }, deps.options, deps.stateDir, deps.adapter));
    if (p.action === "add") { if (p.paneId === me.paneId) throw new Error("The coordinating Pi pane cannot be registered as its own team member"); return `Registered ${(await addMember(me.sessionId, id, p, deps.adapter, deps.options, deps.stateDir)).members.at(-1)?.name}.`; }
    if (p.action === "retain") return `Retained ${(await retainMember(me.sessionId, id, p.member, p.retentionReason, deps.adapter, deps.stateDir)).members.find(m => m.name === p.member)?.name}.`;
    if (p.action === "retire") { if (!p.member) return `Retired ${(await retireTeam(me.sessionId, id, deps.stateDir, deps.adapter)).id}.`; const result = await releaseMember(me.sessionId, id, p.member, p.releaseVerified === true, deps.adapter, deps.stateDir); const member = result.members.find((item) => item.name === p.member); return member?.lifecycle === "cleanup-required" ? `Member ${p.member} is still live and marked cleanup-required.` : `Released ${p.member}.`; }
    if (p.action === "inspect") { const t = (await listTeams(deps.stateDir)).find(t => t.id === id && t.ownerSessionId === me.sessionId); if (!t) throw new Error(`teamId ${id} is not owned by this coordinator`); return concise(t); }
    throw new Error(`Unsupported action ${p.action}`);
  };
  pi.registerTool({ name: "herdr_team_registry", label: "Herdr Team Registry", description: "Coordinator-only team registry and Cross-Team Request resolution. Capability-addressed requests are routed only to a coordinator-selected, exact, different, owned active team and member through Managed Dispatch; the selected capability is recorded on the resolution. Resolution never prompts or resumes the source.", parameters: Params, async execute(_id, p, _signal, _update, ctx) { try { const text = await execute(ctx, p); await refreshWidget(ctx); return { content: [{ type: "text", text }], details: { action: p.action } }; } catch (error) { return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], details: { action: p.action }, isError: true }; } } });
  pi.registerTool({ name: "herdr_cross_team_request", label: "Herdr Cross-Team Request", description: "Create a structured request from the registered member represented by the current Herdr pane. This tool cannot route or resolve requests.", parameters: MemberRequestParams, async execute(_id, p, _signal, _update, ctx) { try { if (process.env.HERDR_ENV !== "1" || !identity(ctx).paneId) throw new Error("Cross-team requests require a Herdr-managed member pane"); const result = await createCrossTeamRequest(identity(ctx).sessionId, { ...p, onAttention: async event => enqueueWake({ teamId: event.teamId, memberName: event.memberName, state: "blocked", sequence: event.sequence, priority: 0, requestId: event.requestId }) }, deps.adapter, deps.options, deps.stateDir, { paneId: identity(ctx).paneId!, cwd: identity(ctx).cwd }); await refreshWidget(ctx); return { content: [{ type: "text", text: JSON.stringify(result) }], details: { requestId: result.id, state: result.state } }; } catch (error) { return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], details: {}, isError: true }; } } });
  pi.registerCommand("team", { description: "Show Herdr teams", handler: async (_args, ctx) => ctx.ui.notify(await statusText(ctx), "info") });
  pi.registerCommand("teams", { description: "Show Herdr teams dashboard", handler: async (_args, ctx) => {
    const load = async () => { const teams = (await listTeams(deps.stateDir)).filter(t => t.ownerSessionId === identity(ctx).sessionId); const snapshot = buildDashboardSnapshot(teams, await deps.adapter.snapshot(), deps.options.maxActiveTeams, deps.options.maxWorkingMembers); const requests = teams.flatMap(t => (t.requests ?? []).map(r => ({ id: r.id, sourceTeamId: t.id, sourceMember: r.sourceMember, destination: "teamId" in r.destination ? r.destination.teamId : r.destination.capability, title: r.title, question: r.question, reason: r.reason, blocking: r.blocking, state: r.state, artifactPaths: r.artifactPaths, resolution: r.resolution }))); return { snapshot, requests, revision: teams.reduce((n, t) => n + t.revision, 0) }; };
    if (ctx.mode !== "tui") { ctx.ui.notify(dashboardText((await load()).snapshot), "info"); return; }
    const initial = await load();
    await ctx.ui.custom((tui, theme, _kb, done) => createTeamsComponent(initial.snapshot, initial.requests, theme, done, {
      refresh: load,
      acknowledgeMember: async (teamId, member) => { const team = await readTeam(teamId, deps.stateDir); const event = [...team.attention].reverse().find(a => a.memberName === member && !a.requestId && !a.acknowledgedAt); if (event) { await acknowledgeMemberAttention(identity(ctx).sessionId, teamId, member, deps.adapter, deps.stateDir); await refreshWidget(ctx); } },
      acknowledgeRequest: async (teamId, requestId) => { await acknowledgeRequestAttention(identity(ctx).sessionId, teamId, requestId, deps.adapter, deps.stateDir); await refreshWidget(ctx); },
      confirm: async (title, message) => ctx.ui.confirm(title, message),
      input: async (title, message) => { const value = await ctx.ui.input(title, message); return value?.slice(0, 500); },
      retain: async (teamId, member, reason) => { await retainMember(identity(ctx).sessionId, teamId, member, reason, deps.adapter, deps.stateDir); await refreshWidget(ctx); },
      release: async (teamId, member) => { await releaseMember(identity(ctx).sessionId, teamId, member, false, deps.adapter, deps.stateDir); await refreshWidget(ctx); },
      retire: async teamId => { await retireTeam(identity(ctx).sessionId, teamId, deps.stateDir, deps.adapter); await refreshWidget(ctx); },
      notify: (message) => ctx.ui.notify(message, "error"),
      focus: pane => (deps.focus ?? defaultFocus)(pane),
    }, tui), { overlay: true, overlayOptions: { maxHeight: "80%", width: "90%", anchor: "center" } });
  } });
  pi.on("session_start", async (_event, ctx) => { if (deps.policyPath) { try { deps.options = await loadPolicy(deps.policyPath, deps.options); } catch (error) { throw new Error(`Herdr team policy failed closed: ${error instanceof Error ? error.message : String(error)}`); } } await ensureStateDir(deps.stateDir); try { await recoverCoordinatorRuntime(identity(ctx).sessionId, deps.adapter, deps.stateDir); } catch (error) { ctx.ui.notify(`Herdr team recovery deferred: ${error instanceof Error ? error.message : String(error)}`, "warning"); } const x = await teamsFor(ctx); if (ctx.hasUI && (x.owned.length || x.adoptable.length)) ctx.ui.notify(x.owned.length ? `Persistent Herdr teams active: ${x.owned.map(t => t.id).join(", ")}` : `Adoptable Herdr teams: ${x.adoptable.map(t => t.id).join(", ")}`, "info"); await startWatcher(ctx); await refreshWidget(ctx); });
  pi.on("agent_start", () => { checked = false; gate = false; });
  pi.on("before_agent_start", async (_event, ctx) => { const x = await teamsFor(ctx); if (!x.owned.length && !x.adoptable.length) return; return { message: { customType: "herdr-team-reminder", content: [...x.owned.map(concise), ...x.adoptable.map(t => `Adoptable team ${t.id}.`)].join("\n\n"), display: false, details: { ownedTeamIds: x.owned.map(t => t.id), adoptableTeamIds: x.adoptable.map(t => t.id) } } }; });
  pi.on("agent_before_settle", async (event, ctx) => { if (event.outcome !== "completed" || !event.context.canContinue || checked || gate) return; const x = await teamsFor(ctx); const live = await deps.adapter.snapshot(); const actionable = x.owned.filter(t => t.attention.some(a => !a.acknowledgedAt) || (t.requests ?? []).some(r => ["open", "routed", "deferred"].includes(r.state) && r.blocking) || t.members.some(m => { const agent = live.agents?.find(a => a.pane_id === m.paneId); const assignment = m.currentAssignmentId && t.assignments.find(a => a.id === m.currentAssignmentId); return m.lifecycle !== "retained-for-follow-up" && (["blocked", "missing", "unknown"].includes(agent?.agent_status ?? m.lastObservedState ?? "missing") || ((agent?.agent_status === "working") && !assignment)); })); if (!actionable.length) return; gate = true; return { entries: [{ type: "custom_message", customType: "herdr-team-soft-gate", content: `Check actionable Herdr teams before finalizing: ${actionable.map(t => t.id).join(", ")}.`, display: false, details: { teamIds: actionable.map(t => t.id) } }], continue: true }; });
  pi.on("session_shutdown", async () => { if (watcher) await watcher.stop(); watcher = undefined; watcherOwnerSessionId = undefined; watching = false; });
}
export default registerHerdrTeamExtension;
