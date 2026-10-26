#!/usr/bin/env node
// Starts the server against a throwaway home directory with egress-guard.mjs preloaded,
// exercises it briefly, and fails if it tried to reach anything outside ALLOWED_HOSTS.
// Usage: node scripts/fork/egress-check.mjs [server entry] (default: apps/server/src/bin.ts)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Plain downloads that carry no usage data: the model manifest and LiteLLM price table
// (GitHub raw) and provider CLI version checks (npm). Provider APIs are reached by the
// provider CLIs themselves, which run as their own processes.
const ALLOWED_HOSTS = new Set(["raw.githubusercontent.com", "registry.npmjs.org"]);
// Never allowed, even if ALLOWED_HOSTS is widened by mistake.
const FORBIDDEN = [/t3\.codes$/, /posthog/, /clerk/, /axiom\.co$/, /cloudflare/, /trycloudflare/];
const FORBIDDEN_COMMANDS = [/cloudflared/];
const RUN_SECONDS = Number(process.env.TFREECODE_EGRESS_SECONDS ?? 45);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const entry = path.resolve(repoRoot, process.argv[2] ?? "apps/server/src/bin.ts");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfreecode-egress-"));
const logPath = path.join(workDir, "egress.jsonl");
const homeDir = path.join(workDir, "home");
const port = 20_000 + Math.floor(Math.random() * 20_000);

const child = spawn(
  process.execPath,
  [entry, "serve", "--base-dir", homeDir, "--host", "127.0.0.1", "--port", String(port)],
  {
    cwd: workDir,
    env: {
      ...process.env,
      T3CODE_HOME: homeDir,
      TFREECODE_EGRESS_LOG: logPath,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${path.join(repoRoot, "scripts/fork/egress-guard.mjs")}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group, so stopping it also stops the provider CLIs it starts.
    detached: true,
  },
);
const stop = (signal) => {
  try {
    process.kill(-child.pid, signal);
  } catch {}
};
let output = "";
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));
let exited = false;
child.on("exit", () => (exited = true));

const base = `http://127.0.0.1:${port}`;
let listening = false;
for (let i = 0; i < 120 && !exited && !listening; i++) {
  await sleep(1000);
  listening = output.includes(`Listening on ${base}`);
}
if (listening) {
  for (const route of ["/", "/api/health", "/.well-known/t3/environment", "/api/auth/session"]) {
    await fetch(`${base}${route}`, { signal: AbortSignal.timeout(5000) }).catch(() => {});
  }
  await sleep(RUN_SECONDS * 1000);
}
stop("SIGTERM");
for (let i = 0; i < 20 && !exited; i++) await sleep(500);
stop("SIGKILL");

const events = fs.existsSync(logPath)
  ? fs
      .readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  : [];
// Provider CLIs (claude, codex, ...) are the user's own tools and talk to their vendors;
// only processes running this checkout's code are judged.
const ownEvents = events.filter((event) => !event.script || event.script.startsWith(repoRoot));
const violations = ownEvents.filter((event) =>
  event.kind === "spawn"
    ? FORBIDDEN_COMMANDS.some((pattern) => pattern.test(event.command))
    : !ALLOWED_HOSTS.has(event.host) || FORBIDDEN.some((pattern) => pattern.test(event.host ?? "")),
);

const summary = [
  ...new Set(
    ownEvents.map((e) => (e.kind === "spawn" ? `spawn ${e.command}` : `${e.kind} ${e.host}`)),
  ),
];
console.log(`server listening: ${listening}; recorded ${events.length} events in ${workDir}`);
for (const line of summary) console.log(`  ${line}`);
if (!listening) {
  console.error(`server never started listening on ${base}. Output:\n${output.slice(-4000)}`);
  process.exit(2);
}
if (violations.length > 0) {
  console.error(
    `\nEGRESS CHECK FAILED: ${violations.length} outbound attempts outside the allowlist`,
  );
  process.exit(1);
}
console.log("\negress check passed");
fs.rmSync(workDir, { recursive: true, force: true });
