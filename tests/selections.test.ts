import test from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, select } from "../scripts/catalog-lib.mjs";

const catalog = await buildCatalog();
const names = (selection: ReturnType<typeof select>) => selection.skills.map((entry) => entry.replace("skills/", ""));

test("core and development have approved exact membership", () => {
  assert.deepEqual(names(select(catalog, "core")), ["agent-retro", "compass-mode", "grill", "grill-with-docs", "handoff"]);
  assert.deepEqual(names(select(catalog, "development")), ["agent-instructions", "agent-retro", "codebase-design", "compass-mode", "diagnosing-bugs", "domain-modeling", "grill", "grill-with-docs", "handoff"]);
});

test("full contains every non-integration skill and no executable extension", () => {
  const result = select(catalog, "full");
  assert.equal(names(result).includes("herdr-team"), false);
  assert.deepEqual(result.extensions, []);
});

test("individual selection adds required but not optional dependencies", () => {
  assert.deepEqual(names(select(catalog, "grill-with-docs")), ["grill", "grill-with-docs"]);
  assert.equal(names(select(catalog, "grill-with-docs")).includes("domain-modeling"), false);
});

test("explicit Herdr integration selects its skill and extension", () => {
  const result = select(catalog, "development,+integration:herdr-team");
  assert.equal(names(result).includes("herdr-team"), true);
  assert.deepEqual(result.extensions, ["integrations/herdr-team/index.ts"]);
});

test("unknown selection fails", () => {
  assert.throws(() => select(catalog, "unknown"), /unknown skill or bundle/);
});
