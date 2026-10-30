import test from "node:test";
import assert from "node:assert/strict";
import childProcess, { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { runCommand } from "../src/lib/run-command.js";

const COMMAND_TIMEOUT_MS = 1_000;
const FIXTURE_LIFETIME_MS = 6_000;

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      // A killed orphan can remain a zombie until the host reaps it.
      const state = readFileSync(`/proc/${pid}/stat`, "utf8").match(/^\d+ \([\s\S]*\) ([A-Z])/u)?.[1];
      if (state === "Z") return false;
    }
    return true;
  } catch (error) {
    if (["ESRCH", "ENOENT"].includes(error.code)) return false;
    throw error;
  }
}

function stopFixtureProcesses(pids) {
  // These PIDs come only from the fixture we just launched, never an inventory.
  for (const pid of [pids?.descendant, pids?.root]) {
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    if (!processIsRunning(pid)) continue;
    try { process.kill(pid, "SIGKILL"); } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}

function treeFixture({ rootExits = false, escaped = false, pidFile } = {}) {
  return `
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath,
      ["-e", "setTimeout(() => {}, ${FIXTURE_LIFETIME_MS})"], {
        stdio: ["ignore", 1, 2], detached: ${escaped}, windowsHide: true,
      });
    child.once("error", (error) => { console.error(error.message); process.exit(2); });
    child.once("spawn", () => {
      const pids = { root: process.pid, descendant: child.pid };
      ${pidFile ? `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify(pids));` : ""}
      child.unref();
      process.stdout.write("PORTDOC_PIDS=" + JSON.stringify(pids) + "\\n", () => {
        ${rootExits ? "process.exit(0);" : `setTimeout(() => process.exit(0), ${FIXTURE_LIFETIME_MS});`}
      });
    });
  `;
}

function fixturePids(result) {
  const match = result.stdout.match(/PORTDOC_PIDS=(\{[^\r\n]+\})/);
  assert.ok(match, `Fixture did not report its PIDs: ${JSON.stringify(result)}`);
  return JSON.parse(match[1]);
}

async function waitUntilStopped(pid) {
  const deadline = performance.now() + 1_000;
  while (processIsRunning(pid) && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processIsRunning(pid);
}

function runOuterNode(source) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      reject(new Error(`Outer CLI still held handles after 4 seconds: ${stderr}`));
    }, 4_000);
    child.stdout.setEncoding("utf8").on("data", (value) => { stdout += value; });
    child.stderr.setEncoding("utf8").on("data", (value) => { stderr += value; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });
  });
}

test("captures and trims stdout/stderr while preserving a nonzero exit code", async () => {
  const result = await runCommand(process.execPath, ["-e", `
    process.stdout.write("  collected evidence  ");
    process.stderr.write("  collector warning  ");
    process.exitCode = 7;
  `]);
  assert.equal(result.command, process.execPath);
  assert.equal(result.stdout, "collected evidence");
  assert.equal(result.stderr, "collector warning");
  assert.equal(result.exitCode, 7);
  assert.equal(result.timedOut, false);
  assert.equal(result.missing, false);
});

test("reports a successfully completed command", async () => {
  const result = await runCommand(process.execPath, ["-e", 'console.log("complete")']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "complete");
  assert.equal(result.stderr, "");
  assert.equal(result.timedOut, false);
  assert.equal(result.missing, false);
});

test("reports a missing executable without waiting for its timeout", async () => {
  const startedAt = performance.now();
  const result = await runCommand(join(tmpdir(), `portdoc-missing-${process.pid}-${Date.now()}.exe`), []);
  assert.equal(result.exitCode, null);
  assert.equal(result.missing, true);
  assert.equal(result.timedOut, false);
  assert.match(result.stderr, /ENOENT/);
  assert.ok(performance.now() - startedAt < 2_000);
});

test("converts a synchronous spawn error into a command result", async () => {
  const result = await runCommand("invalid\0command", []);
  assert.equal(result.exitCode, null);
  assert.equal(result.missing, false);
  assert.equal(result.timedOut, false);
  assert.match(result.stderr, /null bytes/i);
});

test("retains partial stdout and stderr when a command times out", async () => {
  const startedAt = performance.now();
  const result = await runCommand(process.execPath, ["-e", `
    process.stdout.write("partial evidence");
    process.stderr.write("partial warning");
    setTimeout(() => {}, ${FIXTURE_LIFETIME_MS});
  `], { timeoutMs: COMMAND_TIMEOUT_MS });
  assert.equal(result.timedOut, true);
  assert.equal(result.missing, false);
  assert.equal(result.stdout, "partial evidence");
  assert.equal(result.stderr, "partial warning");
  assert.ok(performance.now() - startedAt < 2_500);
});

test("bounds cleanup even when a child never emits close and releases its handles", async () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    // No real PID: the mocked process must never signal a host process.
    pid: undefined,
    killCalls: 0,
    unrefCalls: 0,
    kill() { this.killCalls += 1; return true; },
    unref() { this.unrefCalls += 1; },
  });
  const originalSpawn = childProcess.spawn;
  // A fake child has no OS handles to keep the event loop alive before timeout.
  const guard = setTimeout(() => {}, 2_000);
  childProcess.spawn = () => child;
  syncBuiltinESMExports();
  try {
    const startedAt = performance.now();
    const result = await runCommand("mock-collector", [], { timeoutMs: 50 });
    const elapsed = performance.now() - startedAt;
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, null);
    assert.ok(elapsed >= 250, `Cleanup returned before exercising its deadline (${elapsed} ms).`);
    assert.ok(elapsed < 1_500, `Cleanup exceeded its bounded deadline (${elapsed} ms).`);
    assert.equal(child.stdout.destroyed, true);
    assert.equal(child.stderr.destroyed, true);
    assert.ok(child.killCalls >= 1);
    assert.ok(child.unrefCalls >= 1);
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
    clearTimeout(guard);
    child.stdout.destroy();
    child.stderr.destroy();
  }
});

test("terminates a live command tree whose descendant inherits its pipes", async (t) => {
  let pids;
  t.after(() => stopFixtureProcesses(pids));
  const startedAt = performance.now();
  const result = await runCommand(process.execPath, ["-e", treeFixture()], { timeoutMs: COMMAND_TIMEOUT_MS });
  pids = fixturePids(result);
  assert.equal(result.timedOut, true);
  assert.ok(performance.now() - startedAt < 2_500);
  assert.equal(await waitUntilStopped(pids.root), true, "The fixture root must be stopped.");
  assert.equal(await waitUntilStopped(pids.descendant), true, "The fixture descendant must be stopped.");
});

test("returns promptly when the root exits before a descendant releases inherited pipes", async (t) => {
  let pids;
  t.after(() => stopFixtureProcesses(pids));
  const startedAt = performance.now();
  const result = await runCommand(process.execPath, ["-e", treeFixture({ rootExits: true })], {
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  pids = fixturePids(result);
  assert.ok(performance.now() - startedAt < 2_500);
  // Windows may close its inherited-pipe view with the root; POSIX keeps it open.
  if (process.platform !== "win32") assert.equal(result.timedOut, true);
  assert.equal(await waitUntilStopped(pids.root), true);
});

test("enforces the cleanup deadline when a POSIX descendant escapes its process group", {
  skip: process.platform === "win32" ? "POSIX process groups only" : false,
}, async (t) => {
  let pids;
  t.after(() => stopFixtureProcesses(pids));
  const startedAt = performance.now();
  const result = await runCommand(process.execPath, ["-e", treeFixture({ escaped: true })], {
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  pids = fixturePids(result);
  assert.equal(result.timedOut, true);
  assert.ok(performance.now() - startedAt < 2_500);
  assert.equal(processIsRunning(pids.descendant), true, "The escaped fixture must survive long enough to exercise the deadline.");
});

test("lets an outer CLI actually exit after timeout without an explicit process.exit", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "portdoc-command-test-"));
  const pidFile = join(directory, "fixture-pids.json");
  t.after(async () => {
    try { stopFixtureProcesses(JSON.parse(await readFile(pidFile, "utf8"))); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try { await unlink(pidFile); } catch (error) { if (error.code !== "ENOENT") throw error; }
    await rmdir(directory);
  });
  const moduleUrl = new URL("../src/lib/run-command.js", import.meta.url).href;
  const source = `
    import { runCommand } from ${JSON.stringify(moduleUrl)};
    const result = await runCommand(process.execPath,
      ["-e", ${JSON.stringify(treeFixture({ escaped: process.platform !== "win32", pidFile }))}],
      { timeoutMs: ${COMMAND_TIMEOUT_MS} });
    console.log(JSON.stringify(result));
  `;
  const startedAt = performance.now();
  const outer = await runOuterNode(source);
  assert.equal(outer.exitCode, 0, outer.stderr);
  assert.equal(JSON.parse(outer.stdout).timedOut, true);
  assert.ok(performance.now() - startedAt < 3_000);
});
