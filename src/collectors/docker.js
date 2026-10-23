import { existsSync } from "node:fs";
import path from "node:path";

import { runCommand } from "../lib/run-command.js";

export function parseDockerPorts(raw, requestedPort, protocol = "tcp") {
  if (!raw) return [];
  const containers = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  return containers.flatMap((container) => {
    const ports = String(container.Ports ?? "")
      .split(/,\s*/)
      .map(parsePublishedPort)
      .filter(Boolean)
      .filter((mapping) => mapping.hostPort === requestedPort && mapping.protocol === protocol);

    return ports.map((mapping) => ({
      containerId: String(container.ID ?? ""),
      container: String(container.Names ?? ""),
      image: String(container.Image ?? ""),
      hostAddress: mapping.hostAddress,
      hostPort: mapping.hostPort,
      containerPort: mapping.containerPort,
      protocol: mapping.protocol,
    }));
  });
}

export async function collectDocker(port, options = {}) {
  const runner = options.runCommand ?? runCommand;
  const args = ["ps", "--no-trunc", "--format", "{{json .}}"];
  let executable = options.dockerPath ?? "docker";
  let result = await runner(executable, args, { timeoutMs: options.timeoutMs });

  if (result.missing && !options.dockerPath) {
    const fallback = findDockerDesktopCli(options);
    if (fallback) {
      executable = fallback;
      result = await runner(executable, args, { timeoutMs: options.timeoutMs });
    }
  }

  if (result.missing) {
    return {
      status: "unavailable",
      executable: null,
      mappings: [],
      reason: options.dockerPath
        ? `Docker CLI was not found at ${options.dockerPath}.`
        : "Docker CLI was not found in PATH or Docker Desktop's standard install locations.",
    };
  }
  if (result.timedOut) {
    return { status: "error", executable, mappings: [], reason: "Docker query timed out." };
  }
  if (result.exitCode !== 0) {
    return {
      status: "unavailable",
      executable,
      mappings: [],
      reason: dockerDaemonError(result.stderr),
    };
  }

  try {
    return { status: "ok", executable, mappings: parseDockerPorts(result.stdout, port) };
  } catch {
    return { status: "error", executable, mappings: [], reason: "Docker returned unreadable container data." };
  }
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

function conciseError(value, fallback) {
  if (!value) return fallback;
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const relevant = lines.filter((line) => !/^warning:/i.test(line));
  return (relevant.at(-1) ?? lines.at(-1) ?? fallback).slice(0, 500);
}

function dockerDaemonError(value) {
  const detail = conciseError(value, "Docker is not running or is not reachable.");
  if (/failed to connect|cannot connect|docker_engine|daemon is not running/i.test(detail)) {
    return "Docker Desktop is installed, but its engine is not running or cannot be accessed. Start Docker Desktop and retry.";
  }
  return `Docker CLI found, but the engine is unavailable: ${detail}`;
}
