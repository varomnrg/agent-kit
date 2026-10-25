import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildCatalog, renderCatalog, root } from "../scripts/catalog-lib.mjs";
import registerHerdrTeamExtension from "../integrations/herdr-team/index.ts";

test("checked-in catalog is deterministic generated output", async () => {
  const generated = renderCatalog(await buildCatalog());
  assert.equal(await readFile(join(root, "catalog.json"), "utf8"), generated);
});

test("catalog declares stable unique dependency contracts", async () => {
  const catalog = await buildCatalog();
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(new Set(catalog.skills.map((skill) => skill.name)).size, catalog.skills.length);
  const known = new Set(catalog.skills.map((skill) => skill.name));
  for (const skill of catalog.skills) for (const dependency of [...skill.requires, ...skill.optional]) assert.ok(known.has(dependency), `${skill.name} references unknown ${dependency}`);
});

test("explicit Herdr package extension registers both tools without a live server", () => {
  const tools: string[] = [];
  const commands: string[] = [];
  const pi: any = {
    registerTool: (tool: any) => tools.push(tool.name),
    registerCommand: (name: string) => commands.push(name),
    on: () => {},
    sendMessage: async () => {},
  };
  const adapter: any = { snapshot: async () => ({ agents: [] }), prompt: async () => ({ ok: true }), wait: async () => {} };
  const watcherFactory: any = () => ({ start: async () => {}, stop: async () => {}, enqueue: () => true });
  registerHerdrTeamExtension(pi, { stateDir: "/tmp/agent-kit-herdr-registration-test", policyPath: "false", adapter, watcherFactory });
  assert.deepEqual(tools.sort(), ["herdr_cross_team_request", "herdr_team_registry"]);
  assert.deepEqual(commands.sort(), ["team", "teams"]);
});
