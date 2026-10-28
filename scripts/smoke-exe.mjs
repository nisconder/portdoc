import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builtExecutable = path.resolve(process.argv[2] ?? path.join(root, "dist", "portdoc-win-x64.exe"));
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const isolated = await mkdtemp(path.join(os.tmpdir(), "portdoc-exe-smoke-"));
const executable = path.join(isolated, "portdoc.exe");
await copyFile(builtExecutable, executable);
// Exclude installed Node/npm and the checkout from PATH. Windows utilities
// remain available for collector diagnostics.
const environment = { ...process.env, PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0;${process.env.SystemRoot}`, PORTDOC_LANG: "en", NODE_OPTIONS: "" };
const invoke = (args) => {
  const result = spawnSync(executable, args, { cwd: isolated, env: environment, encoding: "utf8", windowsHide: true, timeout: 30_000 });
  if (result.error) throw result.error;
  assert.ok(result.status !== null, "EXE must exit normally");
  return result;
};

const installedVersion = invoke(["--version"]);
assert.equal(installedVersion.status, 0);
assert.equal(installedVersion.stdout.trim(), version);
const bare = invoke([]);
const help = invoke(["help"]);
assert.equal(bare.status, 0);
assert.equal(help.status, 0);
assert.equal(bare.stdout, help.stdout);
assert.match(help.stdout, /portdoc/);
const chinese = invoke(["help", "--lang", "zh-CN"]);
assert.equal(chinese.status, 0);
assert.match(chinese.stdout, /用法/);
const english = invoke(["help", "--lang", "en"]);
assert.equal(english.status, 0);
assert.match(english.stdout, /USAGE/);
const demo = invoke(["demo", "--json", "--lang", "en"]);
assert.equal(demo.status, 0);
const demoReport = JSON.parse(demo.stdout);
assert.equal(demoReport.schemaVersion, 2);
assert.ok(demoReport.endpointMatrix.windows);
assert.ok(demoReport.endpointMatrix.wsl);
const invalid = invoke(["not-a-port", "--lang", "en"]);
assert.equal(invalid.status, 2);
assert.match(invalid.stderr, /Invalid TCP port/);
const json = invoke(["65534", "--json", "--no-probe", "--timeout", "1000"]);
assert.ok([0, 1, 2].includes(json.status));
const report = JSON.parse(json.stdout);
assert.equal(report.port, 65534);
assert.equal(report.protocol, "tcp");
assert.ok(report.sources.windows);
assert.ok(report.sources.wsl);
assert.ok(report.sources.docker);
assert.equal(report.probes.windows.status, "skipped");
await unlink(executable);
await rmdir(isolated);
console.log(`EXE smoke checks passed: version ${version}, bare/help, en/zh-CN, demo, errors, JSON; isolated cwd and no Node/npm on PATH.`);
