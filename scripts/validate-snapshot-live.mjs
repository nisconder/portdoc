// Creates only its own loopback listener, captures it, closes it, then compares.
// Raw snapshots contain local paths/commands. Keep them local unless reviewed.
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") throw new Error("This live collector check requires Windows.");
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--out") throw new Error("Usage: node scripts/validate-snapshot-live.mjs --out <new-directory>");
const output = path.resolve(args[1]);
await mkdir(output); // A new directory prevents accidental evidence overwrites.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "bin", "portdoc.js");
const server = net.createServer((socket) => socket.end());
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const port = server.address().port;
const beforeFile = path.join(output, "before.json");
const afterFile = path.join(output, "after.json");
const summary = {
  kind: "portdoc-snapshot-live-validation", checkedAt: new Date().toISOString(),
  environment: { platform: process.platform, release: os.release(), arch: process.arch, node: process.version },
  port, ownPid: process.pid, independent: {}, exits: {}, sourceStatus: {}, checks: {},
  limitations: ["One Windows host only; no Docker service is started or network configuration changed.", "Existing WSL/Docker availability is recorded, not simulated as successful.", "IPv6, Docker container lifecycle and WSL network-mode transitions are not established by this case."],
};
try {
  summary.independent.before = await connect(port);
  summary.exits.before = await run(["snapshot", String(port), "--out", beforeFile, "--timeout", "10000", "--lang", "en"], "capture-before");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  summary.independent.after = await connect(port);
  summary.exits.after = await run(["snapshot", String(port), "--out", afterFile, "--timeout", "10000", "--lang", "en"], "capture-after");
  summary.exits.diff = await run(["diff", beforeFile, afterFile, "--json", "--lang", "en"], "diff");
  const before = JSON.parse(await readFile(beforeFile, "utf8"));
  const after = JSON.parse(await readFile(afterFile, "utf8"));
  const diff = JSON.parse(await readFile(path.join(output, "diff.stdout.txt"), "utf8"));
  for (const side of ["windows", "wsl", "docker"]) summary.sourceStatus[side] = [before.report.sources[side].status, after.report.sources[side].status];
  summary.checks.ownListenerObserved = before.report.sources.windows.listeners.some((row) => row.pid === process.pid && row.port === port);
  summary.checks.ownListenerAbsentAfterClose = !after.report.sources.windows.listeners.some((row) => row.pid === process.pid && row.port === port);
  summary.checks.listenerRemovalReported = diff.changes.some((item) => item.category === "listener-removed" && item.source === "windows" && item.before?.pid === process.pid);
  summary.checks.ipv4TransitionReported = diff.changes.some((item) => item.category === "endpoint" && item.source === "windows.ipv4" && item.before.reachable === true && item.after.reachable === false);
  summary.checks.incompleteExitPreserved = diff.complete ? summary.exits.diff === 1 : summary.exits.diff === 2;
  summary.checks.failedSourcesNotReportedRemoved = ["windows", "wsl", "docker"].every((side) =>
    summary.sourceStatus[side].every((status) => status === "ok") || !diff.changes.some((item) => item.source === side && ["listener-removed", "mapping-removed"].includes(item.category)));
  summary.diff = { complete: diff.complete, changed: diff.changed, changes: diff.changes.length, unknown: diff.unknown.length };
  summary.result = summary.independent.before === true && summary.independent.after === false && Object.values(summary.checks).every(Boolean) ? "passed" : "not-passed";
} finally {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await writeFile(path.join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
}
console.log(JSON.stringify(summary, null, 2));
if (summary.result !== "passed") process.exitCode = 1;

function run(arguments_, name) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [entry, ...arguments_], { timeout: 60000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, async (error, stdout, stderr) => {
      try {
        await writeFile(path.join(output, `${name}.stdout.txt`), stdout, { flag: "wx" });
        await writeFile(path.join(output, `${name}.stderr.txt`), stderr, { flag: "wx" });
        if (error && ![1, 2].includes(error.code)) return reject(error);
        resolve(error?.code ?? 0);
      } catch (failure) { reject(failure); }
    });
  });
}

function connect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const finish = (reachable) => { socket.destroy(); resolve(reachable); };
    socket.once("connect", () => finish(true));
    socket.once("error", (error) => finish(error.code === "ECONNREFUSED" ? false : null));
    socket.setTimeout(2000, () => finish(null));
  });
}
