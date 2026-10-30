import { existsSync } from "node:fs";
import path from "node:path";

import { runCommand } from "../lib/run-command.js";
import { cleanIdentityText } from "../lib/identity.js";

const LOCAL_ENGINE_ENDPOINTS = [
  "npipe:////./pipe/docker_engine",
  "npipe:////./pipe/dockerDesktopLinuxEngine",
];

export function parseDockerPorts(raw, requestedPort, protocol = "tcp") {
  if (!raw) return [];
  const containers = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  return containers.flatMap((container) => {
    const labels = parseLabels(container.Labels);
    const ports = String(container.Ports ?? "")
      .split(/,\s*/)
      .map((value) => value.trim())
      .map(parsePublishedPort)
      .filter(Boolean)
      .filter((mapping) => (requestedPort == null || mapping.hostPort === requestedPort) && mapping.protocol === protocol);

    return ports.map((mapping) => ({
      containerId: String(container.ID ?? ""),
      container: cleanIdentityText(container.Names) ?? "",
      image: cleanIdentityText(container.Image) ?? "",
      hostAddress: mapping.hostAddress,
      hostPort: mapping.hostPort,
      containerPort: mapping.containerPort,
      protocol: mapping.protocol,
      composeProject: cleanIdentityText(labels["com.docker.compose.project"]),
      composeService: cleanIdentityText(labels["com.docker.compose.service"]),
      projectPath: cleanIdentityText(labels["com.docker.compose.project.working_dir"]),
    }));
  });
}

function parseLabels(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  return Object.fromEntries(value.split(",").flatMap((entry) => {
    const separator = entry.indexOf("=");
    return separator < 0 ? [] : [[entry.slice(0, separator), entry.slice(separator + 1)]];
  }));
}

export async function collectDocker(port, options = {}) {
  return queryDocker(port, options);
}

export async function inventoryDocker(options = {}) {
  return queryDocker(undefined, options);
}

async function queryDocker(port, options) {
  const runner = options.runCommand ?? runCommand;
  let executable = options.dockerPath ?? "docker";
  // Windows ownership evidence must come from this machine. An inherited
  // production/SSH context would otherwise turn a remote mapping into a false
  // local conflict. Explicit local pipes and a per-child environment avoid
  // changing the user's selected Docker context or shell environment.
  const environment = { ...process.env, ...options.environment };
  for (const key of Object.keys(environment)) {
    if (["DOCKER_HOST", "DOCKER_CONTEXT"].includes(key.toUpperCase())) delete environment[key];
  }
  const deadline = performance.now() + (options.timeoutMs ?? 4_000);
  const failures = [];

  for (const [index, endpoint] of LOCAL_ENGINE_ENDPOINTS.entries()) {
    const args = ["--host", endpoint, "ps", "--no-trunc", "--format", "{{json .}}"];
    const queryOptions = () => ({
      timeoutMs: Math.max(1, Math.floor((deadline - performance.now()) / (LOCAL_ENGINE_ENDPOINTS.length - index))),
      spawnOptions: { env: environment },
    });
    let result = await runner(executable, args, queryOptions());
    if (result.missing && !options.dockerPath) {
      const fallback = findDockerDesktopCli(options);
      if (fallback) {
        executable = fallback;
        result = await runner(executable, args, queryOptions());
      }
    }
    if (result.missing) {
      return {
        status: "unavailable",
        executable: null,
        endpoint: null,
        mappings: [],
        reason: options.dockerPath
          ? `Docker CLI was not found at ${options.dockerPath}.`
          : "Docker CLI was not found in PATH or Docker Desktop's standard install locations.",
      };
    }
    if (result.timedOut || result.exitCode !== 0) {
      failures.push(result);
      continue;
    }
    try {
      const mappings = parseDockerPorts(result.stdout, port);
      const unsupported = unsupportedPublishedMappings(result.stdout, port);
      if (unsupported) {
        return {
          status: "error",
          executable,
          endpoint,
          mappings,
          reason: `Docker returned ${unsupported} unsupported published TCP mapping(s), including port ranges; these entries are omitted from the report.`,
        };
      }
      return { status: "ok", executable, endpoint, mappings };
    } catch {
      return { status: "error", executable, endpoint, mappings: [], reason: "Docker returned unreadable container data." };
    }
  }
  return {
    status: failures.some((failure) => failure.timedOut) ? "error" : "unavailable",
    executable,
    endpoint: null,
    mappings: [],
    reason: failures.some((failure) => failure.timedOut)
      ? "Local Docker engine queries timed out. Neither local named pipe returned an inventory; remote contexts are not inspected."
      : "Docker Desktop is installed, but its local engine is not running or cannot be accessed through docker_engine or dockerDesktopLinuxEngine. Start Docker Desktop and retry. Remote contexts are not inspected.",
  };
}

function unsupportedPublishedMappings(raw, requestedPort) {
  if (!raw) return 0;
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).reduce((total, container) => {
    return total + String(container.Ports ?? "").split(/,\s*/).map((value) => value.trim()).filter((value) => {
      if (!value.includes("->") || !value.endsWith("/tcp") || parsePublishedPort(value)) return false;
      const range = value.match(/:(\d+)-(\d+)->/);
      if (requestedPort != null && range && (requestedPort < Number(range[1]) || requestedPort > Number(range[2]))) return false;
      return true;
    }).length;
  }, 0);
}

export function findDockerDesktopCli(options = {}) {
  const environment = options.environment ?? process.env;
  const fileExists = options.existsSync ?? existsSync;
  const candidates = [
    environment.ProgramFiles && path.win32.join(environment.ProgramFiles, "Docker", "Docker", "resources", "bin", "docker.exe"),
    "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
    environment.LOCALAPPDATA && path.win32.join(environment.LOCALAPPDATA, "Docker", "resources", "bin", "docker.exe"),
    environment.LOCALAPPDATA && path.win32.join(environment.LOCALAPPDATA, "Programs", "Docker", "Docker", "resources", "bin", "docker.exe"),
    environment.ProgramData && path.win32.join(environment.ProgramData, "DockerDesktop", "version-bin", "docker.exe"),
  ].filter(Boolean);

  return [...new Set(candidates)].find((candidate) => fileExists(candidate)) ?? null;
}

function parsePublishedPort(value) {
  const match = value.match(/^(.*):(\d+)->(\d+)\/(tcp|udp)$/);
  if (!match) return null;
  return {
    hostAddress: match[1],
    hostPort: Number(match[2]),
    containerPort: Number(match[3]),
    protocol: match[4],
  };
}
