export function formatText(report, options = {}) {
  const width = normalizeWidth(options.width);
  const paint = createPainter(options.color ?? false);
  const lines = [
    `${paint.brand("PORTDOC")}  ${paint.muted(`${report.port}/tcp · ${report.target}`)}`,
    "",
    ...formatSummary(report, paint, width),
    "",
    paint.section("OWNERSHIP"),
    ...formatOwnership(report, paint, width),
    "",
    paint.section(`REACHABILITY  ${report.target}:${report.port}`),
    ...formatReachability(report, paint, width),
  ];

  if (report.assessment.findings.length) {
    lines.push("", paint.section("FINDINGS"), ...formatFindings(report.assessment.findings, paint, width));
  }

  const nextSteps = buildNextSteps(report);
  if (nextSteps.length) {
    lines.push("", paint.section("NEXT"), ...formatNextSteps(nextSteps, paint, width));
  }

  lines.push(
    "",
    ...wrapText(`Confidence ${report.assessment.confidence} · read-only · no settings changed`, width).map(paint.muted),
  );
  return lines.join("\n");
}

function formatSummary(report, paint, width) {
  const boxWidth = Math.max(32, Math.min(74, width));
  const innerWidth = boxWidth - 4;
  const verdict = report.assessment.verdict;
  const verdictText = `${verdictSymbol(verdict)} ${verdict}`;
  const summaryLines = wrapText(report.assessment.summary, innerWidth);
  const lines = [`╭${"─".repeat(boxWidth - 2)}╮`, cardLine(verdictText, paint.verdict(verdictText, verdict), innerWidth)];
  for (const line of summaryLines) lines.push(cardLine(line, paint.bold(line), innerWidth));
  lines.push(`╰${"─".repeat(boxWidth - 2)}╯`);
  return lines;
}

function cardLine(raw, styled, innerWidth) {
  return `│ ${styled}${" ".repeat(Math.max(0, innerWidth - raw.length))} │`;
}

function formatOwnership(report, paint, width) {
  return [
    ...formatListenerSource("Windows", report.sources.windows, paint, width),
    ...formatListenerSource(
      report.sources.wsl.distro ? `WSL · ${report.sources.wsl.distro}` : "WSL",
      report.sources.wsl,
      paint,
      width,
    ),
    ...formatDocker(report.sources.docker, paint, width),
  ];
}

function formatListenerSource(label, source, paint, width) {
  if (source.status !== "ok") {
    return formatRow({ symbol: "!", label, primary: statusLabel(source.status), detail: source.reason, tone: "warn" }, paint, width);
  }
  if (!source.listeners.length) {
    return formatRow({ symbol: "○", label, primary: "No listener", tone: "muted" }, paint, width);
  }

  return source.listeners.flatMap((item, index) =>
    formatRow(
      {
        symbol: "●",
        label: index === 0 ? label : "",
        primary: owner(item.process, item.pid),
        detail: endpoint(item.address, item.port),
        tone: "info",
      },
      paint,
      width,
    ),
  );
}

function formatDocker(source, paint, width) {
  if (source.status !== "ok") {
    return formatRow(
      { symbol: "!", label: "Docker", primary: statusLabel(source.status), detail: source.reason, tone: "warn" },
      paint,
      width,
    );
  }
  if (!source.mappings.length) {
    return formatRow({ symbol: "○", label: "Docker", primary: "No published mapping", tone: "muted" }, paint, width);
  }

  return source.mappings.flatMap((item, index) =>
    formatRow(
      {
        symbol: "●",
        label: index === 0 ? "Docker" : "",
        primary: `${item.container} · ${item.image}`,
        detail: `${endpoint(item.hostAddress, item.hostPort)} → ${item.containerPort}/tcp`,
        tone: "info",
      },
      paint,
      width,
    ),
  );
}

function formatReachability(report, paint, width) {
  return [
    ...formatProbe("Windows", report.probes.windows, paint, width),
    ...formatProbe("WSL", report.probes.wsl, paint, width),
  ];
}

function formatProbe(label, probe, paint, width) {
  if (probe.reachable === true) {
    return formatRow(
      {
        symbol: "✓",
        label,
        primary: `Reachable${probe.latencyMs == null ? "" : ` · ${probe.latencyMs} ms`}`,
        tone: "good",
      },
      paint,
      width,
    );
  }
  if (probe.reachable === false) {
    return formatRow(
      { symbol: "×", label, primary: "Not reachable", detail: probe.reason, tone: "bad" },
      paint,
      width,
    );
  }
  return formatRow(
    {
      symbol: probe.status === "skipped" ? "—" : "!",
      label,
      primary: statusLabel(probe.status),
      detail: probe.reason,
      tone: probe.status === "skipped" ? "muted" : "warn",
    },
    paint,
    width,
  );
}

function formatFindings(findings, paint, width) {
  return findings.flatMap((finding) => {
    const tone = finding.severity === "high" ? "bad" : finding.severity === "medium" ? "warn" : "info";
    return formatRow({ symbol: finding.severity === "high" ? "!" : "?", label: "", primary: finding.message, tone }, paint, width);
  });
}

function formatNextSteps(steps, paint, width) {
  return steps.flatMap((step, index) => {
    const prefix = `  ${index + 1}. `;
    const wrapped = wrapText(step, Math.max(20, width - prefix.length));
    return wrapped.map((line, lineIndex) => `${lineIndex === 0 ? prefix : " ".repeat(prefix.length)}${paint.text(line)}`);
  });
}

function formatRow(row, paint, width) {
  const labelWidth = 14;
  const prefix = `  ${row.symbol} ${row.label.padEnd(labelWidth)} `;
  const continuation = " ".repeat(prefix.length);
  const available = Math.max(20, width - prefix.length);
  const tone = paint[row.tone] ?? paint.text;
  const primaryLines = wrapText(row.primary, available);
  const lines = primaryLines.map((line, index) => `${index === 0 ? paint.symbol(row.symbol, row.tone) + ` ${row.label.padEnd(labelWidth)} ` : continuation}${tone(line)}`);

  if (row.detail) {
    for (const detailLine of wrapText(row.detail, available)) {
      lines.push(`${continuation}${paint.muted(detailLine)}`);
    }
  }
  return lines;
}

function buildNextSteps(report) {
  const steps = new Set();
  const { windows, wsl, docker } = report.sources;
  const findingCodes = new Set(report.assessment.findings.map((finding) => finding.code));

  if (docker.status !== "ok") {
    if (/engine is not running|cannot be accessed/i.test(docker.reason ?? "")) {
      steps.add("Start Docker Desktop, wait until its engine is running, then retry.");
    } else if (/not found/i.test(docker.reason ?? "")) {
      steps.add("Install Docker Desktop or pass its CLI location with --docker-path <file>.");
    }
  }
  if (wsl.status !== "ok") {
    if (/E_ACCESSDENIED/i.test(wsl.reason ?? "")) {
      steps.add("Run wsl --status in a normal Windows terminal, resolve the WSL access error, then retry.");
    } else if (/ss command/i.test(wsl.reason ?? "")) {
      steps.add("Install iproute2 inside the selected WSL distribution so portdoc can use ss.");
    } else {
      steps.add("Check wsl --status and verify that the selected WSL distribution can start.");
    }
  }
  if (windows.status !== "ok") steps.add("Retry from a normal Windows terminal that can run netstat.exe.");
  if (findingCodes.has("WINDOWS_WSL_COLLISION")) {
    steps.add("Choose one owner: stop the Windows listener or move the WSL service to another port.");
  }
  if (findingCodes.has("DOCKER_WSL_COLLISION")) {
    steps.add("Change either the Docker host mapping or the native WSL service port.");
  }
  if (findingCodes.has("WINDOWS_DOCKER_COLLISION")) {
    steps.add("Stop or move the Windows listener before publishing this Docker host port.");
  }
  if (findingCodes.has("WSL_NOT_REACHABLE_FROM_WINDOWS")) {
    steps.add("Confirm the WSL service binds to 0.0.0.0, then review WSL localhost forwarding or mirrored networking.");
  }

  return [...steps];
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

function statusLabel(status) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function verdictSymbol(verdict) {
  if (verdict === "CONFLICT") return "×";
  if (verdict === "UNKNOWN") return "?";
  return "✓";
}

function normalizeWidth(value) {
  const width = Number(value);
  if (!Number.isFinite(width)) return 80;
  return Math.max(36, Math.min(100, Math.floor(width)));
}

function wrapText(value, width) {
  const text = String(value ?? "").trim();
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    if (!line) {
      line = word;
    } else if (line.length + word.length + 1 <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function createPainter(enabled) {
  const wrap = (code) => (value) => (enabled ? `\u001b[${code}m${value}\u001b[0m` : value);
  const text = (value) => value;
  const colors = { green: wrap("1;32"), yellow: wrap("1;33"), red: wrap("1;31"), cyan: wrap("1;36") };
  return {
    text,
    bold: wrap("1"),
    brand: wrap("1;36"),
    section: wrap("1;37"),
    muted: wrap("2"),
    good: colors.green,
    warn: colors.yellow,
    bad: colors.red,
    info: colors.cyan,
    symbol(value, tone) {
      return (this[tone] ?? text)(`  ${value}`);
    },
    verdict(value, verdict) {
      if (verdict === "CONFLICT") return colors.red(value);
      if (verdict === "UNKNOWN") return colors.yellow(value);
      return colors.green(value);
    },
  };
}
