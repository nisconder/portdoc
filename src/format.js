export function formatText(report, options = {}) {
  const color = options.color ?? false;
  const paint = createPainter(color);
  const lines = [
    paint.heading(`PORT ${report.port}/TCP`),
    "",
    ...formatWindows(report.sources.windows),
    "",
    ...formatWsl(report.sources.wsl),
    "",
    ...formatDocker(report.sources.docker),
    "",
    "REACHABILITY",
    formatProbe("Windows", report.probes.windows),
    formatProbe("WSL", report.probes.wsl),
    "",
    paint.verdict(report.assessment.verdict),
    report.assessment.summary,
  ];

  for (const finding of report.assessment.findings) {
    lines.push(`  ${finding.severity === "high" ? "!" : "?"} ${finding.message}`);
  }

  lines.push("", `Confidence: ${report.assessment.confidence}`);
  return lines.join("\n");
}

function formatWindows(source) {
  const lines = ["WINDOWS"];
  if (source.status !== "ok") return [...lines, `  ? ${source.status} — ${source.reason}`];
  if (!source.listeners.length) return [...lines, "  — no TCP listener"];
  return [
    ...lines,
    ...source.listeners.map((item) => `  LISTEN  ${endpoint(item.address, item.port)}  ${owner(item.process, item.pid)}`),
  ];
}

function formatWsl(source) {
  const lines = [`WSL${source.distro ? ` [${source.distro}]` : ""}`];
  if (source.status !== "ok") return [...lines, `  ? ${source.status} — ${source.reason}`];
  if (!source.listeners.length) return [...lines, "  — no TCP listener"];
  return [
    ...lines,
    ...source.listeners.map((item) => `  LISTEN  ${endpoint(item.address, item.port)}  ${owner(item.process, item.pid)}`),
  ];
}

function formatDocker(source) {
  const lines = ["DOCKER"];
  if (source.status !== "ok") return [...lines, `  ? ${source.status} — ${source.reason}`];
  if (!source.mappings.length) return [...lines, "  — no published mapping"];
  return [
    ...lines,
    ...source.mappings.map(
      (item) => `  MAP     ${endpoint(item.hostAddress, item.hostPort)} -> ${item.container}:${item.containerPort}/tcp`,
    ),
  ];
}

function formatProbe(label, probe) {
  if (probe.reachable === true) return `  ${label.padEnd(7)} -> 127.0.0.1  reachable${probe.latencyMs == null ? "" : ` (${probe.latencyMs} ms)`}`;
  if (probe.reachable === false) return `  ${label.padEnd(7)} -> 127.0.0.1  not reachable${probe.reason ? ` (${probe.reason})` : ""}`;
  return `  ${label.padEnd(7)} -> 127.0.0.1  ${probe.status}${probe.reason ? ` (${probe.reason})` : ""}`;
}

function endpoint(address, port) {
  const formattedAddress = address.includes(":") && !address.startsWith("[") ? `[${address}]` : address;
  return `${formattedAddress}:${port}`;
}

function owner(processName, pid) {
  if (!processName && !pid) return "process details unavailable";
  if (!processName) return `PID ${pid}`;
  return pid ? `${processName} (PID ${pid})` : processName;
}

function createPainter(enabled) {
  const wrap = (code) => (value) => (enabled ? `\u001b[${code}m${value}\u001b[0m` : value);
  const colors = {
    heading: wrap("1;36"),
    green: wrap("1;32"),
    yellow: wrap("1;33"),
    red: wrap("1;31"),
  };
  return {
    heading: colors.heading,
    verdict(value) {
      if (value === "CONFLICT") return colors.red(value);
      if (value === "UNKNOWN") return colors.yellow(value);
      return colors.green(value);
    },
  };
}
