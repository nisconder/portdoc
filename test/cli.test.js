import test from "node:test";
import assert from "node:assert/strict";

import { main, parseArgs } from "../src/cli.js";

test("parses the port and supported options", () => {
  assert.deepEqual(parseArgs(["3000", "--json", "--no-color", "--distro", "Ubuntu", "--docker-path", "C:\\Docker\\docker.exe", "--no-probe", "--timeout", "900"]), {
    port: 3000,
    json: true,
    color: false,
    distro: "Ubuntu",
    dockerPath: "C:\\Docker\\docker.exe",
    probe: false,
    timeoutMs: 900,
  });
});

test("rejects invalid ports", () => {
  assert.throws(() => parseArgs(["70000"]), /Invalid TCP port/);
  assert.throws(() => parseArgs(["three-thousand"]), /Invalid TCP port/);
});

test("supports a detailed help command without requiring a port", async () => {
  const writes = [];
  const exitCode = await main(["help"], {
    stdout: (value) => writes.push(value),
    stderr: (value) => writes.push(value),
  });
  assert.equal(exitCode, 0);
  assert.match(writes[0], /3000 is only an example/);
  assert.match(writes[0], /WHAT GETS CHECKED/);
  assert.match(writes[0], /VERDICTS/);
  assert.match(writes[0], /SAFETY AND LIMITS/);
});

test("JSON mode returns conflict exit code and a machine-readable report", async () => {
  const writes = [];
  const report = {
    assessment: { verdict: "CONFLICT" },
  };
  const exitCode = await main(["3000", "--json"], {
    diagnose: async () => report,
    stdout: (value) => writes.push(value),
    stderr: (value) => writes.push(value),
  });
  assert.equal(exitCode, 1);
  assert.deepEqual(JSON.parse(writes[0]), report);
});
