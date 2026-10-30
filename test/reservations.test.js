import test from "node:test";
import assert from "node:assert/strict";

import { collectReservations, parseExcludedPortRanges } from "../src/collectors/reservations.js";

const english = [
  "Protocol tcp Port Exclusion Ranges",
  "",
  "Start Port    End Port",
  "----------    --------",
  "     50000       50059     *",
  "     50100       50199",
  "",
  "* - Administered port exclusions.",
].join("\r\n");

const chinese = [
  "协议 tcp 端口排除范围",
  "",
  "开始端口    结束端口",
  "----------    --------",
  "      5173        5173",
  "      8000        8099     *",
  "",
  "* - 管理的端口排除。",
].join("\n");

const empty = "Protocol tcp Port Exclusion Ranges\n\nStart Port End Port\n---------- --------\n\n* - Administered port exclusions.\n";
const ok = (stdout) => ({ exitCode: 0, stdout, stderr: "", timedOut: false, missing: false });

test("parses English excluded-port ranges and the administered marker", () => {
  assert.deepEqual(parseExcludedPortRanges(english, 4), [
    { family: 4, start: 50000, end: 50059, administered: true },
    { family: 4, start: 50100, end: 50199, administered: false },
  ]);
});

test("parses localized headings without relying on translated words", () => {
  assert.deepEqual(parseExcludedPortRanges(chinese, 6), [
    { family: 6, start: 5173, end: 5173, administered: false },
    { family: 6, start: 8000, end: 8099, administered: true },
  ]);
  assert.deepEqual(parseExcludedPortRanges("Protokoll tcp\nStartport Endport\n---------- --------\n 80 443 *\n* - Verwaltete Ausschlüsse.", 4), [
    { family: 4, start: 80, end: 443, administered: true },
  ]);
});

test("distinguishes a verified empty table from absent or malformed output", () => {
  assert.deepEqual(parseExcludedPortRanges(empty, 4), []);
  for (const raw of ["", "Access is denied.", "Start Port End Port", "---------- --------\n5000 unknown", "---------- --------\n70000 70001", "---------- --------\n8000 7000", "---------- --------\n0 100"]) {
    assert.throws(() => parseExcludedPortRanges(raw, 4), /unreadable|invalid/);
  }
});

test("queries only active IPv4/IPv6 TCP exclusions and matches both range boundaries", async () => {
  const calls = [];
  const options = {
    force: true,
    timeoutMs: 900,
    runCommand: async (file, args, runnerOptions) => {
      calls.push({ file, args, runnerOptions });
      return ok(english);
    },
  };
  const first = await collectReservations(50000, options);
  assert.equal(first.status, "ok");
  assert.equal(first.ranges.length, 4);
  assert.deepEqual(first.matches.map((range) => range.family), [4, 6]);
  assert.deepEqual(calls, [
    { file: "netsh.exe", args: ["interface", "ipv4", "show", "excludedportrange", "protocol=tcp"], runnerOptions: { timeoutMs: 900 } },
    { file: "netsh.exe", args: ["interface", "ipv6", "show", "excludedportrange", "protocol=tcp"], runnerOptions: { timeoutMs: 900 } },
  ]);
  const last = await collectReservations(50059, options);
  assert.equal(last.matches.length, 2);
  const outside = await collectReservations(50060, options);
  assert.equal(outside.matches.length, 0);
});

test("retains successful evidence when the other address family fails", async () => {
  const result = await collectReservations(5173, {
    force: true,
    runCommand: async (_file, args) => args[1] === "ipv4" ? ok(chinese)
      : { exitCode: 5, stdout: "", stderr: "Access is denied.", missing: false, timedOut: false },
  });
  assert.equal(result.status, "error");
  assert.equal(result.ranges.length, 2);
  assert.deepEqual(result.matches, [{ family: 4, start: 5173, end: 5173, administered: false }]);
  assert.equal(result.families.ipv4.status, "ok");
  assert.equal(result.families.ipv6.status, "error");
  assert.match(result.families.ipv6.reason, /denied/i);
});

test("reports timeouts and malformed success output separately from empty tables", async () => {
  const result = await collectReservations(5173, {
    force: true,
    runCommand: async (_file, args) => args[1] === "ipv4"
      ? { exitCode: null, stdout: "", stderr: "", timedOut: true, missing: false }
      : ok("The command was not found."),
  });
  assert.equal(result.status, "error");
  assert.match(result.families.ipv4.reason, /timed out/);
  assert.match(result.families.ipv6.reason, /unreadable/);
  assert.deepEqual(result.matches, []);
});

test("recognizes localized access denials even if netsh returns zero", async () => {
  const result = await collectReservations(5173, { force: true, runCommand: async () => ok("拒绝访问。") });
  assert.equal(result.status, "error");
  assert.match(result.families.ipv4.reason, /denied/);
});

test("reports an unavailable executable without pretending that exclusions are empty", async () => {
  const result = await collectReservations(5173, { force: true, runCommand: async () => ({ missing: true }) });
  assert.equal(result.status, "unavailable");
  assert.equal(result.families.ipv4.status, "unavailable");
  assert.equal(result.families.ipv6.status, "unavailable");
  assert.match(result.families.ipv4.reason, /not found/);
  assert.deepEqual(result.ranges, []);
});

test("one missing family remains an incomplete inspection even when the other succeeds", async () => {
  const result = await collectReservations(5173, {
    force: true,
    runCommand: async (_file, args) => args[1] === "ipv4" ? { missing: true } : ok(chinese),
  });
  assert.equal(result.status, "error");
  assert.equal(result.families.ipv4.status, "unavailable");
  assert.equal(result.families.ipv6.status, "ok");
  assert.deepEqual(result.matches, [{ family: 6, start: 5173, end: 5173, administered: false }]);
});

test("successful empty tables for both families are a complete inspection", async () => {
  const result = await collectReservations(5173, { force: true, runCommand: async () => ok(empty) });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.ranges, []);
  assert.deepEqual(result.matches, []);
  assert.equal(result.families.ipv4.status, "ok");
  assert.equal(result.families.ipv6.status, "ok");
  assert.equal(result.reason, undefined);
});

test("an exception in one runner does not erase the other family's evidence", async () => {
  const result = await collectReservations(5173, {
    force: true,
    runCommand: async (_file, args) => {
      if (args[1] === "ipv6") throw Object.assign(new Error("access denied"), { code: "EACCES" });
      return ok(chinese);
    },
  });
  assert.equal(result.status, "error");
  assert.equal(result.matches.length, 1);
  assert.equal(result.families.ipv4.status, "ok");
  assert.equal(result.families.ipv6.status, "error");
});

test("does not execute queries for an invalid port", async () => {
  const result = await collectReservations(0, { force: true, runCommand: async () => assert.fail("must not query") });
  assert.equal(result.status, "error");
  assert.match(result.reason, /TCP port/);
});
