import test from "node:test";
import assert from "node:assert/strict";

import { doctor } from "../src/doctor.js";

function outcome(overrides = {}) {
  return { exitCode: 0, stdout: "", stderr: "", missing: false, timedOut: false, ...overrides };
}

test("doctor checks Windows and optional engines without exposing raw command output", async () => {
  const calls = [];
  const report = await doctor({
    force: true,
    runner: async (file, args, options) => {
      calls.push({ file, args, options });
      if (file === "netstat.exe") return outcome({ stdout: "TCP 127.0.0.1:8080 secret-netstat-output" });
      if (file === "wsl.exe") return outcome({ stdout: "\uFEFFU\0b\0u\0n\0t\0u\0\r\0\n\0D\0e\0b\0i\0a\0n\0\r\0\n\0" });
      return outcome({ stdout: '"29.0.1"' });
    },
  });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.kind, "doctor");
  assert.ok(Number.isFinite(Date.parse(report.checkedAt)));
  assert.equal(report.ready, true);
  assert.deepEqual(report.checks.map((check) => check.id), ["platform", "windows", "wsl", "docker"]);
  assert.ok(report.checks.every((check) => check.status === "ok" && check.code === "OK"));
  assert.match(report.checks[2].detail, /2 WSL distributions/);
  assert.match(report.checks[3].detail, /29\.0\.1/);
  assert.doesNotMatch(JSON.stringify(report), /secret-netstat-output|Debian|Ubuntu/);
  assert.deepEqual(calls.find((call) => call.file === "wsl.exe").args, ["--list", "--quiet"]);
  assert.deepEqual(calls.find((call) => call.file === "netstat.exe").args, ["-ano", "-p", "tcp"]);
  assert.deepEqual(calls.find((call) => call.file === "docker").args, ["--host", "npipe:////./pipe/docker_engine", "info", "--format", "{{json .ServerVersion}}"]);
  assert.ok(calls.every((call) => call.options.timeoutMs === 4_000));
});

test("doctor remains ready when WSL and Docker are optional and absent", async () => {
  const report = await doctor({
    force: true, exists: () => false, env: {},
    runner: async (file) => file === "netstat.exe" ? outcome() : outcome({ exitCode: null, missing: true }),
  });
  assert.equal(report.ready, true);
  assert.deepEqual(report.checks.slice(2).map((check) => [check.status, check.code]), [["warning", "WSL_NOT_INSTALLED"], ["warning", "DOCKER_MISSING"]]);
});

test("doctor detects unsupported platforms without starting Windows utilities", async () => {
  let called = false;
  const report = await doctor({ platform: "linux", runner: async () => { called = true; return outcome(); } });
  assert.equal(called, false);
  assert.equal(report.ready, false);
  assert.equal(report.checks[0].code, "PLATFORM_UNSUPPORTED");
  assert.equal(report.checks[0].status, "error");
});

test("doctor reports failed mandatory Windows collection and optional access errors", async () => {
  const report = await doctor({
    force: true,
    runner: async (file) => {
      if (file === "netstat.exe") return outcome({ timedOut: true, exitCode: null, stderr: "private-windows-log" });
      if (file === "wsl.exe") return outcome({ exitCode: 4294967295, stdout: "W\0s\0l\0/\0S\0e\0r\0v\0i\0c\0e\0/\0E\0_\0A\0C\0C\0E\0S\0S\0D\0E\0N\0I\0E\0D\0" });
      return outcome({ exitCode: 1, stderr: "daemon unavailable; secret-token=redacted-value" });
    },
  });
  assert.equal(report.ready, false);
  assert.equal(report.checks[1].code, "WINDOWS_QUERY_FAILED");
  assert.match(report.checks[1].detail, /timed out/);
  assert.equal(report.checks[2].code, "WSL_QUERY_FAILED");
  assert.match(report.checks[2].detail, /E_ACCESSDENIED/);
  assert.equal(report.checks[3].code, "DOCKER_ENGINE_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(report), /private-windows-log|secret-token|redacted-value/);
});

test("doctor finds Docker Desktop outside PATH and queries only a local named pipe", async () => {
  const dockerPath = "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
  const calls = [];
  const report = await doctor({
    force: true, env: { ProgramFiles: "C:\\Program Files", DOCKER_HOST: "tcp://remote.example:2376" }, exists: (candidate) => candidate === dockerPath,
    runner: async (file, args) => {
      calls.push({ file, args });
      if (file === "docker") return outcome({ missing: true, exitCode: null });
      if (file === dockerPath) return outcome({ stdout: '"28.4.0"' });
      if (file === "wsl.exe") return outcome({ stdout: "Ubuntu" });
      return outcome();
    },
  });
  assert.equal(report.checks[3].status, "ok");
  assert.deepEqual(calls.filter((call) => call.file === "docker" || call.file === dockerPath).map((call) => call.file), ["docker", dockerPath]);
  assert.ok(calls.filter((call) => call.file === "docker" || call.file === dockerPath).every((call) => call.args[1] === "npipe:////./pipe/docker_engine"));
});

test("doctor handles empty WSL registration, thrown runners and malformed daemon versions", async () => {
  const report = await doctor({
    force: true,
    runner: async (file) => {
      if (file === "netstat.exe") throw new Error("private error");
      if (file === "wsl.exe") return outcome({ stdout: "\0\r\0\n" });
      return outcome({ stdout: '"attacker\\nlog"' });
    },
  });
  assert.equal(report.ready, false);
  assert.equal(report.checks[1].code, "WINDOWS_QUERY_FAILED");
  assert.equal(report.checks[2].code, "WSL_NOT_INSTALLED");
  assert.equal(report.checks[3].code, "DOCKER_ENGINE_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(report), /private error|attacker/);
});

test("doctor bounds collector timeouts", async () => {
  for (const [requested, expected] of [[1, 250], [Infinity, 4_000], [999_999, 30_000]]) {
    const calls = [];
    await doctor({ force: true, timeoutMs: requested, runner: async (_file, _args, options) => { calls.push(options.timeoutMs); return outcome(); } });
    assert.ok(calls.every((timeout) => timeout === expected));
  }
});

test("doctor tries Docker Desktop's Linux pipe without using a remote environment context", async () => {
  const calls = [];
  const report = await doctor({
    force: true,
    env: { DOCKER_HOST: "tcp://remote.example:2376", DOCKER_CONTEXT: "production" },
    runner: async (file, args, options) => {
      calls.push({ file, args, options });
      if (file === "docker") {
        return args[1].includes("dockerDesktopLinuxEngine") ? outcome({ stdout: '"29.0.1"' }) : outcome({ exitCode: 1 });
      }
      return outcome({ stdout: file === "wsl.exe" ? "Ubuntu" : "" });
    },
  });
  assert.equal(report.checks[3].status, "ok");
  const dockerCalls = calls.filter((call) => call.file === "docker");
  assert.deepEqual(dockerCalls.map((call) => call.args[1]), ["npipe:////./pipe/docker_engine", "npipe:////./pipe/dockerDesktopLinuxEngine"]);
  assert.ok(dockerCalls.every((call) => !Object.keys(call.options.spawnOptions.env).some((key) => ["DOCKER_HOST", "DOCKER_CONTEXT"].includes(key.toUpperCase()))));
});

test("doctor removes mixed-case Docker host/context variables without mutating the supplied environment", async () => {
  const environment = { Docker_Host: "tcp://private.example:2376", docker_CONTEXT: "remote-production", Path: "C:\\Windows\\System32", KEEP: "value" };
  const before = { ...environment };
  const environments = [];
  await doctor({
    force: true,
    environment,
    runner: async (file, _args, options) => {
      if (file === "docker") {
        environments.push(options.spawnOptions.env);
        return outcome({ stdout: '"29.0.1"' });
      }
      return outcome({ stdout: file === "wsl.exe" ? "Ubuntu" : "" });
    },
  });
  assert.equal(environments.length, 1);
  assert.deepEqual(environments[0], { Path: "C:\\Windows\\System32", KEEP: "value" });
  assert.notEqual(environments[0], environment);
  assert.deepEqual(environment, before);
});
