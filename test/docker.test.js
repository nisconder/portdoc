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
  assert.equal(result.endpoint, "npipe:////./pipe/docker_engine");
});

test("never inherits a remote context or DOCKER_HOST when collecting local port ownership", async () => {
  const calls = [];
  const environment = { DOCKER_CONTEXT: "production", DOCKER_HOST: "ssh://user@production.example", docker_context: "also-production", docker_host: "tcp://remote.example:2375", PATH: process.env.PATH };
  const result = await collectDocker(5173, {
    environment,
    runCommand: async (file, args, options) => {
      calls.push({ file, args, options });
      return { exitCode: 0, stdout: "" };
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 3), ["--host", "npipe:////./pipe/docker_engine", "ps"]);
  assert.equal(calls[0].options.spawnOptions.env.DOCKER_HOST, undefined);
  assert.equal(calls[0].options.spawnOptions.env.DOCKER_CONTEXT, undefined);
  assert.equal(calls[0].options.spawnOptions.env.docker_host, undefined);
  assert.equal(calls[0].options.spawnOptions.env.docker_context, undefined);
  assert.equal(environment.DOCKER_CONTEXT, "production", "The caller's environment must remain unchanged.");
  assert.equal(result.status, "ok");
  assert.equal(result.endpoint, "npipe:////./pipe/docker_engine");
});

test("tries only the two local Desktop pipes when the default engine pipe is unavailable", async () => {
  const calls = [];
  const result = await collectDocker(5173, {
    runCommand: async (file, args) => {
      calls.push({ file, args });
      return args[1] === "npipe:////./pipe/docker_engine"
        ? { exitCode: 1, stdout: "", stderr: "engine unavailable" }
        : { exitCode: 0, stdout: JSON.stringify({ ID: "web-id", Names: "web", Image: "node", Ports: "0.0.0.0:5173->5173/tcp" }) };
    },
  });
  assert.deepEqual(calls.map((call) => call.args[1]), ["npipe:////./pipe/docker_engine", "npipe:////./pipe/dockerDesktopLinuxEngine"]);
  assert.ok(calls.every((call) => call.args[0] === "--host" && call.args[2] === "ps"));
  assert.equal(result.endpoint, "npipe:////./pipe/dockerDesktopLinuxEngine");
  assert.equal(result.mappings[0].container, "web");
});

test("does not fallback to the active remote context when both local pipes fail", async () => {
  const calls = [];
  const result = await collectDocker(5173, {
    environment: { DOCKER_CONTEXT: "production", DOCKER_HOST: "tcp://192.0.2.1:2375" },
    runCommand: async (file, args) => {
      calls.push({ file, args });
      return { exitCode: 1, stdout: "", stderr: "local pipe unavailable" };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(result.status, "unavailable");
  assert.equal(result.endpoint, null);
  assert.equal(result.mappings.length, 0);
  assert.match(result.reason, /Remote contexts are not inspected/);
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
