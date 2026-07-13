// scripts/start-dev.mjs — wrapper to launch `next dev` detached
// Usage: node scripts/start-dev.mjs [port]
import { spawn } from "node:child_process";
import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const port = process.argv[2] ?? "3000";
const pidFile = join(process.cwd(), "tmp-dev.pid");
const logFile = join(process.cwd(), "tmp-dev.log");
const errFile = join(process.cwd(), "tmp-dev-err.log");

// Remove old pid/logs
if (existsSync(pidFile)) unlinkSync(pidFile);

const out = process.stdout;
const err = process.stderr;
const fs = await import("node:fs");
const logFd = fs.openSync(logFile, "w");
const errFd = fs.openSync(errFile, "w");

const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "-p", port],
  {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", logFd, errFd],
    env: { ...process.env }
  }
);

child.unref();
writeFileSync(pidFile, String(child.pid));
out.write(`started dev server pid=${child.pid} port=${port} log=${logFile}\n`);
