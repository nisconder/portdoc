import test from "node:test";
import assert from "node:assert/strict";

import { main, parseArgs } from "../src/cli.js";

test("parses the port and supported options", () => {
  assert.deepEqual(parseArgs(["3000", "--json", "--no-color", "--lang", "zh-CN", "--distro", "Ubuntu", "--docker-path", "C:\\Docker\\docker.exe", "--no-probe", "--timeout", "900"]), {
    port: 3000,
    json: true,
    color: false,
    lang: "zh-CN",
    distro: "Ubuntu",
    dockerPath: "C:\\Docker\\docker.exe",
    probe: false,
    timeoutMs: 900,
  });
});

test("rejects invalid ports", () => {
  assert.throws(() => parseArgs(["70000"]), /Invalid TCP port/);
  assert.throws(() => parseArgs(["three-thousand"]), /Invalid TCP port/);
  assert.throws(() => parseArgs(["3000", "--lang", "fr"]), /auto, en, or zh-CN/);
});

test("supports a detailed help command without requiring a port", async () => {
  const writes = [];
  const exitCode = await main(["help", "--lang", "en"], {
    stdout: (value) => writes.push(value),
    stderr: (value) => writes.push(value),
  });
  assert.equal(exitCode, 0);
  assert.match(writes[0], /3000 is only an example/);
  assert.match(writes[0], /WHAT GETS CHECKED/);
  assert.match(writes[0], /VERDICTS/);
  assert.match(writes[0], /SAFETY AND LIMITS/);
});

test("treats a bare portdoc invocation exactly like portdoc help", async () => {
  const bareWrites = [];
  const helpWrites = [];
  const bareExitCode = await main([], {
    systemLocale: "en-US",
    environment: {},
    stdout: (value) => bareWrites.push(value),
    stderr: (value) => bareWrites.push(value),
  });
  const helpExitCode = await main(["help"], {
    systemLocale: "en-US",
    environment: {},
    stdout: (value) => helpWrites.push(value),
    stderr: (value) => helpWrites.push(value),
  });

  assert.equal(bareExitCode, 0);
  assert.equal(helpExitCode, 0);
  assert.deepEqual(bareWrites, helpWrites);
});

test("renders Simplified Chinese help", async () => {
  const writes = [];
  const exitCode = await main(["help", "--lang=zh-CN"], {
    stdout: (value) => writes.push(value),
    stderr: (value) => writes.push(value),
  });
  assert.equal(exitCode, 0);
  assert.match(writes[0], /3000 只是示例/);
  assert.match(writes[0], /诊断结果/);
});

test("localizes invocation errors", async () => {
  const writes = [];
  const exitCode = await main(["not-a-port", "--lang", "zh-CN"], {
    stdout: (value) => writes.push(value),
    stderr: (value) => writes.push(value),
  });
  assert.equal(exitCode, 2);
  assert.match(writes[0], /无效的 TCP 端口/);
  assert.match(writes[1], /查看用法/);
});

test("JSON mode returns conflict exit code and a machine-readable report", async () => {
  const writes = [];
  const report = {
    assessment: { verdict: "CONFLICT" },
  };
  const exitCode = await main(["3000", "--json", "--lang", "zh-CN"], {
    diagnose: async () => report,
    stdout: (value) => writes.push(value),
    stderr: (value) => writes.push(value),
  });
  assert.equal(exitCode, 1);
  assert.deepEqual(JSON.parse(writes[0]), report);
});

test("demo is offline, explicitly labeled, localized and exits successfully", async () => {
  const writes = [];
  const dependencies = {
    stdout: (value) => writes.push(value),
    diagnose: () => { throw new Error("demo must never query the machine"); },
  };
  assert.equal(await main(["demo", "--lang", "zh-CN"], dependencies), 0);
  assert.match(writes[0], /模拟样例，未检查当前系统/);
  writes.length = 0;
  assert.equal(await main(["demo", "--json"], dependencies), 0);
  const report = JSON.parse(writes[0]);
  assert.equal(report.sample, true);
  assert.equal(report.schemaVersion, 3);
  assert.equal(report.endpointMatrix.windows.ipv4.reachable, true);
  assert.equal(report.endpointMatrix.windows.ipv6.reachable, false);
});

test("routes scan with scoped options and emits inventory JSON without diagnosing a port", async () => {
  const writes = [];
  const report = { kind: "scan", overlapCount: 1, ports: [{ port: 5173, overlap: true }], sources: { windows: { status: "ok" }, wsl: { status: "ok" }, docker: { status: "ok" } } };
  const exitCode = await main(["scan", "--limit", "5", "--issues-only", "--json"], {
    stdout: (value) => writes.push(value),
    scan: async (options) => { assert.equal(options.limit, 5); assert.equal(options.issuesOnly, true); return report; },
    diagnose: () => assert.fail("scan must not start a per-port diagnosis"),
  });
  assert.equal(exitCode, 1);
  assert.deepEqual(JSON.parse(writes[0]), report);
  assert.throws(() => parseArgs(["3000", "--limit", "5"]), /require the scan command/);
  assert.throws(() => parseArgs(["scan", "--limit=501"]), /1 to 500/);
  assert.throws(() => parseArgs(["scan", "--limit", "1.5"]), /1 to 500/);
});

test("doctor exit status depends on required host checks, not optional warnings", async () => {
  const ready = { kind: "doctor", ready: true, checks: [{ id: "docker", status: "warning", code: "DOCKER_MISSING" }] };
  const writes = [];
  assert.equal(await main(["doctor", "--json"], { stdout: (value) => writes.push(value), doctor: async () => ready }), 0);
  assert.equal(await main(["doctor", "--json"], { stdout: () => {}, doctor: async () => ({ ...ready, ready: false }) }), 2);
  assert.deepEqual(JSON.parse(writes[0]), ready);
  assert.throws(() => parseArgs(["doctor", "--no-probe"]), /checks the Windows host/);
});

test("provides command-specific localized help without running collectors", async () => {
  for (const args of [["scan", "--help", "--lang", "zh-CN"], ["help", "scan", "--lang", "zh-CN"]]) {
    const writes = [];
    assert.equal(await main(args, { stdout: (value) => writes.push(value) }), 0);
    assert.match(writes[0], /--issues-only/);
    assert.match(writes[0], /不逐个连接全端口/);
  }
  const writes = [];
  assert.equal(await main(["doctor", "--help", "--lang", "en"], { stdout: (value) => writes.push(value) }), 0);
  assert.match(writes[0], /local named pipes/);
});
