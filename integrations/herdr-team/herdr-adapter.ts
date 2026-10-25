import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LiveState } from "./model.ts";
const execFileAsync = promisify(execFile);
export type LiveAgent = { pane_id?: string; agent_status?: LiveState; state_change_seq?: number; revision?: number; cwd?: string; foreground_cwd?: string; name?: string; agent_name?: string; agent?: string };
export type HerdrSnapshot = { agents?: LiveAgent[] };
export type ExecFileLike = (file: string, args: string[], options: Record<string, unknown>) => any;
export type WaitProcess = { kill(signal?: string): boolean; once(event: string, listener: () => void): unknown };
export type SpawnWaitLike = (file: string, args: string[], options: Record<string, unknown>) => WaitProcess;
export type WaitState = LiveState | undefined;
export type HerdrAdapter = { snapshot(): Promise<HerdrSnapshot>; prompt(target: string, text: string): Promise<{ ok: true } | { ok: false; reasonCode: string }>; wait(target: string, previousState?: WaitState, signal?: AbortSignal): Promise<void> };
export function waitUntil(previous?: WaitState): string[] { if (previous === "working") return ["idle", "done", "blocked", "unknown"]; if (previous === "idle" || previous === "done") return ["working", "blocked", "unknown", previous === "idle" ? "done" : "idle"]; if (previous === "blocked" || previous === "unknown" || previous === "missing") return ["working", "idle", "done", "blocked", "unknown"]; return ["working", "idle", "done", "blocked", "unknown"]; }
export function adapterArgv(command: string, operation: "snapshot" | "prompt" | "wait", target?: string, text?: string, previous?: WaitState) { if (operation === "snapshot") return { file: command, args: ["api", "snapshot"] }; if (operation === "prompt") return { file: command, args: ["agent", "prompt", target!, text!] }; return { file: command, args: ["agent", "wait", target!, "--until", ...waitUntil(previous), "--timeout", "30000"] }; }
export function createHerdrAdapter(command = "herdr", exec: ExecFileLike = execFileAsync as unknown as ExecFileLike, spawnWait: SpawnWaitLike = execFile as unknown as SpawnWaitLike): HerdrAdapter {
  return {
    async snapshot() { const argv = adapterArgv(command, "snapshot"); const { stdout } = await exec(argv.file, argv.args, { encoding: "utf8", timeout: 2500, maxBuffer: 2 * 1024 * 1024 }); const result = JSON.parse(stdout) as { result?: { snapshot?: HerdrSnapshot } }; if (!result.result?.snapshot) throw new Error("Herdr returned no session snapshot"); return result.result.snapshot; },
    async prompt(target, text) { try { const argv = adapterArgv(command, "prompt", target, text); await exec(argv.file, argv.args, { encoding: "utf8", timeout: 10000, maxBuffer: 256 * 1024 }); return { ok: true }; } catch (error: any) { return { ok: false, reasonCode: error?.code === "ETIMEDOUT" ? "prompt-timeout" : "prompt-failed" }; } },
    async wait(target, previousState, signal) { if (previousState && typeof (previousState as any).addEventListener === "function") { signal = previousState as any; previousState = undefined; } if (signal?.aborted) return; const argv = adapterArgv(command, "wait", target, undefined, previousState); const child = spawnWait(argv.file, argv.args, { encoding: "utf8", maxBuffer: 256 * 1024 }); const abort = () => child.kill("SIGTERM"); signal?.addEventListener("abort", abort, { once: true }); await new Promise<void>(resolve => child.once("close", () => resolve())); signal?.removeEventListener("abort", abort); },
  };
}
