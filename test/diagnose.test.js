import test from "node:test";
import assert from "node:assert/strict";

import { diagnose } from "../src/diagnose.js";

const collectors = {
  windows: async () => ({ status: "ok", listeners: [] }),
  wsl: async () => ({ status: "ok", listeners: [], distro: "Ubuntu" }),
  docker: async () => ({ status: "ok", mappings: [] }),
  reservations: async () => ({ status: "ok", ranges: [], matches: [], families: { ipv4: { status: "ok" }, ipv6: { status: "ok" } } }),
};

function matrix() {
  return {
    localhost: { status: "ok", reachable: false, address: "::1", family: 6 },
    ipv4: { status: "ok", reachable: false, address: "127.0.0.1", family: 4 },
    ipv6: { status: "ok", reachable: false, address: "::1", family: 6 },
  };
}

test("emits schema v3 with exclusions and verification commands, retaining IPv4 aliases", async () => {
  const calls = [];
  const report = await diagnose(5173, {
    collectors,
    distro: "Ubuntu",
    timeoutMs: 900,
    probes: {
      windows: async (port, options) => { calls.push(["windows", port, options]); return matrix(); },
      wsl: async (port, options) => { calls.push(["wsl", port, options]); return matrix(); },
    },
  });
  assert.equal(report.schemaVersion, 3);
  assert.equal(report.kind, "diagnosis");
  assert.equal(report.reservations.status, "ok");
  assert.deepEqual(report.nextActions, []);
  assert.equal(report.target, "127.0.0.1");
  assert.deepEqual(report.endpointMatrix, { windows: matrix(), wsl: matrix() });
  assert.equal(report.probes.windows, report.endpointMatrix.windows.ipv4);
  assert.equal(report.probes.wsl, report.endpointMatrix.wsl.ipv4);
  assert.equal(report.assessment.verdict, "FREE");
  assert.equal(calls.length, 2);
  assert.equal(calls[0][2].timeoutMs, 900);
  assert.equal(calls[1][2].distro, "Ubuntu");
});

test("--no-probe skips all six matrix endpoints and never calls probe functions", async () => {
  const fail = async () => assert.fail("A disabled probe must not run.");
  const report = await diagnose(80, { collectors, probe: false, probes: { windows: fail, wsl: fail } });
  for (const side of Object.values(report.endpointMatrix)) {
    for (const probe of Object.values(side)) {
      assert.equal(probe.status, "skipped");
      assert.equal(probe.reachable, null);
    }
  }
  assert.equal(report.probes.windows.status, "skipped");
  assert.match(report.assessment.summary, /Reachability probes were skipped/);
  assert.match(report.assessment.summary, /does not test whether a new bind will succeed/);
});
