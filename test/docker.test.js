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

test("identifies the Compose project and service without inspecting unrelated containers", async () => {
  let calls = 0;
  const result = await collectDocker(5173, {
    runCommand: async () => {
      calls += 1;
      return { exitCode: 0, stdout: JSON.stringify({ ID: "web-id", Names: "demo-web-1", Image: "demo-web", Ports: "0.0.0.0:5173->5173/tcp", Labels: "com.docker.compose.project=demo,com.docker.compose.service=web,com.docker.compose.project.working_dir=/home/me/demo" }) };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.mappings[0].composeProject, "demo");
  assert.equal(result.mappings[0].composeService, "web");
  assert.equal(result.mappings[0].projectPath, "/home/me/demo");
});
