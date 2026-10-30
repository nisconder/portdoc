import test from "node:test";
import assert from "node:assert/strict";
import { buildNextActions } from "../src/advice.js";
import { createDemoReport } from "../src/demo.js";

test("generates read-only process checks from actual unique PIDs", () => {
  const report = createDemoReport();
  report.sources.windows.listeners.push({ pid: 4180 }, { pid: "1; write" }, { pid: -1 });
  const actions = buildNextActions(report);
  assert.deepEqual(actions.map((action) => action.command), ["Get-Process -Id 4180"]);
  assert.ok(actions.every((action) => !/kill|stop|delete|remove/i.test(action.command)));
});

test("quotes WSL distribution and Docker executable/container names for PowerShell", () => {
  const report = createDemoReport();
  report.sources.windows.listeners = [];
  report.sources.wsl.distro = "Ubuntu's test; echo harmless";
  report.sources.wsl.listeners = [{ pid: 42 }];
  report.sources.docker.executable = "D:\\Docker's folder\\docker.exe";
  report.sources.docker.mappings = [{ container: "web'; echo harmless; '" }];
  const actions = buildNextActions(report);
  assert.equal(actions[0].command, "wsl -d 'Ubuntu''s test; echo harmless' -- ps -p 42 -o pid,comm,args");
  assert.equal(actions[1].command, "& 'D:\\Docker''s folder\\docker.exe' port 'web''; echo harmless; '''");
});

test("offers exclusion checks only for matching address families", () => {
  const report = createDemoReport();
  report.sources.windows.listeners = [];
  report.reservations.matches = [{ family: 4 }, { family: 4 }, { family: 6 }];
  assert.deepEqual(buildNextActions(report).map((action) => action.command), [
    "netsh interface ipv4 show excludedportrange protocol=tcp",
    "netsh interface ipv6 show excludedportrange protocol=tcp",
  ]);
});
