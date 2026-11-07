import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builtExecutable = path.resolve(process.argv[2] ?? path.join(root, "dist", "portdoc-win-x64.exe"));
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const isolated = await mkdtemp(path.join(os.tmpdir(), "portdoc-exe-smoke-"));
const executable = path.join(isolated, "portdoc.exe");
const snapshotFile = path.join(isolated, "snapshot.json");
const diffBeforeFile = path.join(isolated, "diff-before.json");
const diffAfterFile = path.join(isolated, "diff-after.json");
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

try {
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
assert.match(chinese.stdout, /portdoc scan/);
assert.match(chinese.stdout, /portdoc doctor/);
const english = invoke(["help", "--lang", "en"]);
assert.equal(english.status, 0);
assert.match(english.stdout, /USAGE/);
const demo = invoke(["demo", "--json", "--lang", "en"]);
assert.equal(demo.status, 0);
const demoReport = JSON.parse(demo.stdout);
assert.equal(demoReport.schemaVersion, 3);
assert.equal(demoReport.kind, "diagnosis");
assert.ok(demoReport.endpointMatrix.windows);
assert.ok(demoReport.endpointMatrix.wsl);
assert.ok(demoReport.reservations);
assert.ok(Array.isArray(demoReport.nextActions));
await writeFile(diffBeforeFile, JSON.stringify(demoReport));
const changedDemo = structuredClone(demoReport);
changedDemo.sources.windows.listeners[0].pid += 1;
await writeFile(diffAfterFile, JSON.stringify(changedDemo));
const diff = invoke(["diff", diffBeforeFile, diffAfterFile, "--json"]);
assert.equal(diff.status, 1);
assert.equal(JSON.parse(diff.stdout).changes[0].field, "pid");
assert.equal(invoke(["diff", diffBeforeFile, diffBeforeFile]).status, 0);
const snapshot = invoke(["snapshot", "--out", snapshotFile, "--json", "--timeout", "1000"]);
assert.ok([0, 2].includes(snapshot.status));
const savedSnapshot = JSON.parse(await readFile(snapshotFile, "utf8"));
assert.equal(savedSnapshot.kind, "snapshot");
assert.equal(savedSnapshot.report.kind, "scan");
assert.deepEqual(JSON.parse(snapshot.stdout), savedSnapshot);
const overwrite = invoke(["snapshot", "--out", snapshotFile, "--timeout", "1000"]);
assert.equal(overwrite.status, 2);
assert.match(overwrite.stderr, /already exists/);
const scan = invoke(["scan", "--json", "--limit", "2", "--timeout", "1000"]);
assert.ok([0, 1, 2].includes(scan.status));
const scanReport = JSON.parse(scan.stdout);
assert.equal(scanReport.kind, "scan");
assert.equal(scanReport.schemaVersion, 1);
assert.ok(scanReport.totalPorts >= scanReport.ports.length);
assert.ok(scanReport.ports.length <= 2);
assert.equal(scanReport.limit, 2);
assert.equal(scanReport.endpointMatrix, undefined);
assert.equal(scanReport.probes, undefined);
const doctor = invoke(["doctor", "--json", "--timeout", "1000"]);
const doctorReport = JSON.parse(doctor.stdout);
assert.equal(doctorReport.kind, "doctor");
assert.equal(doctorReport.schemaVersion, 1);
assert.equal(doctorReport.checks.length, 4);
assert.deepEqual(doctorReport.checks.map((check) => check.id), ["platform", "windows", "wsl", "docker"]);
assert.equal(doctor.status, doctorReport.ready ? 0 : 2);
const chineseScanHelp = invoke(["scan", "--help", "--lang", "zh-CN"]);
assert.equal(chineseScanHelp.status, 0);
assert.match(chineseScanHelp.stdout, /用法/);
assert.match(chineseScanHelp.stdout, /--issues-only/);
const chineseDoctorHelp = invoke(["help", "doctor", "--lang", "zh-CN"]);
assert.equal(chineseDoctorHelp.status, 0);
assert.match(chineseDoctorHelp.stdout, /环境/);
assert.match(chineseDoctorHelp.stdout, /named pipe/);
const chineseScan = invoke(["scan", "--limit", "2", "--lang", "zh-CN", "--no-color", "--timeout", "1000"]);
assert.ok([0, 1, 2].includes(chineseScan.status));
assert.match(chineseScan.stdout, /端口概览/);
assert.match(chineseScan.stdout, /匹配端口/);
const chineseDoctor = invoke(["doctor", "--lang", "zh-CN", "--no-color", "--timeout", "1000"]);
assert.ok([0, 2].includes(chineseDoctor.status));
assert.match(chineseDoctor.stdout, /环境检查/);
assert.match(chineseDoctor.stdout, /Windows/);
const invalid = invoke(["not-a-port", "--lang", "en"]);
assert.equal(invalid.status, 2);
assert.match(invalid.stderr, /Invalid TCP port/);
const json = invoke(["65534", "--json", "--no-probe", "--timeout", "1000"]);
assert.ok([0, 1, 2].includes(json.status));
const report = JSON.parse(json.stdout);
assert.equal(report.kind, "diagnosis");
assert.equal(report.schemaVersion, 3);
assert.equal(report.port, 65534);
assert.equal(report.protocol, "tcp");
assert.ok(report.sources.windows);
assert.ok(report.sources.wsl);
assert.ok(report.sources.docker);
assert.ok(report.reservations);
assert.ok(Array.isArray(report.nextActions));
assert.equal(report.probes.windows.status, "skipped");
} finally {
  const deadline = Date.now() + 3_000;
  await cleanupTemporary(() => unlink(executable), executable, deadline);
  for (const file of [snapshotFile, diffBeforeFile, diffAfterFile]) await cleanupTemporary(() => unlink(file), file, deadline);
  await cleanupTemporary(() => rmdir(isolated), isolated, deadline);
}
console.log(`EXE smoke checks passed: version ${version}, bare/help, en/zh-CN, diagnosis/demo v3, scan, doctor, snapshot/diff, overwrite protection, errors, JSON; isolated cwd and no Node/npm on PATH.`);

async function cleanupTemporary(remove, target, deadline) {
  let pauseMs = 100;
  while (true) {
    try {
      await remove();
      return;
    } catch (error) {
      if (error.code === "ENOENT") return;
      const remaining = deadline - Date.now();
      if (["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code) && remaining > 0) {
        await delay(Math.min(pauseMs, remaining));
        pauseMs = 200;
        continue;
      }
      // Windows can retain an EXE/directory handle after the last child exits.
      // Cleanup is best-effort; never replace the actual smoke assertion error.
      console.warn(`Smoke cleanup warning: ${error.code ?? "unknown error"} at ${target}`);
      return;
    }
  }
}
