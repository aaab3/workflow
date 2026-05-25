#!/usr/bin/env node
/**
 * Write default workflow JSON files to workflows/ and workflows/templates/
 */

import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

async function main() {
  const seedPath = pathToFileURL(
    join(ROOT, "packages/workflow-server/dist/seed/default-workflows.js")
  ).href;
  const { DEFAULT_WORKFLOW_TEMPLATES, writeTemplateFiles, TEMPLATES_DIR } = await import(seedPath);

  const workflowDir = join(ROOT, "workflows");
  const templatesDir = join(ROOT, "packages/workflow-server/src/seed/templates");

  await mkdir(workflowDir, { recursive: true });
  await mkdir(join(workflowDir, "seed-data"), { recursive: true });
  await writeTemplateFiles(templatesDir);

  const { writeFile } = await import("node:fs/promises");
  for (const wf of DEFAULT_WORKFLOW_TEMPLATES) {
    const safe = wf.id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const content = JSON.stringify(wf, null, 2);
    await writeFile(join(workflowDir, `${safe}.json`), content, "utf-8");
    await writeFile(join(templatesDir, `${safe}.json`), content, "utf-8");
  }

  console.log(`Seeded ${DEFAULT_WORKFLOW_TEMPLATES.length} templates to:`);
  console.log(`  - ${workflowDir}`);
  console.log(`  - ${templatesDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
