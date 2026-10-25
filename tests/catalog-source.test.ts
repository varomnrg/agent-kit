import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedSkills = ["agent-instructions", "agent-retro", "codebase-design", "compass-mode", "diagnosing-bugs", "domain-modeling", "grill", "grill-with-docs", "handoff", "herdr-team"];

test("source catalog exposes exactly the approved skills", async () => {
  const found = (await readdir(join(root, "skills"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(found, expectedSkills);
  for (const name of found) await stat(join(root, "skills", name, "SKILL.md"));
});

test("Compass stays explicit and owns no playbook catalog", async () => {
  const source = await readFile(join(root, "skills/compass-mode/SKILL.md"), "utf8");
  assert.match(source, /disable-model-invocation: true/);
  await assert.rejects(stat(join(root, "skills/compass-mode/playbooks")));
});

test("grill-with-docs is a thin explicit composite", async () => {
  const source = await readFile(join(root, "skills/grill-with-docs/SKILL.md"), "utf8");
  assert.match(source, /requires: \[grill\]/);
  assert.match(source, /Load and follow `grill`/);
  assert.doesNotMatch(source, /\*\*frontier\*\*/);
});

test("portable source excludes environment-private identifiers", async () => {
  const forbidden = ["/home/" + "varomnrg", "ops" + "-01", "development" + "-01", "taildbceab", "apotek" + "roxy"];
  const paths: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if ([".git", "node_modules"].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path); else paths.push(path);
    }
  };
  await walk(root);
  for (const path of paths) {
    if (path === fileURLToPath(import.meta.url)) continue;
    const source = await readFile(path, "utf8").catch(() => "");
    for (const value of forbidden) assert.equal(source.includes(value), false, `${path} contains forbidden identifier`);
  }
});
