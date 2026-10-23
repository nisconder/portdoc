import test from "node:test";
import assert from "node:assert/strict";

import { formatText } from "../src/format.js";

function sampleReport() {
  return {
    port: 3000,
    protocol: "tcp",
    target: "127.0.0.1",
    checkedAt: "2026-10-23T00:00:00.000Z",
    sources: {
      windows: {
        status: "ok",
        listeners: [{ address: "0.0.0.0", port: 3000, pid: 4180, process: "node", path: "C:\\node.exe" }],
      },
      wsl: {
        status: "ok",
        distro: "Ubuntu",
        listeners: [{ address: "0.0.0.0", port: 3000, pid: 722, process: "vite" }],
      },
      docker: { status: "ok", executable: "docker", mappings: [] },
    },
    probes: {
      windows: { status: "ok", reachable: true, latencyMs: 3 },
      wsl: { status: "ok", reachable: true, latencyMs: 18 },
    },
    assessment: {
      verdict: "CONFLICT",
      summary: "Multiple independent layers claim this port.",
      confidence: "high",
      findings: [
        {
          severity: "high",
          code: "WINDOWS_WSL_COLLISION",
          message: "Windows and WSL both report a TCP listener on this port.",
        },
      ],
    },
  };
}

test("renders an outcome-first CUI with ownership, reachability and next steps", () => {
  const output = formatText(sampleReport(), { color: false, width: 72 });
  assert.match(output, /PORTDOC  3000\/tcp/);
  assert.match(output, /^╭─ × CONFLICT$/m);
  assert.match(output, /^│  Multiple independent layers claim this port\.$/m);
  assert.match(output, /^╰─+$/m);
  assert.doesNotMatch(output, /[╮╯]/);
  assert.match(output, /OWNERSHIP/);
  assert.match(output, /node \(PID 4180\)/);
  assert.match(output, /REACHABILITY/);
  assert.match(output, /NEXT/);
  assert.match(output, /Choose one owner/);
  assert.doesNotMatch(output, /\u001b\[/);
});

test("wraps long diagnostic text for narrow terminals", () => {
  const report = sampleReport();
  report.sources.docker = {
    status: "unavailable",
    executable: null,
    mappings: [],
    reason: "Docker Desktop is installed, but its engine is not running or cannot be accessed.",
  };
  const output = formatText(report, { color: false, width: 40 });
  assert.ok(output.split("\n").every((line) => line.length <= 40));
});

test("adds ANSI colors only when requested", () => {
  const output = formatText(sampleReport(), { color: true, width: 72 });
  assert.match(output, /\u001b\[/);
});

test("localizes the complete CUI in Simplified Chinese", () => {
  const output = formatText(sampleReport(), { color: false, width: 72, language: "zh-CN" });
  assert.match(output, /端口冲突 · CONFLICT/);
  assert.match(output, /端口归属/);
  assert.match(output, /可达性/);
  assert.match(output, /问题分析/);
  assert.match(output, /下一步/);
  assert.match(output, /选择唯一归属/);
  assert.match(output, /置信度 高/);
});
