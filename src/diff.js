import { validateInput } from "./snapshot.js";

const listenerFields = ["address", "port", "pid", "process", "path", "commandLine", "cwd", "projectPath", "identitySource"];
const mappingFields = ["containerId", "container", "image", "hostAddress", "hostPort", "containerPort", "protocol", "composeProject", "composeService", "projectPath"];
const identityFields = new Set(["pid", "process", "path", "commandLine", "cwd", "projectPath", "identitySource", "composeProject", "composeService"]);

export function compareSnapshots(beforeInput, afterInput) {
  const before = validateInput(beforeInput);
  const after = validateInput(afterInput);
  const a = before.report;
  const b = after.report;
  if (a.kind !== b.kind || a.port !== b.port) throw new Error("Compare reports of the same kind and TCP port.");
  if (Boolean(a.sample) !== Boolean(b.sample)) throw new Error("Cannot compare simulated and real reports.");
  if (before.context && after.context && (before.context.hostname !== after.context.hostname || before.context.platform !== after.context.platform)) {
    throw new Error("Snapshots belong to different hosts or platforms.");
  }
  const result = {
    schemaVersion: 1, kind: "diff", reportKind: a.kind,
    before: { checkedAt: a.checkedAt, port: a.port ?? null },
    after: { checkedAt: b.checkedAt, port: b.port ?? null },
    sample: Boolean(a.sample), complete: true, changed: false,
    changes: [], unknown: [], notes: [],
  };
  if (!before.context || !after.context) result.notes.push("LEGACY_HOST_UNVERIFIED");
  if (Date.parse(b.checkedAt) < Date.parse(a.checkedAt)) result.notes.push("AFTER_PREDATES_BEFORE");
  if (a.kind === "scan") result.notes.push("INVENTORY_HAS_NO_REACHABILITY_PROBES");

  const add = (category, source, identity, oldValue, newValue, field = null) => {
    result.changes.push({ category, source, identity, field, before: oldValue, after: newValue });
  };
  const unknown = (source, reason, oldStatus, newStatus) => {
    result.complete = false;
    result.unknown.push({ source, reason, beforeStatus: oldStatus ?? null, afterStatus: newStatus ?? null });
  };
  const wslContextChanged = contextChanged(a.sources.wsl.distro, b.sources.wsl.distro)
    || contextChanged(before.context?.requestedDistro, after.context?.requestedDistro);
  const dockerContextChanged = contextChanged(a.sources.docker.endpoint, b.sources.docker.endpoint);
  const wslContextUnverified = !knownContext(a.sources.wsl.distro) || !knownContext(b.sources.wsl.distro);
  const dockerContextUnverified = !knownContext(a.sources.docker.endpoint) || !knownContext(b.sources.docker.endpoint);

  for (const side of ["windows", "wsl", "docker"]) {
    const oldSource = a.sources[side];
    const newSource = b.sources[side];
    const statusA = { status: oldSource.status, reason: oldSource.reason ?? null };
    const statusB = { status: newSource.status, reason: newSource.reason ?? null };
    if (!equal(statusA, statusB)) add("evidence", side, null, statusA, statusB);
    if (oldSource.status !== "ok" || newSource.status !== "ok") {
      unknown(side, "SOURCE_INCOMPLETE", oldSource.status, newSource.status);
      continue;
    }
    if ((side === "wsl" && wslContextUnverified) || (side === "docker" && dockerContextUnverified)) {
      unknown(side, "SOURCE_CONTEXT_UNVERIFIED", oldSource.status, newSource.status);
      continue;
    }
    if ((side === "wsl" && wslContextChanged) || (side === "docker" && dockerContextChanged)) {
      add("context", side, null,
        side === "wsl" ? { distro: oldSource.distro ?? null, requestedDistro: before.context?.requestedDistro ?? null } : oldSource.endpoint,
        side === "wsl" ? { distro: newSource.distro ?? null, requestedDistro: after.context?.requestedDistro ?? null } : newSource.endpoint);
      unknown(side, "SOURCE_CONTEXT_CHANGED", oldSource.status, newSource.status);
      continue;
    }
    const docker = side === "docker";
    const key = docker ? "mappings" : "listeners";
    const fields = docker ? mappingFields : listenerFields;
    // Match stable endpoint slots. PID/container replacement is shown as a
    // field change; multiple simultaneous owners are handled as a multiset.
    const identity = docker
      ? (row) => JSON.stringify([row.hostAddress, row.hostPort, row.protocol])
      : (row) => JSON.stringify([row.address, row.port]);
    compareRows(oldSource[key], newSource[key], fields, identity, (oldRow, newRow, slot) => {
      const category = docker ? "mapping" : "listener";
      if (!oldRow || !newRow) {
        add(`${category}-${oldRow ? "removed" : "added"}`, side, slot, oldRow, newRow);
        return;
      }
      for (const field of fields) {
        if (equal(oldRow[field], newRow[field])) continue;
        const evidenceOnly = identityFields.has(field) && (oldRow[field] === null || newRow[field] === null);
        add(evidenceOnly ? "identity-evidence" : `${category}-changed`, side, slot, oldRow[field], newRow[field], field);
        if (evidenceOnly) unknown(`${side}:${slot}:${field}`, "IDENTITY_INCOMPLETE", oldRow[field] === null ? "unknown" : "known", newRow[field] === null ? "unknown" : "known");
      }
    });
  }

  if (a.kind === "diagnosis") {
    for (const side of ["windows", "wsl"]) {
      for (const family of ["localhost", "ipv4", "ipv6"]) {
        const source = `${side}.${family}`;
        const oldProbe = a.endpointMatrix[side][family];
        const newProbe = b.endpointMatrix[side][family];
        const statusA = { status: oldProbe.status, reason: oldProbe.status === "ok" ? null : oldProbe.reason ?? null };
        const statusB = { status: newProbe.status, reason: newProbe.status === "ok" ? null : newProbe.reason ?? null };
        if (!equal(statusA, statusB)) add("evidence", source, null, statusA, statusB);
        if (side === "wsl" && wslContextUnverified) {
          unknown(source, "SOURCE_CONTEXT_UNVERIFIED", oldProbe.status, newProbe.status);
        } else if (side === "wsl" && wslContextChanged) {
          unknown(source, "SOURCE_CONTEXT_CHANGED", oldProbe.status, newProbe.status);
        } else if (oldProbe.status === "skipped" && newProbe.status === "skipped") {
          result.notes.push(`PROBES_SKIPPED:${source}`);
        } else if (oldProbe.status !== "ok" || newProbe.status !== "ok") {
          unknown(source, "PROBE_INCOMPLETE", oldProbe.status, newProbe.status);
        } else {
          const valueA = pick(oldProbe, ["reachable", "address", "family"]);
          const valueB = pick(newProbe, ["reachable", "address", "family"]);
          if (!equal(valueA, valueB)) add("endpoint", source, null, valueA, valueB);
        }
      }
    }
    for (const family of ["ipv4", "ipv6"]) {
      const source = `reservations.${family}`;
      const oldStatus = a.reservations.families[family].status;
      const newStatus = b.reservations.families[family].status;
      if (oldStatus !== newStatus) add("evidence", source, null, oldStatus, newStatus);
      if (oldStatus !== "ok" || newStatus !== "ok") {
        unknown(source, "RESERVATIONS_INCOMPLETE", oldStatus, newStatus);
        continue;
      }
      const values = (report) => report.reservations.matches.filter((row) => row.family === (family === "ipv4" ? 4 : 6))
        .map((row) => pick(row, ["family", "start", "end", "administered"])).sort(byJson);
      const rangesA = values(a);
      const rangesB = values(b);
      if (!equal(rangesA, rangesB)) add("reservation", source, null, rangesA, rangesB);
    }
  }
  result.changed = result.changes.length > 0;
  return result;
}

export function diffExitCode(result) {
  return !result.complete ? 2 : result.changed ? 1 : 0;
}

function compareRows(oldRows, newRows, fields, identify, visit) {
  const group = (rows) => {
    const groups = new Map();
    for (const raw of rows) {
      const row = pick(raw, fields);
      const key = identify(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    for (const rows of groups.values()) rows.sort(byJson);
    return groups;
  };
  const oldGroups = group(oldRows);
  const newGroups = group(newRows);
  const keys = [...new Set([...oldGroups.keys(), ...newGroups.keys()])].sort();
  for (const key of keys) {
    const oldGroup = [...(oldGroups.get(key) ?? [])];
    const newGroup = [...(newGroups.get(key) ?? [])];
    // Remove exact pairs first: reordered sources and duplicate rows are not changes.
    const unmatched = oldGroup.filter((row) => {
      const index = newGroup.findIndex((other) => equal(row, other));
      if (index < 0) return true;
      newGroup.splice(index, 1);
      return false;
    });
    // Only infer field changes when a slot has one unambiguous owner on both
    // sides. With several owners, preserve whole added/removed observations.
    if (unmatched.length === 1 && newGroup.length === 1) visit(unmatched[0], newGroup[0], key);
    else {
      for (const row of unmatched) visit(row, null, key);
      for (const row of newGroup) visit(null, row, key);
    }
  }
}

function contextChanged(a, b) { return a != null && b != null && a !== b; }
function knownContext(value) { return typeof value === "string" && value.trim() !== "" && value.trim().toLowerCase() !== "unknown"; }
function pick(row, fields) { return Object.fromEntries(fields.map((key) => [key, row[key] ?? null])); }
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function byJson(a, b) { const x = JSON.stringify(a); const y = JSON.stringify(b); return x < y ? -1 : x > y ? 1 : 0; }

export function formatDiff(result, { language = "en" } = {}) {
  const zh = language === "zh-CN";
  const status = !result.complete ? (zh ? "证据不完整" : "INCOMPLETE")
    : result.changed ? (zh ? "有变化" : "CHANGED") : (zh ? "未观察到变化" : "UNCHANGED");
  const lines = [
    `portdoc diff — ${status}`,
    `${result.before.checkedAt} → ${result.after.checkedAt}${result.before.port === null ? "" : ` | TCP ${result.before.port}`}`,
    zh ? `${result.changes.length} 项变化，${result.unknown.length} 项无法比较` : `${result.changes.length} changes; ${result.unknown.length} comparisons unavailable`,
  ];
  if (result.sample) lines.push(zh ? "模拟报告，非真实机器证据。" : "Simulated reports, not real-machine evidence.");
  const labels = zh ? { context: "采集对象变化", evidence: "采集状态", "identity-evidence": "身份信息缺失/恢复", "listener-added": "新观察到监听", "listener-removed": "不再观察到监听", "listener-changed": "监听信息变化", "mapping-added": "新观察到映射", "mapping-removed": "不再观察到映射", "mapping-changed": "映射信息变化", endpoint: "端点变化", reservation: "排除范围变化" } : {};
  for (const change of result.changes.slice(0, 100)) {
    lines.push(`\n${labels[change.category] ?? change.category} | ${change.source}${change.identity ? ` ${change.identity}` : ""}${change.field ? ` ${change.field}` : ""}`);
    lines.push(`  ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`);
  }
  if (result.changes.length > 100) lines.push(zh ? "仅显示前 100 项；--json 包含全部变化。" : "Showing the first 100 changes; --json contains every change.");
  for (const item of result.unknown.slice(0, 100)) lines.push(`? ${item.source}: ${item.reason} (${item.beforeStatus} → ${item.afterStatus})`);
  if (result.unknown.length > 100) lines.push(zh ? "--json 包含全部无法比较项。" : "--json contains every unavailable comparison.");
  if (result.notes.length) lines.push(`\n${zh ? "范围" : "Scope"}: ${result.notes.join(", ")}`);
  lines.push(zh ? "变化只描述观察结果，不证明根因或问题已修复；缺失证据不表示服务已消失。" : "Changes describe observations, not a root cause or a confirmed fix. Missing evidence does not mean a service disappeared.");
  return lines.join("\n");
}
