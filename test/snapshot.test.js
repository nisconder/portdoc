import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { captureSnapshot, readSnapshot, saveSnapshot, validateInput } from "../src/snapshot.js";
import { compareSnapshots, diffExitCode, formatDiff } from "../src/diff.js";
import { main, parseArgs } from "../src/cli.js";
import { diagnosisFixture, scanFixture, wrap } from "./fixtures/snapshot-fixtures.js";

test("timestamp, probe latency and reordered evidence do not create changes", () => {
  const before = wrap();
  before.report.sources.windows.listeners.push({ address: "::1", port: 5173, pid: 200, process: "node" });
  const after = structuredClone(before);
  after.report.checkedAt = "2026-11-07T01:01:00.000Z";
  after.report.endpointMatrix.windows.ipv4.latencyMs = 100;
  after.report.endpointMatrix.windows.ipv4.reason = "incidental diagnostic text";
  after.report.sources.windows.listeners.reverse();
  const diff = compareSnapshots(before, after);
  assert.deepEqual(diff.changes, []);
  assert.equal(diff.complete, true);
  assert.equal(diffExitCode(diff), 0);
});

test("same endpoint reveals PID, project and Compose/container changes", () => {
  const before = wrap();
  const after = structuredClone(before);
  Object.assign(after.report.sources.windows.listeners[0], { pid: 101, projectPath: "C:\\other" });
  Object.assign(after.report.sources.docker.mappings[0], { containerId: "new-container", image: "web:v2", composeService: "preview" });
  after.report.endpointMatrix.windows.ipv6.reachable = true;
  after.report.endpointMatrix.windows.localhost = { status: "ok", reachable: true, address: "127.0.0.1", family: 4 };
  after.report.reservations.matches = [{ family: 4, start: 5100, end: 5200, administered: true }];
  const diff = compareSnapshots(before, after);
  assert.equal(diffExitCode(diff), 1);
  assert.deepEqual(diff.changes.filter((item) => item.category === "listener-changed").map((item) => item.field), ["pid", "projectPath"]);
  assert.deepEqual(diff.changes.filter((item) => item.category === "mapping-changed").map((item) => item.field), ["containerId", "image", "composeService"]);
  assert.deepEqual(diff.changes.filter((item) => item.category === "endpoint").map((item) => item.source), ["windows.localhost", "windows.ipv6"]);
  assert.equal(diff.changes.find((item) => item.category === "reservation").after[0].start, 5100);
  assert.match(formatDiff(diff, { language: "zh-CN" }), /监听信息变化/);
  assert.match(formatDiff(diff), /CHANGED/);
});

test("source failure never becomes listener removal or a newly empty port", () => {
  const before = wrap();
  const after = structuredClone(before);
  after.report.sources.windows = { status: "error", listeners: [], reason: "Timed out" };
  const diff = compareSnapshots(before, after);
  assert.equal(diffExitCode(diff), 2);
  assert.equal(diff.changes.filter((item) => item.category === "listener-removed").length, 0);
  assert.ok(diff.unknown.some((item) => item.source === "windows" && item.reason === "SOURCE_INCOMPLETE"));
  assert.ok(diff.changes.some((item) => item.source === "windows" && item.category === "evidence"));
  assert.equal(compareSnapshots(after, before).changes.filter((item) => item.category === "listener-added").length, 0);
});

test("a missing probe is not a reachability change, even when other changes are known", () => {
  const before = wrap();
  const after = structuredClone(before);
  after.report.endpointMatrix.windows.ipv4 = { status: "error", reachable: null, reason: "EACCES" };
  after.report.sources.docker.mappings[0].image = "web:v2";
  const diff = compareSnapshots(before, after);
  assert.equal(diff.changed, true);
  assert.equal(diffExitCode(diff), 2);
  assert.ok(diff.unknown.some((item) => item.source === "windows.ipv4"));
  assert.equal(diff.changes.some((item) => item.category === "endpoint" && item.source === "windows.ipv4"), false);
});

test("failed reservation family is not reported as an exclusion removed", () => {
  const before = wrap();
  before.report.reservations.matches = [{ family: 4, start: 5100, end: 5200, administered: false }];
  const after = structuredClone(before);
  after.report.reservations.status = "error";
  after.report.reservations.families.ipv4.status = "error";
  after.report.reservations.matches = [];
  const diff = compareSnapshots(before, after);
  assert.equal(diffExitCode(diff), 2);
  assert.equal(diff.changes.some((item) => item.category === "reservation"), false);
});

test("lost process metadata is labeled evidence loss, not a changed project", () => {
  const before = wrap();
  const after = structuredClone(before);
  after.report.sources.windows.listeners[0].projectPath = null;
  const diff = compareSnapshots(before, after);
  assert.equal(diffExitCode(diff), 2);
  assert.equal(diff.changes[0].category, "identity-evidence");
  assert.equal(diff.changes[0].field, "projectPath");
});

test("different WSL distributions and Docker endpoints are not compared as one source", () => {
  const before = wrap();
  const after = structuredClone(before);
  after.report.sources.wsl.distro = "Debian";
  after.report.sources.wsl.listeners = [];
  after.report.sources.docker.endpoint = "npipe:////./pipe/dockerDesktopLinuxEngine";
  after.report.sources.docker.mappings = [];
  const diff = compareSnapshots(before, after);
  assert.equal(diffExitCode(diff), 2);
  assert.deepEqual(diff.changes.map((item) => item.category), ["context", "context"]);
  assert.equal(diff.changes[0].after.distro, "Debian");
  assert.ok(diff.unknown.some((item) => item.source === "wsl" && item.reason === "SOURCE_CONTEXT_CHANGED"));
  assert.ok(diff.unknown.some((item) => item.source === "docker" && item.reason === "SOURCE_CONTEXT_CHANGED"));
});

test("different hosts, report kinds, ports and simulated/real inputs are rejected", () => {
  const before = wrap();
  for (const mutate of [
    (snapshot) => { snapshot.context.hostname = "other-machine"; },
    (snapshot) => { snapshot.report.port = 3000; },
    (snapshot) => { snapshot.report.sample = false; },
    (snapshot) => { snapshot.report = scanFixture(); },
  ]) {
    const after = structuredClone(before);
    mutate(after);
    assert.throws(() => compareSnapshots(before, after), /hosts|kind|simulated/);
  }
});

test("missing or unknown source identity never proves mappings/listeners disappeared", () => {
  for (const side of ["wsl", "docker"]) for (const missing of [null, undefined, "", "unknown"]) for (const both of [false, true]) {
    const before = wrap();
    const after = wrap();
    const field = side === "wsl" ? "distro" : "endpoint";
    const rows = side === "wsl" ? "listeners" : "mappings";
    before.report.sources[side][field] = missing;
    if (both) after.report.sources[side][field] = missing;
    after.report.sources[side][rows] = [];
    const diff = compareSnapshots(before, after);
    assert.equal(diffExitCode(diff), 2);
    assert.ok(diff.unknown.some((item) => item.source === side && item.reason === "SOURCE_CONTEXT_UNVERIFIED"));
    assert.equal(diff.changes.some((item) => item.source === side && ["listener-removed", "mapping-removed"].includes(item.category)), false);
    assert.equal(compareSnapshots(after, before).changes.some((item) => item.source === side && ["listener-added", "mapping-added"].includes(item.category)), false);
  }
});

test("inventory compares full sources beyond the truncated ports display", () => {
  const before = scanFixture();
  before.truncated = true;
  before.totalPorts = 2;
  before.limit = 1;
  before.sources.windows.listeners.push({ address: "127.0.0.1", port: 65535, pid: 99, process: "node" });
  const after = structuredClone(before);
  after.sources.windows.listeners.pop();
  const diff = compareSnapshots(before, after);
  assert.equal(diffExitCode(diff), 1);
  assert.equal(diff.changes[0].category, "listener-removed");
  assert.equal(diff.changes[0].before.port, 65535);
  assert.ok(diff.notes.includes("LEGACY_HOST_UNVERIFIED"));
  assert.ok(diff.notes.includes("INVENTORY_HAS_NO_REACHABILITY_PROBES"));
});

test("multiple owners at the same endpoint remain added/removed rows, without guessed pairing", () => {
  const before = wrap(scanFixture());
  const listener = before.report.sources.windows.listeners[0];
  before.report.sources.windows.listeners.push({ ...listener, pid: 102 });
  const after = structuredClone(before);
  after.report.sources.windows.listeners[0].pid = 200;
  after.report.sources.windows.listeners[1].pid = 201;
  const diff = compareSnapshots(before, after);
  assert.deepEqual(diff.changes.map((item) => item.category), ["listener-removed", "listener-removed", "listener-added", "listener-added"]);
});

test("both disabled probes are explicitly out of scope; enabling one side is incomplete", () => {
  const before = wrap();
  for (const side of ["windows", "wsl"]) for (const family of ["localhost", "ipv4", "ipv6"]) {
    before.report.endpointMatrix[side][family] = { status: "skipped", reachable: null, reason: "Disabled" };
  }
  const same = compareSnapshots(before, before);
  assert.equal(diffExitCode(same), 0);
  assert.equal(same.notes.filter((note) => note.startsWith("PROBES_SKIPPED")).length, 6);
  assert.equal(diffExitCode(compareSnapshots(before, wrap())), 2);
});

test("malformed or unsupported inputs cannot silently become empty reports", () => {
  for (const mutate of [
    (input) => { input.report.sources.windows = null; },
    (input) => { delete input.report.sources.windows.listeners; },
    (input) => { input.report.sources.windows.status = "typo"; },
    (input) => { input.report.endpointMatrix.windows.ipv4.reachable = null; },
    (input) => { input.report.schemaVersion = 999; },
    (input) => { input.report.sources.docker.mappings[0].hostPort = "5173"; },
  ]) {
    const input = wrap();
    mutate(input);
    assert.throws(() => validateInput(input), /Invalid report/);
  }
});

test("capture preserves report schemas and inventories once without per-port diagnosis", async () => {
  const fixture = scanFixture();
  const snapshot = await captureSnapshot({}, {
    hostname: "fixture-machine",
    scan: async (options) => { assert.equal(options.limit, 500); assert.equal(options.issuesOnly, false); return fixture; },
    diagnose: () => assert.fail("inventory must not probe every port"),
  });
  assert.strictEqual(snapshot.report, fixture);
  assert.equal(snapshot.kind, "snapshot");
  const diagnosis = diagnosisFixture();
  const selected = await captureSnapshot({ port: 5173, probe: false }, {
    diagnose: async (port, options) => { assert.equal(port, 5173); assert.equal(options.probe, false); return diagnosis; },
  });
  assert.strictEqual(selected.report, diagnosis);
});

test("snapshot files roundtrip, accept a UTF-8 BOM and never overwrite existing evidence", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "portdoc-snapshot-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "before.json");
  await saveSnapshot(file, wrap());
  assert.deepEqual(await readSnapshot(file), wrap());
  await assert.rejects(saveSnapshot(file, wrap()), { code: "EEXIST" });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), wrap());
  await writeFile(file, `\uFEFF${JSON.stringify(scanFixture())}`);
  assert.deepEqual(await readSnapshot(file), scanFixture());
  await writeFile(file, "not JSON");
  await assert.rejects(readSnapshot(file), /not valid UTF-8 JSON/);
  await assert.rejects(readSnapshot(directory), /regular JSON file|EISDIR|EPERM/);
});

test("CLI validates command scope, writes snapshots, compares offline and returns stable exits", async () => {
  assert.equal(parseArgs(["snapshot", "--out", "before.json"]).command, "snapshot");
  assert.equal(parseArgs(["snapshot", "5173", "--out=before.json"]).port, 5173);
  for (const args of [["snapshot"], ["snapshot", "70000", "--out", "x.json"], ["diff", "a.json"], ["diff", "a", "b", "--distro", "Ubuntu"], ["diff", "a", "b", "--timeout", "4000"], ["scan", "--out", "x.json"]]) {
    assert.throws(() => parseArgs(args));
  }
  const writes = [];
  let saved;
  assert.equal(await main(["snapshot", "--out", "before.json", "--json"], {
    scan: async () => scanFixture(),
    saveSnapshot: async (file, input) => { assert.equal(file, "before.json"); saved = input; },
    stdout: (value) => writes.push(value),
  }), 0);
  assert.deepEqual(JSON.parse(writes.pop()), saved);
  const before = wrap();
  const after = wrap();
  after.report.sources.windows.listeners[0].pid = 999;
  assert.equal(await main(["diff", "before.json", "after.json", "--json"], {
    readSnapshot: async (file) => file === "before.json" ? before : after,
    scan: () => assert.fail("diff is offline"), diagnose: () => assert.fail("diff is offline"),
    stdout: (value) => writes.push(value),
  }), 1);
  assert.equal(JSON.parse(writes.pop()).kind, "diff");
  const incomplete = scanFixture();
  incomplete.sources.wsl = { status: "unavailable", listeners: [] };
  let savedIncomplete = false;
  assert.equal(await main(["snapshot", "--out", "partial.json"], {
    scan: async () => incomplete, saveSnapshot: async () => { savedIncomplete = true; }, stdout: () => {},
  }), 2);
  assert.equal(savedIncomplete, true);
  assert.equal(await main(["diff", "missing.json", "after.json"], {
    readSnapshot: async () => { throw new Error("File missing"); }, stderr: (value) => writes.push(value),
  }), 2);
  assert.match(writes.pop(), /File missing/);
});

test("snapshot and diff help work in both languages without collecting evidence", async () => {
  for (const language of ["en", "zh-CN"]) for (const command of ["snapshot", "diff"]) {
    const writes = [];
    assert.equal(await main([command, "--help", "--lang", language], { stdout: (value) => writes.push(value) }), 0);
    assert.match(writes[0], /before.json/);
    assert.match(writes[0], /--out/);
  }
});
