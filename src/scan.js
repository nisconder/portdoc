import { inventoryWindows } from "./collectors/windows.js";
import { inventoryWsl } from "./collectors/wsl.js";
import { inventoryDocker } from "./collectors/docker.js";

// Inventory visible listener tables once per layer. This is deliberately not
// a TCP port scan: it makes no connections and never loops over 1..65535.
export async function scan(options = {}) {
  const limit = options.limit ?? 30;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("--limit must be an integer from 1 to 500.");
  const inventory = options.inventory ?? {};
  const [windows, wsl, docker] = await Promise.all([
    readSource("windows", inventory.windows ?? inventoryWindows, options),
    readSource("wsl", inventory.wsl ?? inventoryWsl, options),
    readSource("docker", inventory.docker ?? inventoryDocker, options),
  ]);
  const byPort = new Map();
  const add = (side, item, port) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) return;
    if (!byPort.has(port)) byPort.set(port, { port, windows: [], wsl: [], docker: [], overlap: false });
    byPort.get(port)[side].push(item);
  };
  for (const listener of windows.listeners) add("windows", listener, listener.port);
  for (const listener of wsl.listeners) add("wsl", listener, listener.port);
  for (const mapping of docker.mappings) {
    if (mapping.protocol === "tcp") add("docker", mapping, mapping.hostPort);
  }
  const ports = [...byPort.values()].sort((left, right) => left.port - right.port);
  for (const entry of ports) entry.overlap = hasPotentialOverlap(entry);
  const selected = options.issuesOnly ? ports.filter((entry) => entry.overlap) : ports;
  return {
    schemaVersion: 1,
    kind: "scan",
    checkedAt: new Date().toISOString(),
    sources: { windows, wsl, docker },
    ports: selected.slice(0, limit),
    totalPorts: selected.length,
    overlapCount: selected.filter((entry) => entry.overlap).length,
    truncated: selected.length > limit,
    limit,
  };
}

export const scanPorts = scan;

async function readSource(side, reader, options) {
  try {
    return await reader(options);
  } catch {
    return {
      status: "error",
      [side === "docker" ? "mappings" : "listeners"]: [],
      reason: `${side === "wsl" ? "WSL" : side === "docker" ? "Docker" : "Windows"} inventory could not be collected.`,
    };
  }
}

function hasPotentialOverlap(entry) {
  const windows = entry.windows.filter((item) => !isForwarder(item.process));
  const wsl = entry.wsl.filter((item) => !isForwarder(item.process));
  if (windows.some((left) => wsl.some((right) => mayOverlap(left.address, right.address)))) return true;
  if (entry.docker.some((mapping) => windows.some((listener) => mayOverlap(mapping.hostAddress, listener.address)))) return true;
  return entry.docker.some((mapping) => wsl.some((listener) => mayOverlap(mapping.hostAddress, listener.address)));
}

function isForwarder(name) {
  return /docker|com\.docker|vpnkit/i.test(name ?? "") || /^(wslrelay|wslhost)(\.exe)?$/i.test(name ?? "");
}

function mayOverlap(left, right) {
  if (!left || !right) return true;
  const normalize = (value) => value.toLowerCase().replace(/^\[(.*)\]$/, "$1").replace(/^::ffff:/, "");
  const a = normalize(left);
  const b = normalize(right);
  // IPv6 wildcard dual-stack behavior depends on the owner and network mode;
  // include it as potential evidence rather than pretending it is definitive.
  if (["*", "::"].includes(a) || ["*", "::"].includes(b)) return true;
  if (a === b) return true;
  if (a === "0.0.0.0" && !b.includes(":")) return true;
  return b === "0.0.0.0" && !a.includes(":");
}
