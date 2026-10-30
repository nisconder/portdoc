import test from "node:test";
import assert from "node:assert/strict";

import { analyze } from "../src/analyze.js";
import { buildNextActions } from "../src/advice.js";
import { formatDoctor, formatScan, formatText } from "../src/format.js";
import { scan } from "../src/scan.js";

const ANSI = /\u001b\[/;
const flatten = (value) => value.replace(/\s+/g, " ");

function inventory(sources = {}) {
  const defaults = {
    windows: { status: "ok", listeners: [] },
    wsl: { status: "ok", distro: "Ubuntu", listeners: [] },
    docker: { status: "ok", mappings: [] },
  };
  return Object.fromEntries(Object.entries({ ...defaults, ...sources }).map(([name, result]) => [name, async () => result]));
}

function listener(port, pid, address = "127.0.0.1") {
  return { port, pid, address, process: "node" };
}

function mapping(port, address, id = "a".repeat(64)) {
  return { containerId: id, container: id[0] === "a" ? "demo-web-1" : "second-web-1", composeService: id[0] === "a" ? "web" : "second", image: "nginx", hostPort: port, hostAddress: address, containerPort: 80, protocol: "tcp" };
}

function doctorReport(ready) {
  return {
    schemaVersion: 1,
    kind: "doctor",
    checkedAt: "2026-10-30T00:00:00.000Z",
    ready,
    checks: [
      { id: "platform", status: "ok", code: "OK", detail: "Windows host inspection is supported." },
      ready
        ? { id: "windows", status: "ok", code: "OK", detail: "Windows TCP listener inspection is available." }
        : { id: "windows", status: "error", code: "WINDOWS_QUERY_FAILED", detail: "Windows TCP listener inspection timed out.", command: "netstat -ano -p tcp" },
      { id: "wsl", status: "warning", code: "WSL_QUERY_FAILED", detail: "WSL distribution inspection failed (Wsl/Service/E_ACCESSDENIED).", command: "wsl --status" },
      { id: "docker", status: "warning", code: "DOCKER_MISSING", detail: "Docker CLI was not found.", command: "docker --version" },
    ],
  };
}

function reservedReport(listeners = []) {
  const report = {
    schemaVersion: 3,
    kind: "diagnosis",
    checkedAt: "2026-10-30T00:00:00.000Z",
    port: 50000,
    protocol: "tcp",
    target: "127.0.0.1",
    sources: {
      windows: { status: "ok", listeners },
      wsl: { status: "ok", distro: "Ubuntu", listeners: [] },
      docker: { status: "ok", mappings: [] },
    },
    probes: { windows: { status: "skipped", reachable: null }, wsl: { status: "skipped", reachable: null } },
    reservations: {
      status: "ok",
      ranges: [{ family: 4, start: 50000, end: 50059, administered: true }],
      matches: [{ family: 4, start: 50000, end: 50059, administered: true }],
      families: { ipv4: { status: "ok" }, ipv6: { status: "ok" } },
    },
  };
  report.assessment = analyze(report);
  report.nextActions = buildNextActions(report);
  return report;
}

test("scan explains a display limit and retains the full overlap count when the overlap is hidden", async () => {
  const report = await scan({
    limit: 1,
    inventory: inventory({
      windows: { status: "ok", listeners: [listener(80, 1), listener(5173, 2), listener(8080, 3)] },
      wsl: { status: "ok", listeners: [listener(5173, 4)] },
    }),
  });
  assert.equal(report.overlapCount, 1);
  assert.equal(report.ports[0].overlap, false);
  for (const language of ["en", "zh-CN"]) {
    const output = formatScan(report, { language, width: 80 });
    const text = flatten(output);
    assert.doesNotMatch(output, /5173/);
    assert.match(output, /portdoc 80/);
    if (language === "en") {
      assert.match(text, /Showing 1 of 3 matching ports/);
      assert.match(text, /1 potential overlaps across the full matching inventory/);
      assert.match(text, /Results are truncated/);
    } else {
      assert.match(text, /显示 3 个匹配端口中的 1 个/);
      assert.match(text, /共有 1 项可能重叠/);
      assert.match(text, /结果已截断/);
    }
    assert.match(output, /--limit/);
    assert.match(output, /--issues-only/);
  }
});

test("an empty scan with failed sources remains explicitly incomplete", async () => {
  const report = await scan({ inventory: inventory({
    windows: { status: "error", listeners: [], reason: "Windows inventory timed out." },
    wsl: { status: "error", listeners: [], reason: "E_ACCESSDENIED" },
  }) });
  const english = flatten(formatScan(report, { language: "en", width: 80 }));
  const chinese = flatten(formatScan(report, { language: "zh-CN", width: 80 }));
  assert.match(english, /No matching ports were observed in the available sources/);
  assert.match(english, /inventory is incomplete/);
  assert.match(english, /Windows inventory timed out/);
  assert.match(chinese, /可检查的来源中未观察到匹配端口/);
  assert.match(chinese, /当前端口列表不完整/);
  for (const output of [english, chinese]) {
    assert.match(output, /portdoc doctor/);
    assert.doesNotMatch(output, /\bFREE\b|all ports are free|所有端口.*可用/i);
  }
});

test("dual-stack Docker mappings count each container only once per port", async () => {
  const report = await scan({ inventory: inventory({ docker: { status: "ok", mappings: [
    mapping(8080, "0.0.0.0"), mapping(8080, "::"), mapping(8443, "0.0.0.0"), mapping(8443, "::"),
  ] } }) });
  const output = formatScan(report, { language: "en", width: 100 });
  const rows = output.split("\n").filter((line) => /^\s+(?:8080|8443)\s/.test(line));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((line) => /\bweb\s*$/.test(line)));
  assert.ok(rows.every((line) => !/\+\d/.test(line)));

  const secondContainer = await scan({ inventory: inventory({ docker: { status: "ok", mappings: [
    mapping(8080, "0.0.0.0"), mapping(8080, "::"), mapping(8080, "192.0.2.1", "b".repeat(64)),
  ] } }) });
  const line = formatScan(secondContainer, { language: "en", width: 100 }).split("\n").find((value) => /^\s+8080\s/.test(value));
  assert.match(line, /\bweb \+1\s*$/);
  assert.doesNotMatch(line, /\+2/);
});

test("scan and doctor support narrow English and Chinese output with color only when requested", async () => {
  const report = await scan({ inventory: inventory({
    windows: { status: "ok", listeners: [listener(5173, 4242)] },
    wsl: { status: "ok", listeners: [listener(5173, 42)] },
  }) });
  for (const language of ["en", "zh-CN"]) {
    for (const [formatter, value] of [[formatScan, report], [formatDoctor, doctorReport(false)]]) {
      const output = formatter(value, { width: 40, language });
      assert.doesNotMatch(output, ANSI);
      assert.doesNotMatch(formatter(value, { width: 40, language, color: false }), ANSI);
      assert.match(formatter(value, { width: 40, language, color: true }), ANSI);
      assert.match(output, /PORTDOC/);
      assert.match(output, language === "en" ? /Windows/ : /检查|概览/);
    }
    const narrowScan = formatScan(report, { width: 40, language });
    assert.match(narrowScan, /\n  5173\/tcp\n/);
    assert.match(narrowScan, /Windows: node #4242/);
    assert.match(narrowScan, /WSL: node #42/);
  }
});

test("doctor distinguishes mandatory readiness from optional layers and preserves verification commands", () => {
  for (const language of ["en", "zh-CN"]) {
    const failed = formatDoctor(doctorReport(false), { width: 80, language });
    const ready = formatDoctor(doctorReport(true), { width: 80, language });
    assert.match(flatten(failed), language === "en" ? /inspection needs attention/ : /监听检查需要处理/);
    assert.match(flatten(ready), language === "en" ? /inspection is ready/ : /监听检查可用/);
    assert.match(failed, /Wsl\/Service\/E_ACCESSDENIED/);
    assert.match(failed, /netstat -ano -p tcp/);
    assert.match(failed, /wsl --status/);
    assert.match(ready, /docker --version/);
    assert.match(ready, /portdoc scan/);
  }
});

test("a reserved port without listeners is rendered as a restriction to review, with its exact range command", () => {
  const report = reservedReport();
  assert.equal(report.assessment.verdict, "UNKNOWN");
  for (const language of ["en", "zh-CN"]) {
    const output = formatText(report, { language, width: 80 });
    assert.match(flatten(output), language === "en" ? /No listener found, but Windows excludes this TCP port/ : /未发现监听，但 Windows 排除了此 TCP 端口/);
    assert.match(output, /IPv4\s+50000–50059 \*/);
    assert.match(output, /netsh interface ipv4 show excludedportrange protocol=tcp/);
    assert.doesNotMatch(output, /Get-Process|\bFREE\b/);
    assert.match(flatten(output), language === "en" ? /does not prove an occupying process or a guaranteed bind failure/ : /不能证明有进程占用或绑定必然失败/);
  }
});

test("an observed reserved-port listener keeps its actual PID and one matching verification command", () => {
  const report = reservedReport([listener(50000, 4242), listener(50000, 4242, "::")]);
  assert.equal(report.assessment.verdict, "OK");
  assert.equal(report.assessment.confidence, "medium");
  for (const language of ["en", "zh-CN"]) {
    const output = formatText(report, { language, width: 80 });
    assert.match(output, /node \(PID 4242\)/);
    assert.equal((output.match(/Get-Process -Id 4242/g) ?? []).length, 1);
    for (const action of report.nextActions) assert.ok(output.includes(action.command));
    assert.doesNotMatch(flatten(output), /No listener found|未发现监听，但/);
    assert.match(output, /50000–50059/);
  }
});

test("diagnostic verification-command truncation is explicit and the full report remains available", () => {
  const report = reservedReport(Array.from({ length: 8 }, (_, index) => listener(50000, 5000 + index)));
  assert.equal(report.nextActions.length, 9);
  for (const language of ["en", "zh-CN"]) {
    const output = formatText(report, { language, width: 80 });
    const commands = output.split("\n").filter((line) => /^\s+Get-Process -Id/.test(line));
    assert.equal(commands.length, 6);
    assert.match(flatten(output), language === "en" ? /More verification commands are available in --json/ : /更多验证命令可在 --json 中查看/);
    assert.doesNotMatch(output, /Get-Process -Id 5006/);
    assert.equal(report.nextActions.at(-1).code, "VERIFY_RESERVED_RANGE");
  }
});
