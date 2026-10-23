import { createMessages } from "./i18n.js";

export function formatText(report, options = {}) {
  const width = normalizeWidth(options.width);
  const paint = createPainter(options.color ?? false);
  const messages = createMessages(options.language ?? "en");
  const lines = [
    `${paint.brand("PORTDOC")}  ${paint.muted(`${report.port}/tcp · ${report.target}`)}`,
    "",
    ...formatSummary(report, paint, width, messages),
    "",
    paint.section(messages.t("ownership")),
    ...formatOwnership(report, paint, width, messages),
    "",
    paint.section(`${messages.t("reachability")}  ${report.target}:${report.port}`),
    ...formatReachability(report, paint, width, messages),
  ];

  if (report.assessment.findings.length) {
    lines.push("", paint.section(messages.t("findings")), ...formatFindings(report.assessment.findings, paint, width, messages));
  }

  const nextSteps = buildNextSteps(report, messages);
  if (nextSteps.length) {
    lines.push("", paint.section(messages.t("next")), ...formatNextSteps(nextSteps, paint, width));
  }

  lines.push(
    "",
    ...wrapText(
      messages.t("confidence", { value: messages.t(`confidence${capitalize(report.assessment.confidence)}`) }),
      width,
    ).map(paint.muted),
  );
  return lines.join("\n");
}

function formatSummary(report, paint, width, messages) {
  const boxWidth = Math.max(32, Math.min(74, width));
  const innerWidth = boxWidth - 4;
  const verdict = report.assessment.verdict;
  const verdictText = `${verdictSymbol(verdict)} ${messages.t(`verdict${verdict}`)}`;
  const summaryLines = wrapText(localizedSummary(report, messages), innerWidth);
  const lines = [`╭${"─".repeat(boxWidth - 2)}╮`, cardLine(verdictText, paint.verdict(verdictText, verdict), innerWidth)];
  for (const line of summaryLines) lines.push(cardLine(line, paint.bold(line), innerWidth));
  lines.push(`╰${"─".repeat(boxWidth - 2)}╯`);
  return lines;
}

function cardLine(raw, styled, innerWidth) {
  return `│ ${styled}${" ".repeat(Math.max(0, innerWidth - displayWidth(raw)))} │`;
}

function formatOwnership(report, paint, width, messages) {
  return [
    ...formatListenerSource(messages.t("windows"), report.sources.windows, paint, width, messages),
    ...formatListenerSource(
      report.sources.wsl.distro ? `${messages.t("wsl")} · ${report.sources.wsl.distro}` : messages.t("wsl"),
      report.sources.wsl,
      paint,
      width,
      messages,
    ),
    ...formatDocker(report.sources.docker, paint, width, messages),
  ];
}

function formatListenerSource(label, source, paint, width, messages) {
  if (source.status !== "ok") {
    return formatRow({ symbol: "!", label, primary: statusLabel(source.status, messages), detail: localizeReason(source.reason, messages), tone: "warn" }, paint, width);
  }
  if (!source.listeners.length) {
    return formatRow({ symbol: "○", label, primary: messages.t("noListener"), tone: "muted" }, paint, width);
  }

  return source.listeners.flatMap((item, index) =>
    formatRow(
      {
        symbol: "●",
        label: index === 0 ? label : "",
        primary: owner(item.process, item.pid, messages),
        detail: endpoint(item.address, item.port),
        tone: "info",
      },
      paint,
      width,
    ),
  );
}

function formatDocker(source, paint, width, messages) {
  if (source.status !== "ok") {
    return formatRow(
      { symbol: "!", label: messages.t("docker"), primary: statusLabel(source.status, messages), detail: localizeReason(source.reason, messages), tone: "warn" },
      paint,
      width,
    );
  }
  if (!source.mappings.length) {
    return formatRow({ symbol: "○", label: messages.t("docker"), primary: messages.t("noMapping"), tone: "muted" }, paint, width);
  }

  return source.mappings.flatMap((item, index) =>
    formatRow(
      {
        symbol: "●",
        label: index === 0 ? messages.t("docker") : "",
        primary: `${item.container} · ${item.image}`,
        detail: `${endpoint(item.hostAddress, item.hostPort)} → ${item.containerPort}/tcp`,
        tone: "info",
      },
      paint,
      width,
    ),
  );
}

function formatReachability(report, paint, width, messages) {
  return [
    ...formatProbe(messages.t("windows"), report.probes.windows, paint, width, messages),
    ...formatProbe(messages.t("wsl"), report.probes.wsl, paint, width, messages),
  ];
}

function formatProbe(label, probe, paint, width, messages) {
  if (probe.reachable === true) {
    return formatRow(
      {
        symbol: "✓",
        label,
        primary: `${messages.t("reachable")}${probe.latencyMs == null ? "" : ` · ${probe.latencyMs} ms`}`,
        tone: "good",
      },
      paint,
      width,
    );
  }
  if (probe.reachable === false) {
    return formatRow(
      { symbol: "×", label, primary: messages.t("notReachable"), detail: localizeReason(probe.reason, messages), tone: "bad" },
      paint,
      width,
    );
  }
  return formatRow(
    {
      symbol: probe.status === "skipped" ? "—" : "!",
      label,
      primary: statusLabel(probe.status, messages),
      detail: localizeReason(probe.reason, messages),
      tone: probe.status === "skipped" ? "muted" : "warn",
    },
    paint,
    width,
  );
}

function formatFindings(findings, paint, width, messages) {
  return findings.flatMap((finding) => {
    const tone = finding.severity === "high" ? "bad" : finding.severity === "medium" ? "warn" : "info";
    return formatRow({ symbol: finding.severity === "high" ? "!" : "?", label: "", primary: localizedFinding(finding, messages), tone }, paint, width);
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
  const paddedLabel = padDisplay(row.label, labelWidth);
  const prefix = `  ${row.symbol} ${paddedLabel} `;
  const prefixWidth = displayWidth(prefix);
  const continuation = " ".repeat(prefixWidth);
  const available = Math.max(20, width - prefixWidth);
  const tone = paint[row.tone] ?? paint.text;
  const primaryLines = wrapText(row.primary, available);
  const lines = primaryLines.map((line, index) => `${index === 0 ? paint.symbol(row.symbol, row.tone) + ` ${paddedLabel} ` : continuation}${tone(line)}`);

  if (row.detail) {
    for (const detailLine of wrapText(row.detail, available)) {
      lines.push(`${continuation}${paint.muted(detailLine)}`);
    }
  }
  return lines;
}

function buildNextSteps(report, messages) {
  const steps = new Set();
  const { windows, wsl, docker } = report.sources;
  const findingCodes = new Set(report.assessment.findings.map((finding) => finding.code));

  if (docker.status !== "ok") {
    if (/engine is not running|cannot be accessed/i.test(docker.reason ?? "")) {
      steps.add(messages.t("nextDockerStart"));
    } else if (/not found/i.test(docker.reason ?? "")) {
      steps.add(messages.t("nextDockerInstall"));
    }
  }
  if (wsl.status !== "ok") {
    if (/E_ACCESSDENIED/i.test(wsl.reason ?? "")) {
      steps.add(messages.t("nextWslAccess"));
    } else if (/ss command/i.test(wsl.reason ?? "")) {
      steps.add(messages.t("nextInstallSs"));
    } else {
      steps.add(messages.t("nextWslCheck"));
    }
  }
  if (windows.status !== "ok") steps.add(messages.t("nextWindowsCheck"));
  if (findingCodes.has("WINDOWS_WSL_COLLISION")) {
    steps.add(messages.t("nextWindowsWsl"));
  }
  if (findingCodes.has("DOCKER_WSL_COLLISION")) {
    steps.add(messages.t("nextDockerWsl"));
  }
  if (findingCodes.has("WINDOWS_DOCKER_COLLISION")) {
    steps.add(messages.t("nextWindowsDocker"));
  }
  if (findingCodes.has("WSL_NOT_REACHABLE_FROM_WINDOWS")) {
    steps.add(messages.t("nextWslForwarding"));
  }

  return [...steps];
}

function endpoint(address, port) {
  const formattedAddress = address.includes(":") && !address.startsWith("[") ? `[${address}]` : address;
  return `${formattedAddress}:${port}`;
}

function owner(processName, pid, messages) {
  if (!processName && !pid) return messages.t("processUnavailable");
  if (!processName) return `PID ${pid}`;
  return pid ? `${processName} (PID ${pid})` : processName;
}

function statusLabel(status, messages) {
  const key = `status${capitalize(status)}`;
  const translated = messages.t(key);
  return translated === key ? capitalize(status) : translated;
}

function verdictSymbol(verdict) {
  if (verdict === "CONFLICT") return "×";
  if (verdict === "UNKNOWN") return "?";
  return "✓";
}

function localizedSummary(report, messages) {
  const { verdict } = report.assessment;
  if (verdict === "FREE") return messages.t("summaryFREE");
  if (verdict === "CONFLICT") return messages.t("summaryCONFLICT");
  if (verdict === "UNKNOWN") {
    if (report.assessment.findings.some((finding) => finding.code === "WSL_NOT_REACHABLE_FROM_WINDOWS")) {
      return messages.t("summaryWslForwarding");
    }
    return messages.t("summaryUNKNOWN");
  }

  const { windows, wsl, docker } = report.sources;
  if (docker.mappings.length) {
    const count = new Set(docker.mappings.map((mapping) => mapping.containerId || mapping.container)).size;
    return messages.t("ownerDocker", { count });
  }
  if (windows.listeners.length) return messages.t("ownerWindows", { count: windows.listeners.length });
  if (wsl.listeners.length) return messages.t("ownerWsl", { count: wsl.listeners.length });
  return report.assessment.summary;
}

function localizedFinding(finding, messages) {
  const key = `finding${finding.code}`;
  const translated = messages.t(key);
  return translated === key ? finding.message : translated;
}

function localizeReason(reason, messages) {
  if (!reason) return reason;
  if (/engine is not running|cannot be accessed/i.test(reason)) return messages.t("reasonDockerEngine");
  if (/Docker CLI was not found/i.test(reason)) return messages.t("reasonDockerMissing");
  if (/E_ACCESSDENIED/i.test(reason)) return messages.t("reasonWslAccess");
  if (/Disabled by --no-probe/i.test(reason)) return messages.t("reasonProbeDisabled");
  return reason;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
    if (displayWidth(word) > width) {
      if (line) {
        lines.push(line);
        line = "";
      }
      const chunks = splitByWidth(word, width);
      lines.push(...chunks.slice(0, -1));
      line = chunks.at(-1) ?? "";
    } else if (!line) {
      line = word;
    } else if (displayWidth(line) + displayWidth(word) + 1 <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function splitByWidth(value, width) {
  const chunks = [];
  let chunk = "";
  let chunkWidth = 0;
  for (const character of value) {
    const characterWidth = displayWidth(character);
    if (chunk && chunkWidth + characterWidth > width) {
      chunks.push(chunk);
      chunk = "";
      chunkWidth = 0;
    }
    chunk += character;
    chunkWidth += characterWidth;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function padDisplay(value, width) {
  return `${value}${" ".repeat(Math.max(0, width - displayWidth(value)))}`;
}

function displayWidth(value) {
  let width = 0;
  for (const character of String(value)) {
    const codePoint = character.codePointAt(0);
    width += isWideCharacter(codePoint) ? 2 : 1;
  }
  return width;
}

function isWideCharacter(codePoint) {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  );
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
