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
  const result = await (options.runCommand ?? runCommand)(
    "docker",
    ["ps", "--no-trunc", "--format", "{{json .}}"],
    { timeoutMs: options.timeoutMs },
  );

  if (result.missing) {
    return { status: "unavailable", mappings: [], reason: "Docker CLI was not found." };
  }
  if (result.timedOut) {
    return { status: "error", mappings: [], reason: "Docker query timed out." };
  }
  if (result.exitCode !== 0) {
    return {
      status: "unavailable",
      mappings: [],
      reason: conciseError(result.stderr, "Docker is not running or is not reachable."),
    };
  }

  try {
    return { status: "ok", mappings: parseDockerPorts(result.stdout, port) };
  } catch {
    return { status: "error", mappings: [], reason: "Docker returned unreadable container data." };
  }
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
  return value ? value.split(/\r?\n/, 1)[0] : fallback;
}
