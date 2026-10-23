import test from "node:test";
import assert from "node:assert/strict";

import { parseDockerPorts } from "../src/collectors/docker.js";
import { parseSsListeners, parseWslOutput } from "../src/collectors/wsl.js";
import { parseNetstatListeners, parseWindowsListeners } from "../src/collectors/windows.js";

test("parses PowerShell listener arrays and single objects", () => {
  assert.deepEqual(parseWindowsListeners('[{"Address":"0.0.0.0","Port":3000,"Pid":4180,"ProcessName":"node","ProcessPath":"C:\\\\node.exe"}]'), [
    { address: "0.0.0.0", port: 3000, pid: 4180, process: "node", path: "C:\\node.exe" },
  ]);
  assert.equal(parseWindowsListeners("").length, 0);
});

test("parses netstat listeners without administrator privileges", () => {
  const raw = [
    "  TCP    127.0.0.1:43173        0.0.0.0:0              LISTENING       38540",
    "  TCP    [::]:43173             [::]:0                 LISTENING       99",
    "  TCP    0.0.0.0:8080          0.0.0.0:0              LISTENING       10",
  ].join("\r\n");
  assert.deepEqual(parseNetstatListeners(raw, 43173), [
    { address: "127.0.0.1", port: 43173, pid: 38540, process: null, path: null },
    { address: "::", port: 43173, pid: 99, process: null, path: null },
  ]);
});

test("parses ss output including IPv6 and process metadata", () => {
  const raw = [
    'LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=722,fd=19))',
    'LISTEN 0 4096 [::]:3000 [::]:*',
  ].join("\n");
  assert.deepEqual(parseSsListeners(raw), [
    { address: "0.0.0.0", port: 3000, state: "LISTEN", pid: 722, process: "node" },
    { address: "::", port: 3000, state: "LISTEN", pid: null, process: null },
  ]);
});

test("extracts the WSL distribution marker", () => {
  const parsed = parseWslOutput('__WPD_DISTRO__Ubuntu-24.04\nLISTEN 0 511 *:8080 *:* users:(("vite",pid=9,fd=1))');
  assert.equal(parsed.distro, "Ubuntu-24.04");
  assert.equal(parsed.listeners[0].process, "vite");
});

test("finds only Docker mappings matching the requested host port", () => {
  const raw = [
    JSON.stringify({ ID: "abc", Names: "web", Image: "nginx", Ports: "0.0.0.0:3000->80/tcp, [::]:3000->80/tcp" }),
    JSON.stringify({ ID: "def", Names: "db", Image: "postgres", Ports: "0.0.0.0:5432->5432/tcp" }),
  ].join("\n");
  const mappings = parseDockerPorts(raw, 3000);
  assert.equal(mappings.length, 2);
  assert.equal(mappings[0].container, "web");
  assert.equal(mappings[1].hostAddress, "[::]");
});
