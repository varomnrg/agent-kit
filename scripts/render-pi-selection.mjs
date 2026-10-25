#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { root, select } from "./catalog-lib.mjs";

try {
  const catalog = JSON.parse(await readFile(join(root, "catalog.json"), "utf8"));
  process.stdout.write(JSON.stringify(select(catalog, process.argv[2]), null, 2) + "\n");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
