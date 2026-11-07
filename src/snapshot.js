import { open, writeFile } from "node:fs/promises";
import os from "node:os";
import { diagnose } from "./diagnose.js";
import { scan } from "./scan.js";

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const sourceStatuses = new Set(["ok", "error", "unavailable"]);
const probeStatuses = new Set([...sourceStatuses, "skipped"]);

// Keep the embedded report unchanged: existing scan v1 and diagnosis v3
// consumers can read snapshot.report without adopting another report schema.
export async function captureSnapshot(options = {}, dependencies = {}) {
  const report = options.port === undefined
    ? await (dependencies.scan ?? scan)({ ...options, limit: 500, issuesOnly: false })
    : await (dependencies.diagnose ?? diagnose)(options.port, options);
  const snapshot = {
    schemaVersion: 1,
    kind: "snapshot",
    context: {
      hostname: dependencies.hostname ?? os.hostname(),
      platform: process.platform,
      requestedDistro: options.distro ?? null,
    },
    report,
  };
  validateInput(snapshot);
  return snapshot;
}

export async function saveSnapshot(file, snapshot) {
  validateInput(snapshot);
  // Refuse overwrites, including an existing symlink. A failed or partial
  // collection is still valuable evidence and is saved with its real status.
  await writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

export async function readSnapshot(file) {
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error("Input must be a regular JSON file of at most 32 MiB.");
    const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_FILE_BYTES) throw new Error("Input must be a regular JSON file of at most 32 MiB.");
    let input;
    try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)).replace(/^\uFEFF/, "")); }
    catch { throw new Error("Input is not valid UTF-8 JSON."); }
    validateInput(input);
    return input;
  } finally {
    await handle.close();
  }
}

export function validateInput(input) {
  requireObject(input, "input");
  const wrapped = input.kind === "snapshot";
  if (wrapped) {
    if (input.schemaVersion !== 1) invalid("unsupported snapshot version");
    requireObject(input.context, "snapshot context");
    for (const field of ["hostname", "platform"]) {
      if (typeof input.context[field] !== "string" || !input.context[field]) invalid(`context.${field}`);
    }
    nullableString(input.context.requestedDistro, "context.requestedDistro");
  }
  const report = wrapped ? input.report : input;
  requireObject(report, "report");
  if (!((report.kind === "scan" && report.schemaVersion === 1) || (report.kind === "diagnosis" && report.schemaVersion === 3))) {
    invalid("expected scan v1 or diagnosis v3");
  }
  if (typeof report.checkedAt !== "string" || !Number.isFinite(Date.parse(report.checkedAt))) invalid("checkedAt");
  if (report.sample !== undefined && typeof report.sample !== "boolean") invalid("sample");
  requireObject(report.sources, "sources");
  for (const side of ["windows", "wsl", "docker"]) {
    const source = report.sources[side];
    requireObject(source, `sources.${side}`);
    if (!sourceStatuses.has(source.status)) invalid(`${side}.status`);
    nullableString(source.reason, `${side}.reason`);
    nullableString(source.distro, `${side}.distro`);
    nullableString(source.endpoint, `${side}.endpoint`);
    const key = side === "docker" ? "mappings" : "listeners";
    if (!Array.isArray(source[key])) invalid(`${side}.${key}`);
    for (const item of source[key]) {
      requireObject(item, `${side} item`);
      if (side === "docker") {
        for (const field of ["containerId", "container", "image", "hostAddress"]) string(item[field], `mapping.${field}`);
        port(item.hostPort); port(item.containerPort);
        if (item.protocol !== "tcp") invalid("mapping.protocol");
        for (const field of ["composeProject", "composeService", "projectPath"]) nullableString(item[field], `mapping.${field}`);
      } else {
        string(item.address, "listener.address"); port(item.port);
        if (item.pid !== null && (!Number.isSafeInteger(item.pid) || item.pid < 0)) invalid("listener.pid");
        for (const field of ["process", "path", "commandLine", "cwd", "projectPath", "identitySource"]) nullableString(item[field], `listener.${field}`);
      }
    }
  }
  if (report.kind === "scan") {
    if (!Array.isArray(report.ports) || typeof report.truncated !== "boolean") invalid("scan ports/truncated");
    // Diff uses the complete sources arrays, never the display-limited ports.
    for (const field of ["totalPorts", "overlapCount", "limit"]) {
      if (!Number.isInteger(report[field]) || report[field] < 0) invalid(`scan.${field}`);
    }
  } else {
    port(report.port);
    if (report.protocol !== "tcp") invalid("diagnosis.protocol");
    for (const side of ["windows", "wsl"]) {
      requireObject(report.endpointMatrix?.[side], `endpointMatrix.${side}`);
      for (const family of ["localhost", "ipv4", "ipv6"]) {
        const probe = report.endpointMatrix[side][family];
        requireObject(probe, `${side}.${family}`);
        if (!probeStatuses.has(probe.status)) invalid("probe.status");
        if (probe.status === "ok" ? typeof probe.reachable !== "boolean" : probe.reachable !== null) invalid("probe.reachable");
        nullableString(probe.address, "probe.address");
        nullableString(probe.reason, "probe.reason");
        if (probe.family != null && ![4, 6].includes(probe.family)) invalid("probe.family");
      }
    }
    requireObject(report.reservations, "reservations");
    if (!sourceStatuses.has(report.reservations.status) || !Array.isArray(report.reservations.matches)) invalid("reservations status/matches");
    for (const family of ["ipv4", "ipv6"]) {
      if (!sourceStatuses.has(report.reservations.families?.[family]?.status)) invalid(`reservations.${family}`);
    }
    for (const range of report.reservations.matches) {
      requireObject(range, "reservation");
      if (![4, 6].includes(range.family)) invalid("reservation.family");
      port(range.start); port(range.end);
      if (range.start > range.end || typeof range.administered !== "boolean") invalid("reservation range");
    }
  }
  return { report, context: wrapped ? input.context : null };
}

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
}
function string(value, field) { if (typeof value !== "string") invalid(field); }
function nullableString(value, field) { if (value != null) string(value, field); }
function port(value) { if (!Number.isInteger(value) || value < 1 || value > 65535) invalid("TCP port"); }
function invalid(field) { throw new Error(`Invalid report: ${field}.`); }
