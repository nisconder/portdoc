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

test("treats blank or control-only command lines as missing identity", () => {
  for (const command of [null, "", "   ", "\u0000\t\n\u001b\u007f\u009f"]) {
    assert.equal(redactCommandLine(command), null);
    assert.deepEqual(processIdentity(command, null), {
      commandLine: null, cwd: null, projectPath: null, identitySource: null,
    });
  }
});

test("redacts complete quoted credentials before truncating long command lines", () => {
  const secret = "sensitive words ".repeat(800);
  for (const argument of [`--password="${secret}"`, `--token '${secret}'`, `API_KEY='${secret}'`]) {
    const safe = redactCommandLine(`node app.js ${argument} --host`);
    assert.doesNotMatch(safe, /sensitive|words/);
    assert.match(safe, /\[REDACTED\]/);
    assert.match(safe, /--host$/);
  }
  assert.equal(redactCommandLine(`node ${"x".repeat(9000)}`).length, 8192);
});

test("redacts credentials containing escaped quotes or missing closing quotes", () => {
  for (const argument of [
    String.raw`--token="fake\" PRIVATE_TAIL"`,
    String.raw`--password 'fake\' PRIVATE_TAIL'`,
    'API_KEY="fake PRIVATE_TAIL',
    '--secret "fake PRIVATE_TAIL\\',
  ]) {
    const safe = redactCommandLine(`node app.js ${argument}`);
    assert.doesNotMatch(safe, /fake|PRIVATE_TAIL/);
    assert.match(safe, /\[REDACTED\]$/);
  }
  assert.equal(redactCommandLine(String.raw`node app.js --token="fake\" PRIVATE_TAIL" --host`), "node app.js --token=[REDACTED] --host");
});

test("normalizes control separators before redacting command-line credentials", () => {
  for (const separator of ["\u0000", "\u001b", "\u0085"]) {
    assert.equal(redactCommandLine(`node app.js --token${separator}PRIVATE_VALUE`), "node app.js --token [REDACTED]");
  }
});

test("handles long dotted identifiers while retaining credential name boundaries", () => {
  const identifier = "x.".repeat(32768);
  assert.equal(redactCommandLine(identifier), identifier.slice(0, 8192));
  for (const name of ["token.", "token-"]) {
    const repeated = name.repeat(10923);
    assert.equal(redactCommandLine(repeated), repeated.slice(0, 8192));
  }
  assert.equal(redactCommandLine(`--token="${identifier} PRIVATE_TAIL" --host`), "--token=[REDACTED] --host");
  assert.equal(redactCommandLine('node app.js --client.secret "PRIVATE_VALUE" npm_config_token=PRIVATE_VALUE auth.token:PRIVATE_VALUE'),
    "node app.js --client.secret [REDACTED] npm_config_token=[REDACTED] auth.token:[REDACTED]");
  assert.equal(redactCommandLine('node app.js --ordinary --token PRIVATE_VALUE WRAPPER="API_KEY=PRIVATE_VALUE"'),
    "node app.js --ordinary --token [REDACTED] WRAPPER=\"API_KEY=[REDACTED]");
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
