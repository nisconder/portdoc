import test from "node:test";
import assert from "node:assert/strict";

import { scan } from "../src/scan.js";
import { inventoryWindows } from "../src/collectors/windows.js";
import { inventoryWsl } from "../src/collectors/wsl.js";
import { collectDocker, inventoryDocker } from "../src/collectors/docker.js";

const noWindows = { status: "ok", listeners: [] };
const noWsl = { status: "ok", distro: "Ubuntu", listeners: [] };
const noDocker = { status: "ok", mappings: [] };

function fixtureInventory(sources = {}, calls = []) {
  const defaults = { windows: noWindows, wsl: noWsl, docker: noDocker };
  return Object.fromEntries(Object.entries({ ...defaults, ...sources }).map(([side, value]) => [side, async (options) => {
    calls.push({ side, options });
    return value;
  }]));
}

test("inventories each layer once, groups sparse port evidence and sorts numerically", async () => {
  const calls = [];
  const inventory = fixtureInventory({
    windows: { status: "ok", listeners: [
      { port: 65535, address: "127.0.0.1", process: "node", pid: 44 },
      { port: 80, address: "0.0.0.0", process: "nginx", pid: 9 },
      { port: 5173, address: "0.0.0.0", process: "node", pid: 33 },
    ] },
    wsl: { status: "ok", distro: "Ubuntu", listeners: [
      { port: 5173, address: "127.0.0.1", process: "vite", pid: 12 },
    ] },
    docker: { status: "ok", mappings: [
      { hostPort: 8080, hostAddress: "0.0.0.0", container: "web", containerPort: 80, protocol: "tcp" },
      { hostPort: 53, hostAddress: "0.0.0.0", container: "dns", containerPort: 53, protocol: "udp" },
    ] },
  }, calls);
  const result = await scan({ inventory, distro: "Ubuntu", timeoutMs: 900 });
  assert.deepEqual(calls.map((call) => call.side).sort(), ["docker", "windows", "wsl"]);
  assert.equal(calls.length, 3, "The high sparse port must not cause per-port enumeration.");
  assert.ok(calls.every((call) => call.options.distro === "Ubuntu" && call.options.timeoutMs === 900));
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.kind, "scan");
  assert.deepEqual(result.ports.map((row) => row.port), [80, 5173, 8080, 65535]);
  assert.equal(result.ports[1].overlap, true);
  assert.equal(result.ports[1].windows[0].pid, 33);
  assert.equal(result.ports[1].wsl[0].pid, 12);
  assert.equal(result.ports[2].docker[0].container, "web");
  assert.equal(result.totalPorts, 4);
  assert.equal(result.overlapCount, 1);
  assert.equal(result.limit, 30);
  assert.equal(result.truncated, false);
  assert.equal(result.endpointMatrix, undefined);
});

test("distinguishes potential overlapping claims from known forwarding and separate bindings", async () => {
  const inventory = fixtureInventory({
    windows: { status: "ok", listeners: [
      { port: 3000, address: "0.0.0.0", process: "wslrelay.exe", pid: 1 },
      { port: 4000, address: "0.0.0.0", process: "com.docker.backend", pid: 2 },
      { port: 5000, address: "127.0.0.1", process: "node", pid: 3 },
      { port: 6000, address: "::ffff:127.0.0.1", process: "node", pid: 4 },
      { port: 7000, address: "::", process: "node", pid: 5 },
    ] },
    wsl: { status: "ok", distro: "Ubuntu", listeners: [
      { port: 3000, address: "0.0.0.0", process: "node", pid: 10 },
      { port: 5000, address: "172.20.1.2", process: "node", pid: 11 },
      { port: 6000, address: "127.0.0.1", process: "node", pid: 12 },
      { port: 7000, address: "0.0.0.0", process: "node", pid: 13 },
      { port: 8000, address: "0.0.0.0", process: "docker-proxy", pid: 14 },
    ] },
    docker: { status: "ok", mappings: [
      { hostPort: 4000, hostAddress: "0.0.0.0", protocol: "tcp", container: "web" },
      { hostPort: 8000, hostAddress: "0.0.0.0", protocol: "tcp", container: "web" },
    ] },
  });
  const result = await scan({ inventory });
  assert.deepEqual(result.ports.map((entry) => [entry.port, entry.overlap]), [
    [3000, false], [4000, false], [5000, false], [6000, true], [7000, true], [8000, false],
  ]);
});

test("filters issues before total and limit, and explicitly reports truncation", async () => {
  const ports = [8, 80, 443, 5173, 65535];
  const inventory = fixtureInventory({
    windows: { status: "ok", listeners: ports.map((port) => ({ port, address: "0.0.0.0", process: "node", pid: port })) },
    wsl: { status: "ok", listeners: ports.slice(1).map((port) => ({ port, address: "127.0.0.1", process: "vite", pid: port })) },
  });
  const result = await scan({ inventory, issuesOnly: true, limit: 2 });
  assert.equal(result.totalPorts, 4);
  assert.equal(result.overlapCount, 4);
  assert.equal(result.truncated, true);
  assert.equal(result.limit, 2);
  assert.deepEqual(result.ports.map((row) => row.port), [80, 443]);
  assert.ok(result.ports.every((row) => row.overlap));
});

test("counts potential overlaps outside the displayed limit", async () => {
  const inventory = fixtureInventory({
    windows: { status: "ok", listeners: [
      { port: 80, address: "127.0.0.1", process: "nginx", pid: 1 },
      { port: 65535, address: "0.0.0.0", process: "node", pid: 2 },
    ] },
    wsl: { status: "ok", listeners: [{ port: 65535, address: "127.0.0.1", process: "vite", pid: 3 }] },
  });
  const result = await scan({ limit: 1, inventory });
  assert.deepEqual(result.ports.map((row) => [row.port, row.overlap]), [[80, false]]);
  assert.equal(result.totalPorts, 2);
  assert.equal(result.overlapCount, 1);
  assert.equal(result.truncated, true);
});

test("preserves unavailable inventory status and visible evidence from other layers", async () => {
  const inventory = fixtureInventory({
    windows: { status: "ok", listeners: [{ port: 5173, address: "127.0.0.1", process: "node", pid: 12 }] },
    wsl: { status: "error", listeners: [], reason: "E_ACCESSDENIED" },
    docker: { status: "unavailable", mappings: [], reason: "Docker is not installed." },
  });
  const result = await scan({ inventory });
  assert.equal(result.sources.wsl.status, "error");
  assert.equal(result.sources.docker.status, "unavailable");
  assert.equal(result.sources.wsl.reason, "E_ACCESSDENIED");
  assert.equal(result.ports[0].port, 5173);
  assert.equal(result.ports[0].overlap, false);
});

test("a throwing inventory does not erase evidence from the other layers", async () => {
  const inventory = fixtureInventory({ windows: { status: "ok", listeners: [{ port: 80 }] } });
  inventory.wsl = async () => { throw new Error("failed process"); };
  const result = await scan({ inventory });
  assert.equal(result.sources.wsl.status, "error");
  assert.equal(result.ports[0].port, 80);
});

test("validates scan limits before collecting any source", async () => {
  for (const limit of [0, 501, -1, 3.5, "30", NaN]) {
    const calls = [];
    await assert.rejects(scan({ limit, inventory: fixtureInventory({}, calls) }), /1 to 500/);
    assert.equal(calls.length, 0);
  }
  const result = await scan({ limit: 500, inventory: fixtureInventory() });
  assert.equal(result.limit, 500);
  assert.equal(result.totalPorts, 0);
  assert.equal(result.overlapCount, 0);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.ports, []);
});

test("Windows full inventory uses one netstat table and one batched identity query", async () => {
  const calls = [];
  const result = await inventoryWindows({ force: true, runCommand: async (file, args) => {
    calls.push({ file, args });
    if (file === "netstat.exe") return { exitCode: 0, stdout: [
      " TCP 127.0.0.1:80 0.0.0.0:0 LISTENING 22",
      " TCP [::1]:80 [::]:0 LISTENING 22",
      " TCP 0.0.0.0:65535 0.0.0.0:0 LISTENING 33",
      " TCP 127.0.0.1:55000 127.0.0.1:80 ESTABLISHED 44",
    ].join("\n") };
    return { exitCode: 0, stdout: JSON.stringify([
      { Pid: 22, ProcessName: "node", CommandLine: "node D:\\web\\server.js" },
      { Pid: 33, ProcessName: "node", CommandLine: "node D:\\api\\server.js" },
    ]) };
  } });
  assert.equal(calls.length, 2);
  assert.equal(calls.filter((call) => call.file === "netstat.exe").length, 1);
  assert.equal(result.listeners.length, 3);
  assert.equal(result.listeners[2].port, 65535);
  assert.equal(result.listeners[2].projectPath, "D:\\api");
  assert.match(calls[1].args.at(-1), /\$processIds = @\(22,33\)/);
  assert.equal((calls[1].args.at(-1).match(/Get-CimInstance/g) ?? []).length, 1);
});

test("WSL full inventory queries ss once in only the selected distribution", async () => {
  const calls = [];
  const result = await inventoryWsl({ force: true, distro: "Ubuntu", runCommand: async (file, args) => {
    calls.push({ file, args });
    if (calls.length === 1) return { exitCode: 0, stdout: [
      "__WPD_DISTRO__Ubuntu",
      'LISTEN 0 511 0.0.0.0:80 *:* users:(("node",pid=42,fd=8))',
      'LISTEN 0 511 [::1]:65535 *:* users:(("node",pid=43,fd=8))',
    ].join("\n") };
    return { exitCode: 0, stdout: JSON.stringify([{ pid: 42, commandLine: "node app.js", cwd: "/home/me/web", path: "/usr/bin/node" }]) };
  } });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.args.slice(0, 2)), [["--distribution", "Ubuntu"], ["--distribution", "Ubuntu"]]);
  assert.doesNotMatch(calls[0].args.at(-1), /sport =/);
  assert.equal(calls.filter((call) => /ss -H -ltnp/.test(call.args.at(-1))).length, 1);
  assert.equal(result.listeners.length, 2);
  assert.equal(result.listeners[1].port, 65535);
  assert.equal(result.listeners[0].projectPath, "/home/me/web");
});

test("Docker full inventory enumerates all TCP mappings in one ps call", async () => {
  const calls = [];
  const result = await inventoryDocker({ runCommand: async (file, args) => {
    calls.push({ file, args });
    return { exitCode: 0, stdout: JSON.stringify({ ID: "web-id", Names: "web", Image: "nginx", Ports: "0.0.0.0:80->80/tcp, [::]:443->443/tcp, 0.0.0.0:53->53/udp, 8080/tcp" }) };
  } });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 3), ["--host", "npipe:////./pipe/docker_engine", "ps"]);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.mappings.map((mapping) => mapping.hostPort), [80, 443]);
});

test("Docker ranges are reported as incomplete instead of silently claiming full coverage", async () => {
  const runCommand = async () => ({ exitCode: 0, stdout: JSON.stringify({ ID: "web-id", Names: "web", Image: "nginx", Ports: "0.0.0.0:80->80/tcp, 0.0.0.0:8000-8003->80-83/tcp" }) });
  const result = await inventoryDocker({ runCommand });
  assert.equal(result.status, "error");
  assert.equal(result.mappings.length, 1);
  assert.equal(result.mappings[0].hostPort, 80);
  assert.match(result.reason, /ranges/);
  const affectedPort = await collectDocker(8001, { runCommand });
  assert.equal(affectedPort.status, "error");
  const unrelatedPort = await collectDocker(80, { runCommand });
  assert.equal(unrelatedPort.status, "ok");
});
