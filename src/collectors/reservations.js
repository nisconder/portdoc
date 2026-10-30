import { runCommand } from "../lib/run-command.js";

const FAMILIES = [["ipv4", 4], ["ipv6", 6]];

// netsh's table headings and footer are localized, but the two numeric port
// columns, dashed separator and administered-exclusion asterisk are stable.
// A verified empty table is evidence; empty stdout or an error message is not.
export function parseExcludedPortRanges(raw, family) {
  if (family !== 4 && family !== 6) throw new TypeError("Expected an IPv4 or IPv6 address family.");
  const lines = String(raw ?? "").replace(/\0/g, "").replace(/^\uFEFF/, "").split(/\r?\n/);
  const separator = lines.findIndex((line) => /^\s*-{2,}\s+-{2,}(?:\s+-{2,})?\s*$/.test(line));
  if (separator < 0) throw new Error("netsh returned unreadable excluded-port range data.");

  const ranges = [];
  for (const line of lines.slice(separator + 1)) {
    if (!line.trim()) continue;
    if (/^\s*\*\s*[-\u2013\u2014]\s*\S/.test(line)) break;
    const row = line.match(/^\s*(\d{1,5})\s+(\d{1,5})\s*(\*)?\s*$/);
    if (!row) throw new Error("netsh returned unreadable excluded-port range data.");
    const start = Number(row[1]);
    const end = Number(row[2]);
    if (start < 1 || end > 65_535 || start > end) {
      throw new Error("netsh returned an invalid excluded-port range.");
    }
    ranges.push({ family, start, end, administered: Boolean(row[3]) });
  }
  return ranges;
}

export async function collectReservations(port, options = {}) {
  if (process.platform !== "win32" && !options.force) {
    return unavailableResult("Windows port exclusions can only be inspected on Windows.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    const reason = "A TCP port from 1 to 65535 is required to inspect exclusions.";
    return { status: "error", ranges: [], matches: [], families: Object.fromEntries(FAMILIES.map(([name]) => [name, { status: "error", reason }])), reason };
  }

  const runner = options.runCommand ?? runCommand;
  const results = await Promise.all(FAMILIES.map(async ([name, family]) => {
    try {
      const result = await runner("netsh.exe", ["interface", name, "show", "excludedportrange", "protocol=tcp"], { timeoutMs: options.timeoutMs });
      if (result.missing) return { status: "unavailable", reason: "netsh.exe was not found.", missing: true, ranges: [] };
      if (result.timedOut) return { status: "error", reason: `${name.toUpperCase()} excluded-port query timed out.`, ranges: [] };
      const output = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.replace(/\0/g, "");
      if (result.exitCode === 5 || /access (?:is )?denied|requires elevation|拒绝访问|访问被拒绝|Zugriff (?:wurde )?verweigert|Acc[eè]s refus[eé]/i.test(output)) {
        return { status: "error", reason: `Access to ${name.toUpperCase()} excluded-port ranges was denied.`, ranges: [] };
      }
      if (result.exitCode !== 0) {
        const detail = firstLine(output);
        return { status: "error", reason: `${name.toUpperCase()} excluded-port query failed${detail ? `: ${detail}` : "."}`, ranges: [] };
      }
      return { status: "ok", ranges: parseExcludedPortRanges(result.stdout, family) };
    } catch (error) {
      const missing = error?.code === "ENOENT";
      return {
        status: missing ? "unavailable" : "error",
        reason: missing ? "netsh.exe was not found." : firstLine(error?.message) || `${name.toUpperCase()} excluded-port query failed.`,
        missing,
        ranges: [],
      };
    }
  }));

  const status = results.every((result) => result.status === "ok") ? "ok"
    : results.every((result) => result.missing) ? "unavailable" : "error";
  const ranges = results.flatMap((result) => result.ranges);
  // A match is a potential bind restriction, not proof that binding must fail.
  // Existing listeners and excluded ranges may legitimately coexist.
  return {
    status,
    ranges,
    matches: ranges.filter((range) => port >= range.start && port <= range.end),
    families: Object.fromEntries(FAMILIES.map(([name], index) => [name, {
      status: results[index].status,
      ...(results[index].reason ? { reason: results[index].reason } : {}),
    }])),
    ...(status !== "ok" ? { reason: "Windows port exclusions could not be fully inspected; see the per-family results." } : {}),
  };
}

function unavailableResult(reason) {
  return {
    status: "unavailable",
    ranges: [],
    matches: [],
    families: Object.fromEntries(FAMILIES.map(([name]) => [name, { status: "unavailable", reason }])),
    reason,
  };
}

function firstLine(value) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, " ").split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 300) ?? "";
}
