import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse } from "yaml";

export const root = resolve(new URL("..", import.meta.url).pathname);
export const core = ["agent-retro", "compass-mode", "grill", "grill-with-docs", "handoff"];
export const development = [...core, "agent-instructions", "codebase-design", "diagnosing-bugs", "domain-modeling"].sort();

export async function buildCatalog() {
  const skills = [];
  const dirs = (await readdir(join(root, "skills"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  for (const name of dirs) {
    const path = join(root, "skills", name, "SKILL.md");
    const source = await readFile(path, "utf8");
    const match = source.match(/^---\n([\s\S]*?)\n---\n/);
    if (!match) throw new Error(`${name}: missing frontmatter`);
    const fm = parse(match[1]);
    const metadata = fm?.metadata?.["agent-kit"];
    if (!metadata) throw new Error(`${name}: missing metadata.agent-kit`);
    skills.push({
      name,
      kind: metadata.kind,
      path: `skills/${name}`,
      requires: [...(metadata.requires || [])].sort(),
      optional: [...(metadata.optional || [])].sort(),
      ...(metadata.integration ? { integration: metadata.integration } : {}),
      pi: { skills: [`skills/${name}`] },
    });
  }
  const normalSkills = skills.filter((skill) => !skill.integration).map((skill) => skill.name).sort();
  return {
    schemaVersion: 1,
    skills,
    integrations: [{ name: "herdr-team", skill: "herdr-team", pi: { extensions: ["integrations/herdr-team/index.ts"] } }],
    bundles: { core, development, full: normalSkills },
  };
}

export const renderCatalog = (catalog) => JSON.stringify(catalog, null, 2) + "\n";

export function select(catalog, expression) {
  if (!expression?.trim()) throw new Error("selection is required");
  const requestedSkills = new Set();
  const requestedIntegrations = new Set();
  const byName = new Map(catalog.skills.map((skill) => [skill.name, skill]));
  for (const token of expression.split(",").map((part) => part.trim()).filter(Boolean)) {
    if (token.startsWith("+integration:")) {
      const name = token.slice("+integration:".length);
      if (!catalog.integrations.some((item) => item.name === name)) throw new Error(`unknown integration ${name}`);
      requestedIntegrations.add(name);
      continue;
    }
    const members = catalog.bundles[token];
    if (members) for (const member of members) requestedSkills.add(member);
    else if (byName.has(token)) requestedSkills.add(token);
    else throw new Error(`unknown skill or bundle ${token}`);
  }
  for (const integrationName of requestedIntegrations) requestedSkills.add(catalog.integrations.find((item) => item.name === integrationName).skill);
  const visiting = new Set();
  const addRequired = (name) => {
    if (visiting.has(name)) throw new Error(`dependency cycle at ${name}`);
    const skill = byName.get(name);
    if (!skill) throw new Error(`missing required skill ${name}`);
    visiting.add(name);
    for (const dep of skill.requires) { requestedSkills.add(dep); addRequired(dep); }
    visiting.delete(name);
  };
  for (const name of [...requestedSkills]) addRequired(name);
  const skills = [...requestedSkills].sort().map((name) => `skills/${name}`);
  const extensions = [...requestedIntegrations].sort().flatMap((name) => catalog.integrations.find((item) => item.name === name).pi.extensions).sort();
  return { skills, extensions };
}
