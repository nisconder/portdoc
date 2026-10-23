import test from "node:test";
import assert from "node:assert/strict";

import { analyze } from "../src/analyze.js";

function report(overrides = {}) {
  return {
    sources: {
      windows: { status: "ok", listeners: [] },
      wsl: { status: "ok", listeners: [], distro: "Ubuntu" },
      docker: { status: "ok", mappings: [] },
      ...overrides.sources,
    },
    probes: {
      windows: { status: "ok", reachable: false },
      wsl: { status: "ok", reachable: false },
      ...overrides.probes,
    },
  };
}

test("reports a fully inspected unused port as FREE", () => {
  assert.equal(analyze(report()).verdict, "FREE");
});

test("reports simultaneous Windows and WSL listeners as CONFLICT", () => {
  const result = analyze(report({
    sources: {
      windows: { status: "ok", listeners: [{ process: "node", pid: 1 }] },
      wsl: { status: "ok", listeners: [{ process: "vite", pid: 2 }] },
      docker: { status: "ok", mappings: [] },
    },
  }));
  assert.equal(result.verdict, "CONFLICT");
  assert.equal(result.findings[0].code, "WINDOWS_WSL_COLLISION");
});

test("does not treat Docker's own Windows forwarding process as an independent conflict", () => {
  const result = analyze(report({
    sources: {
      windows: { status: "ok", listeners: [{ process: "com.docker.backend", pid: 1 }] },
      wsl: { status: "ok", listeners: [] },
      docker: { status: "ok", mappings: [{ container: "web" }] },
    },
  }));
  assert.equal(result.verdict, "OK");
});

test("reports a reachable port without a visible owner as UNKNOWN", () => {
  const result = analyze(report({ probes: { windows: { status: "ok", reachable: true } } }));
  assert.equal(result.verdict, "UNKNOWN");
  assert.equal(result.findings[0].code, "HIDDEN_OWNER");
});

test("does not call an incompletely inspected port FREE", () => {
  const result = analyze(report({
    sources: {
      windows: { status: "ok", listeners: [] },
      wsl: { status: "error", listeners: [], reason: "denied" },
      docker: { status: "unavailable", mappings: [], reason: "missing" },
    },
  }));
  assert.equal(result.verdict, "UNKNOWN");
  assert.equal(result.findings.at(-1).code, "INCOMPLETE_EVIDENCE");
});

test("reports a WSL listener that Windows cannot reach as UNKNOWN", () => {
  const result = analyze(report({
    sources: {
      windows: { status: "ok", listeners: [] },
      wsl: { status: "ok", listeners: [{ process: "vite", pid: 2 }] },
      docker: { status: "ok", mappings: [] },
    },
  }));
  assert.equal(result.verdict, "UNKNOWN");
  assert.equal(result.findings[0].code, "WSL_NOT_REACHABLE_FROM_WINDOWS");
});
