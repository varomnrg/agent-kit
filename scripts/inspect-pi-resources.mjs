#!/usr/bin/env node
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { buildCatalog, root, select } from "./catalog-lib.mjs";

const selection = select(await buildCatalog(), process.argv[2]);
const agentDir = await mkdtemp(join(tmpdir(), "agent-kit-pi-agent-"));
const settings = SettingsManager.inMemory({ packages: [{ source: root, ...selection }] }, { projectTrusted: true });
const loader = new DefaultResourceLoader({ cwd: agentDir, agentDir, settingsManager: settings, noContextFiles: true, noPromptTemplates: true, noThemes: true });
await loader.reload();
const skills = loader.getSkills();
const extensions = loader.getExtensions();
const diagnostics = [...skills.diagnostics, ...extensions.errors, ...extensions.warnings].map((item) => String(item?.error?.message || item?.message || item));
process.stdout.write(JSON.stringify({
  skills: skills.skills.filter((skill) => skill.filePath.startsWith(root)).map((skill) => skill.name).sort(),
  extensions: extensions.extensions.filter((extension) => extension.path.startsWith(root)).map((extension) => extension.path.slice(root.length + 1)).sort(),
  diagnostics,
}, null, 2) + "\n");
