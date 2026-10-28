import test from "node:test";
import assert from "node:assert/strict";

import { collectWindows } from "../src/collectors/windows.js";
import { collectWsl } from "../src/collectors/wsl.js";
import { inferProjectPath, processIdentity, redactCommandLine } from "../src/lib/identity.js";

test("redacts credentials before command lines enter a report", () => {
  const command = 'node app.js --token abc123 --password="hunter two" API_KEY=xyz789 --client-secret private --cookie session-id --url https://alice:pass@example.com?a=1&access_token=querysecret -H "Authorization: Bearer verysecrettoken"';
  const safe = redactCommandLine(command);
  for (const secret of ["abc123", "hunter two", "xyz789", "private", "session-id", "alice", "querysecret", "verysecrettoken"]) {
    assert.ok(!safe.includes(secret), `command must not disclose ${secret}`);
  }
  assert.match(safe, /node app\.js/);
  assert.match(safe, /\[REDACTED\]/);
});

test("identifies Windows project paths without inventing a working directory", () => {
  const identity = processIdentity('"C:\\Program Files\\nodejs\\node.exe" "D:\\work\\hello world\\node_modules\\vite\\bin\\vite.js" --host', null);
  assert.equal(identity.projectPath, "D:\\work\\hello world");
  assert.equal(identity.cwd, null);
  assert.equal(identity.identitySource, "commandLine");
  assert.equal(inferProjectPath("node app.js"), null);
  assert.equal(inferProjectPath('node "D:\\work\\server.mjs"'), "D:\\work");
  assert.equal(inferProjectPath("node /home/me/web/server.mjs", "linux"), "/home/me/web");
});

test("uses an observed Linux working directory ahead of command-line inference", () => {
  const identity = processIdentity("node /usr/lib/tool/server.js", "/home/me/project", "linux");
  assert.equal(identity.cwd, "/home/me/project");
  assert.equal(identity.projectPath, "/home/me/project");
  assert.equal(identity.identitySource, "proc");
});

test("does not confuse secrets, configuration files or eval arguments with an entry script", () => {
  assert.equal(processIdentity('node --password "D:\\secret\\password.js"', null).projectPath, null);
  assert.equal(processIdentity('node app.js --config "D:\\config\\server.js"', null).projectPath, null);
  assert.equal(processIdentity('node --config "D:\\config\\server.js"', null).projectPath, null);
  assert.equal(processIdentity('node -e "require(\'net\')" "D:\\fake\\server.js"', null).projectPath, null);
  assert.equal(inferProjectPath('node --require "D:\\hooks\\setup.js" "D:\\app\\server.js"'), "D:\\app");
  assert.equal(inferProjectPath('python -u "D:\\app\\server.py"'), "D:\\app");
  assert.equal(inferProjectPath('pwsh -NoProfile -File "D:\\app\\server.ps1"'), "D:\\app");
});

test("enriches Windows listeners through a PID-scoped CIM query", async () => {
  const calls = [];
  const result = await collectWindows(5173, {
    force: true,
    runCommand: async (file, args) => {
      calls.push({ file, args });
      if (file === "netstat.exe") {
        return { exitCode: 0, stdout: " TCP 127.0.0.1:5173 0.0.0.0:0 LISTENING 22" };
      }
      return { exitCode: 0, stdout: JSON.stringify([{ Pid: 22, ProcessName: "node", ProcessPath: "C:\\node.exe", CommandLine: "node D:\\demo\\server.js --token secretvalue" }]) };
    },
  });
  assert.equal(result.status, "ok");
  assert.equal(result.listeners[0].projectPath, "D:\\demo");
  assert.equal(result.listeners[0].cwd, null);
  assert.doesNotMatch(JSON.stringify(result), /secretvalue/);
  assert.match(calls[1].args.at(-1), /Get-CimInstance Win32_Process/);
  assert.match(calls[1].args.at(-1), /ProcessId = /);
});

test("preserves Windows port evidence when process metadata cannot be read", async () => {
  const result = await collectWindows(5173, {
    force: true,
    runCommand: async (file) => file === "netstat.exe"
      ? { exitCode: 0, stdout: " TCP 127.0.0.1:5173 0.0.0.0:0 LISTENING 22" }
      : { exitCode: 1, stdout: "", stderr: "access denied" },
  });
  assert.equal(result.status, "ok");
  assert.equal(result.listeners[0].pid, 22);
});

test("reads WSL project identity with one batched read-only proc query", async () => {
  const calls = [];
  const result = await collectWsl(5173, {
    force: true,
    distro: "Ubuntu Test",
    runCommand: async (file, args) => {
      calls.push({ file, args });
      if (calls.length === 1) return { exitCode: 0, stdout: '__WPD_DISTRO__Ubuntu Test\nLISTEN 0 511 127.0.0.1:5173 *:* users:(("node",pid=42,fd=8))\nLISTEN 0 511 [::1]:5173 *:* users:(("node",pid=42,fd=9))' };
      return { exitCode: 0, stdout: JSON.stringify([{ pid: 42, commandLine: "node server.js --password=hunter", cwd: "/home/me/web", path: "/usr/bin/node" }]) };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(result.listeners.length, 2);
  assert.equal(result.listeners[0].projectPath, "/home/me/web");
  assert.equal(result.listeners[0].path, "/usr/bin/node");
  assert.equal(result.listeners[0].identitySource, "proc");
  assert.doesNotMatch(JSON.stringify(result), /hunter/);
  assert.equal(calls[1].args[1], "Ubuntu Test");
  assert.match(calls[1].args.at(-1), /os\.readlink/);
  assert.doesNotMatch(calls[1].args.at(-1), /sudo|eval\(/);
});

test("keeps WSL listeners when Python or proc permissions are unavailable", async () => {
  let calls = 0;
  const result = await collectWsl(5173, {
    force: true,
    runCommand: async () => ++calls === 1
      ? { exitCode: 0, stdout: '__WPD_DISTRO__Ubuntu\nLISTEN 0 511 *:5173 *:* users:(("node",pid=42,fd=8))' }
      : { exitCode: 127, stdout: "", stderr: "python unavailable" },
  });
  assert.equal(result.status, "ok");
  assert.equal(result.listeners[0].pid, 42);
  assert.equal(result.listeners[0].commandLine, undefined);
});
