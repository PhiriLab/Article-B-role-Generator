#!/usr/bin/env node
/**
 * Inject data/analysis.json into dashboard/template.html and emit the
 * self-contained dashboard/index.html (no network requests, opens via file://).
 *
 * Usage: node dashboard/build.mjs
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const analysis = await readFile(path.join(ROOT, "data", "analysis.json"), "utf8");
const template = await readFile(path.join(ROOT, "dashboard", "template.html"), "utf8");

const marker = "/*__DATA__*/null";
if (!template.includes(marker)) throw new Error("Data marker not found in template.html");
// </script> inside JSON strings would terminate the inline script block early.
const safe = JSON.stringify(JSON.parse(analysis)).replaceAll("</", "<\\/");
const html = template.replace(marker, safe);

await writeFile(path.join(ROOT, "dashboard", "index.html"), html);
console.log(`Built dashboard/index.html (${(html.length / 1024).toFixed(0)} KB)`);
