import test from "node:test";
import assert from "node:assert/strict";

import { probeWsl } from "../src/probes.js";

test("distinguishes a refused WSL connection from a WSL infrastructure failure", async () => {
  const refused = await probeWsl(3000, {
    force: true,
    runCommand: async () => ({ exitCode: 1, stdout: "", stderr: "", missing: false, timedOut: false }),
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
