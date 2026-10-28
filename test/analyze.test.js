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
  assert.equal(result.confidence, "medium");
  assert.match(result.findings[0].message, /do not identify which service/);
});

test("does not call distinct address bindings a collision solely because the port matches", () => {
  const result = analyze(report({ sources: {
    windows: { status: "ok", listeners: [{ process: "node", pid: 1, address: "127.0.0.1" }] },
    wsl: { status: "ok", listeners: [{ process: "vite", pid: 2, address: "172.24.1.3" }] },
  } }));
  assert.notEqual(result.verdict, "CONFLICT");
  assert.ok(!result.findings.some((finding) => finding.code.endsWith("_COLLISION")));
});

test("recognizes a WSL forwarding process as supporting rather than independent ownership", () => {
  const result = analyze(report({ sources: {
    windows: { status: "ok", listeners: [{ process: "wslrelay.exe", pid: 1, address: "0.0.0.0" }] },
    wsl: { status: "ok", listeners: [{ process: "vite", pid: 2, address: "0.0.0.0" }] },
  }, probes: { windows: { status: "ok", reachable: true } } }));
  assert.equal(result.verdict, "OK");
});

test("flags localhost failure without inventing a network forwarding root cause", () => {
  const input = report({ sources: {
    windows: { status: "ok", listeners: [{ process: "node", pid: 1, address: "127.0.0.1" }] },
  }, probes: { windows: { status: "ok", reachable: true } } });
  input.endpointMatrix = { windows: {
    localhost: { status: "ok", reachable: false, address: "::1", family: 6 },
    ipv4: { status: "ok", reachable: true, address: "127.0.0.1", family: 4 },
    ipv6: { status: "ok", reachable: false, address: "::1", family: 6 },
  } };
  const result = analyze(input);
  assert.equal(result.verdict, "UNKNOWN");
  assert.equal(result.confidence, "medium");
  assert.ok(result.findings.some((finding) => finding.code === "LOCALHOST_RESOLUTION_MISMATCH"));
  assert.equal(result.findings.find((finding) => finding.code === "LOCALHOST_RESOLUTION_MISMATCH").side, "windows");
  assert.ok(result.findings.some((finding) => finding.code === "ENDPOINT_FAMILY_MISMATCH"));
  assert.doesNotMatch(result.summary, /relay|captured|intercepted|not working/i);
});

test("an intentional IPv4-only binding is informative when localhost works", () => {
  const input = report({ sources: {
    windows: { status: "ok", listeners: [{ process: "node", pid: 1, address: "127.0.0.1" }] },
  }, probes: { windows: { status: "ok", reachable: true } } });
  input.endpointMatrix = { windows: {
    localhost: { status: "ok", reachable: true, address: "127.0.0.1", family: 4 },
    ipv4: { status: "ok", reachable: true, address: "127.0.0.1", family: 4 },
    ipv6: { status: "ok", reachable: false, address: "::1", family: 6 },
  } };
  const result = analyze(input);
  assert.equal(result.verdict, "OK");
  assert.equal(result.findings.find((finding) => finding.code === "ENDPOINT_FAMILY_MISMATCH").severity, "low");
});

test("checks IPv6 for hidden owners instead of relying on the IPv4 compatibility probe", () => {
  const input = report();
  input.endpointMatrix = { windows: {
    localhost: { status: "ok", reachable: true },
    ipv4: { status: "ok", reachable: false },
    ipv6: { status: "ok", reachable: true },
  } };
  const result = analyze(input);
  assert.equal(result.verdict, "UNKNOWN");
  assert.ok(result.findings.some((finding) => finding.code === "HIDDEN_OWNER"));
});

test("does not call unchecked endpoint probes proof of a free port", () => {
  const input = report();
  input.endpointMatrix = { windows: {
    localhost: { status: "error", reachable: null },
    ipv4: { status: "ok", reachable: false },
    ipv6: { status: "ok", reachable: false },
  } };
  const result = analyze(input);
  assert.equal(result.verdict, "UNKNOWN");
  assert.ok(result.findings.some((finding) => finding.code === "INCOMPLETE_PROBES"));
});

test("reduces confidence when a listener is known but some endpoint probes are blocked", () => {
  const input = report({ sources: {
    windows: { status: "ok", listeners: [{ process: "node", pid: 1, address: "127.0.0.1" }] },
  } });
  input.endpointMatrix = { windows: {
    localhost: { status: "error", reachable: null, reason: "EACCES" },
    ipv4: { status: "ok", reachable: true },
    ipv6: { status: "error", reachable: null, reason: "EACCES" },
  } };
  const result = analyze(input);
  assert.equal(result.verdict, "OK");
  assert.equal(result.confidence, "medium");
  assert.ok(result.findings.some((finding) => finding.code === "PARTIAL_PROBES"));
  assert.ok(!result.findings.some((finding) => finding.code === "ENDPOINT_FAMILY_MISMATCH"));
});

test("does not blame WSL forwarding when an IPv6 WSL listener is reachable through Windows IPv6", () => {
  const input = report({ sources: {
    wsl: { status: "ok", listeners: [{ process: "node", pid: 2, address: "::1" }] },
  } });
  input.endpointMatrix = { windows: {
    localhost: { status: "ok", reachable: true, address: "::1", family: 6 },
    ipv4: { status: "ok", reachable: false },
    ipv6: { status: "ok", reachable: true },
  } };
  const result = analyze(input);
  assert.equal(result.verdict, "OK");
  assert.ok(!result.findings.some((finding) => finding.code === "WSL_NOT_REACHABLE_FROM_WINDOWS"));
});

test("does not conclude a blocked IPv6 probe proves a WSL IPv6 listener unreachable", () => {
  const input = report({ sources: {
    wsl: { status: "ok", listeners: [{ process: "node", pid: 2, address: "::1" }] },
  } });
  input.endpointMatrix = { windows: {
    localhost: { status: "error", reachable: null },
    ipv4: { status: "ok", reachable: false },
    ipv6: { status: "error", reachable: null, reason: "EACCES" },
  } };
  const result = analyze(input);
  assert.equal(result.verdict, "OK");
  assert.equal(result.confidence, "medium");
  assert.ok(!result.findings.some((finding) => finding.code === "WSL_NOT_REACHABLE_FROM_WINDOWS"));
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
