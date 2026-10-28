import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";

import { probeWindows, probeWindowsMatrix, probeWsl, probeWslMatrix } from "../src/probes.js";

function completedMatrix() {
  return {
    localhost: { status: "ok", reachable: false, address: "::1", family: 6, reason: "ECONNREFUSED", latencyMs: 1 },
    ipv4: { status: "ok", reachable: true, address: "127.0.0.1", family: 4, latencyMs: 2 },
    ipv6: { status: "ok", reachable: false, address: "::1", family: 6, reason: "ETIMEDOUT", latencyMs: 250 },
  };
}

test("probes a real IPv4 listener and does not fallback from the first localhost address", async (t) => {
  const server = net.createServer((socket) => socket.end());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const matrix = await probeWindowsMatrix(server.address().port, {
    force: true,
    timeoutMs: 250,
    lookup: async () => [{ address: "::1", family: 6 }, { address: "127.0.0.1", family: 4 }],
  });
  assert.equal(matrix.ipv4.reachable, true);
  assert.equal(matrix.ipv4.family, 4);
  assert.equal(matrix.localhost.address, "::1");
  assert.notEqual(matrix.localhost.reachable, true, "A failed or blocked IPv6 probe must not fallback to the working IPv4 listener.");
  assert.notEqual(matrix.ipv6.reachable, true);
  if (matrix.ipv6.reason === "EACCES") t.diagnostic("Host policy denied IPv6; the unavailable result remained explicit and no IPv4 fallback occurred.");
});

test("probes an IPv6-only listener without silently connecting through IPv4", async (t) => {
  const server = net.createServer((socket) => socket.end());
  try {
    server.listen({ port: 0, host: "::1", ipv6Only: true });
    await once(server, "listening");
  } catch (error) {
    if (["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code)) return t.skip("IPv6 loopback is unavailable on this host.");
    throw error;
  }
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const v6 = await probeWindows(port, { force: true, host: "::1", timeoutMs: 250 });
  const v4 = await probeWindows(port, { force: true, timeoutMs: 250 });
  if (["EACCES", "EPERM", "EADDRNOTAVAIL", "EAFNOSUPPORT"].includes(v6.reason)) return t.skip(`IPv6 loopback is blocked on this host (${v6.reason}).`);
  assert.equal(v6.reachable, true);
  assert.equal(v6.address, "::1");
  assert.equal(v6.family, 6);
  assert.equal(v4.reachable, false);
});

test("reports a DNS error as missing probe evidence, not a refused socket", async () => {
  const result = await probeWindows(3000, {
    force: true,
    host: "localhost",
    lookup: async () => { throw Object.assign(new Error("DNS failure"), { code: "ENOTFOUND" }); },
  });
  assert.equal(result.status, "error");
  assert.equal(result.reachable, null);
  assert.equal(result.reason, "ENOTFOUND");
});

test("bounds localhost name resolution and reports timeout as missing evidence", async () => {
  const startedAt = performance.now();
  const result = await probeWindows(3000, {
    force: true,
    host: "localhost",
    timeoutMs: 25,
    lookup: () => new Promise(() => {}),
  });
  assert.equal(result.status, "error");
  assert.equal(result.reachable, null);
  assert.equal(result.reason, "ETIMEDOUT");
  assert.ok(performance.now() - startedAt < 1_000);
});

test("distinguishes a refused WSL connection from a WSL infrastructure failure", async () => {
  const refused = await probeWsl(3000, {
    force: true,
    runCommand: async () => ({ exitCode: 0, stdout: "__PORTDOC_ENDPOINTS__" + JSON.stringify({ ...completedMatrix(), ipv4: { status: "ok", reachable: false, reason: "ECONNREFUSED" } }), stderr: "", missing: false, timedOut: false }),
  });
  assert.equal(refused.status, "ok");
  assert.equal(refused.reachable, false);

  const unavailable = await probeWsl(3000, {
    force: true,
    runCommand: async () => ({
      exitCode: 4_294_967_295,
      stdout: "W\0s\0l\0/\0S\0e\0r\0v\0i\0c\0e\0/\0E\0_\0A\0C\0C\0E\0S\0S\0D\0E\0N\0I\0E\0D\0",
      stderr: "",
      missing: false,
      timedOut: false,
    }),
  });
  assert.equal(unavailable.status, "error");
  assert.equal(unavailable.reachable, null);
  assert.match(unavailable.reason, /E_ACCESSDENIED/);
});

test("batches WSL IPv4, IPv6 and localhost probes into one invocation", async () => {
  const calls = [];
  const matrix = await probeWslMatrix(5173, {
    force: true,
    distro: "Ubuntu-24.04",
    timeoutMs: 250,
    runCommand: async (...args) => {
      calls.push(args);
      return { exitCode: 0, stdout: "A shell banner\n__PORTDOC_ENDPOINTS__" + JSON.stringify(completedMatrix()), stderr: "", missing: false, timedOut: false };
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1].slice(0, 2), ["--distribution", "Ubuntu-24.04"]);
  assert.match(calls[0][1].at(-1), /getaddrinfo\(host,port,socket.AF_UNSPEC,socket.SOCK_STREAM\)\[0\]/);
  assert.deepEqual(matrix, completedMatrix());
});

test("does not mislabel a WSL command timeout as a connection timeout", async () => {
  const matrix = await probeWslMatrix(5173, {
    force: true,
    runCommand: async () => ({ exitCode: null, stdout: "", stderr: "", missing: false, timedOut: true }),
  });
  for (const probe of Object.values(matrix)) {
    assert.equal(probe.status, "error");
    assert.equal(probe.reachable, null);
    assert.match(probe.reason, /before returning results/);
  }
});

test("rejects incomplete WSL endpoint data", async () => {
  const matrix = await probeWslMatrix(5173, {
    force: true,
    runCommand: async () => ({ exitCode: 0, stdout: '__PORTDOC_ENDPOINTS__{"ipv4":{"status":"ok","reachable":true}}', stderr: "", missing: false, timedOut: false }),
  });
  assert.equal(matrix.ipv4.reachable, null);
  assert.match(matrix.ipv4.reason, /unreadable/);
});
