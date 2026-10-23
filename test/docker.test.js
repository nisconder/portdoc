import test from "node:test";
import assert from "node:assert/strict";

import { collectDocker } from "../src/collectors/docker.js";

test("retries Docker Desktop's installation path when docker is absent from PATH", async () => {
  const dockerDesktopCli = "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
  const calls = [];
  const result = await collectDocker(3000, {
    environment: { ProgramFiles: "C:\\Program Files" },
    existsSync: (candidate) => candidate === dockerDesktopCli,
    runCommand: async (file) => {
      calls.push(file);
      if (file === "docker") {
        return { missing: true, timedOut: false, exitCode: null, stdout: "", stderr: "" };
      }
      return {
        missing: false,
        timedOut: false,
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          ID: "abc",
          Names: "web",
          Image: "nginx",
          Ports: "0.0.0.0:3000->80/tcp",
        }),
      };
    },
  });

  assert.deepEqual(calls, ["docker", dockerDesktopCli]);
  assert.equal(result.status, "ok");
  assert.equal(result.executable, dockerDesktopCli);
  assert.equal(result.mappings[0].container, "web");
});

test("explains the difference between a missing CLI and an unavailable daemon", async () => {
  const result = await collectDocker(3000, {
    dockerPath: "C:\\Docker\\docker.exe",
    runCommand: async () => ({
      missing: false,
      timedOut: false,
      exitCode: 1,
      stdout: "",
      stderr: "WARNING: config unavailable\nfailed to connect to the docker API",
    }),
  });

  assert.equal(result.status, "unavailable");
  assert.match(result.reason, /installed/);
  assert.match(result.reason, /engine is not running/);
  assert.doesNotMatch(result.reason, /WARNING/);
});
