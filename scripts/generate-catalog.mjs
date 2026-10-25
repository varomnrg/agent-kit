#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildCatalog, renderCatalog, root } from "./catalog-lib.mjs";

await writeFile(join(root, "catalog.json"), renderCatalog(await buildCatalog()));
