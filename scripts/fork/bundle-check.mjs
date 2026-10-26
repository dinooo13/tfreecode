#!/usr/bin/env node
// Scans built output for upstream analytics keys, Clerk keys and relay/ingest hosts,
// and checks that release downloads point at tfreecode.
// Usage: node scripts/fork/bundle-check.mjs [dir...]
// (default: apps/server/dist apps/desktop/dist-electron)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN = [
  { name: "PostHog project key", pattern: /phc_[A-Za-z0-9]{20,}/ },
  { name: "Clerk publishable key", pattern: /pk_(live|test)_[A-Za-z0-9]{10,}/ },
  { name: "analytics ingest host", pattern: /ingest\.t3\.codes/ },
  { name: "T3 Connect relay host", pattern: /relay\.t3\.codes/ },
  { name: "relay tracing host", pattern: /api\.axiom\.co/ },
];
const REQUIRED = [{ name: "tfreecode release repository", pattern: /dinooo13\/tfreecode/ }];
const SCANNED = new Set([".js", ".mjs", ".cjs", ".html", ".json", ".yml"]);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots = (
  process.argv.length > 2
    ? process.argv.slice(2)
    : ["apps/server/dist", "apps/desktop/dist-electron"]
).map((dir) => path.resolve(repoRoot, dir));

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (SCANNED.has(path.extname(entry.name))) yield full;
  }
}

const problems = [];
const found = new Set();
let scanned = 0;
for (const root of roots) {
  if (!fs.existsSync(root)) {
    problems.push(`missing build output: ${path.relative(repoRoot, root)}`);
    continue;
  }
  for (const file of files(root)) {
    scanned += 1;
    const text = fs.readFileSync(file, "utf8");
    for (const { name, pattern } of FORBIDDEN) {
      const match = text.match(pattern);
      if (match) problems.push(`${name} in ${path.relative(repoRoot, file)}: ${match[0]}`);
    }
    for (const { name, pattern } of REQUIRED) if (pattern.test(text)) found.add(name);
  }
}
for (const { name } of REQUIRED)
  if (!found.has(name)) problems.push(`${name} not found in any bundle`);

console.log(`scanned ${scanned} files`);
if (problems.length > 0) {
  console.error(`BUNDLE CHECK FAILED:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("bundle check passed");
