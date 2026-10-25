#!/usr/bin/env node
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const skillsRoot = join(root, "skills");
const errors = [];
const names = new Map();
const skillSources = new Map();

const frontmatter = (source) => {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  const value = {};
  for (const line of match[1].split("\n")) {
    const item = line.match(/^([a-z][a-z0-9-]*):\s*(.*)$/);
    if (item) value[item[1]] = item[2].trim();
  }
  return value;
};

const walkMarkdownLinks = async (path, source) => {
  for (const match of source.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
    const target = match[1];
    if (/^(?:https?:|mailto:)/.test(target)) continue;
    try { await stat(resolve(path, "..", target)); }
    catch { errors.push(`${relative(root, path)}: broken link ${target}`); }
  }
};

for (const entry of (await readdir(skillsRoot, { withFileTypes: true })).filter((x) => x.isDirectory())) {
  const path = join(skillsRoot, entry.name, "SKILL.md");
  let source;
  try { source = await readFile(path, "utf8"); }
  catch { errors.push(`${entry.name}: missing SKILL.md`); continue; }
  const fm = frontmatter(source);
  if (fm.name !== entry.name) errors.push(`${entry.name}: frontmatter name is ${fm.name || "missing"}`);
  if (!fm.description) errors.push(`${entry.name}: description is missing`);
  if (names.has(fm.name)) errors.push(`${entry.name}: duplicate name ${fm.name}`);
  names.set(fm.name, entry.name);
  skillSources.set(entry.name, source);
  if (!source.includes("metadata:\n  agent-kit:")) errors.push(`${entry.name}: metadata.agent-kit is missing`);
  await walkMarkdownLinks(path, source);
}

const expected = ["compass-mode", "grill", "grill-with-docs", "diagnosing-bugs", "codebase-design", "domain-modeling", "agent-instructions", "agent-retro", "handoff", "herdr-team"];
for (const name of expected) if (!names.has(name)) errors.push(`missing skill ${name}`);

const grillWithDocs = skillSources.get("grill-with-docs") || "";
if (!grillWithDocs.includes("requires: [grill]")) errors.push("grill-with-docs must require grill");
if ((grillWithDocs.match(/The \*\*frontier\*\*/g) || []).length) errors.push("grill-with-docs duplicates grill's frontier procedure");
const compass = skillSources.get("compass-mode") || "";
if (!compass.includes("disable-model-invocation: true")) errors.push("compass-mode must be explicit-only");

const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (packageJson.name !== "@varomnrg/agent-kit") errors.push("unexpected package name");
if (!packageJson.pi?.extensions?.includes("./integrations/herdr-team/index.ts")) errors.push("Herdr-team extension missing from Pi manifest");

const principles = await readFile(join(root, "skills/compass-mode/references/principles.md"), "utf8");
const principleHeadings = [...principles.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
if (principleHeadings.length !== 15 || new Set(principleHeadings).size !== 15) errors.push(`principles reference has ${principleHeadings.length} headings / ${new Set(principleHeadings).size} unique`);
if ((principles.match(/\*\*Trigger:\*\*/g) || []).length !== 15) errors.push("every owned principle must have one trigger");
if ((principles.match(/\*\*Misuse guard:\*\*/g) || []).length !== 15) errors.push("every owned principle must have one misuse guard");

const pstack = await readFile(join(root, "provenance/pstack.yaml"), "utf8");
const sourcePrinciples = [...pstack.matchAll(/^  - source: (.+)$/gm)].map((m) => m[1]);
if (sourcePrinciples.length !== 24 || new Set(sourcePrinciples).size !== 24) errors.push(`pstack provenance has ${sourcePrinciples.length} entries / ${new Set(sourcePrinciples).size} unique`);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`validated ${names.size} skills, ${principleHeadings.length} owned principles, and ${sourcePrinciples.length} pstack dispositions`);
