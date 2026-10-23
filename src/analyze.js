export function analyze(report) {
  const windows = report.sources.windows.listeners;
  const wsl = report.sources.wsl.listeners;
  const docker = report.sources.docker.mappings;
  const findings = [];
  const complete = Object.values(report.sources).every((source) => source.status === "ok");
  const claimCount = Number(windows.length > 0) + Number(wsl.length > 0) + Number(docker.length > 0);

  if (windows.length && wsl.length) {
    findings.push({
      severity: "high",
      code: "WINDOWS_WSL_COLLISION",
      message: "Windows and WSL both report a TCP listener on this port; Windows localhost traffic may shadow the WSL service.",
    });
  }

  if (docker.length && wsl.length) {
    findings.push({
      severity: "high",
      code: "DOCKER_WSL_COLLISION",
      message: "Docker publishes this host port while WSL also has a native listener on it.",
    });
  }

  if (docker.length && windows.length && !windows.every(isDockerProcess)) {
    findings.push({
      severity: "high",
      code: "WINDOWS_DOCKER_COLLISION",
      message: "Docker publishes this port, but Windows also reports a listener that does not look like Docker's forwarding process.",
    });
  }

  const hasHighFinding = findings.some((finding) => finding.severity === "high");
  if (hasHighFinding) {
    return {
      verdict: "CONFLICT",
      summary: "Multiple independent layers claim this port.",
      confidence: "high",
      findings,
    };
  }

  const reachableWithoutOwner = claimCount === 0 && Object.values(report.probes).some((probe) => probe.reachable === true);
  if (reachableWithoutOwner) {
    findings.push({
      severity: "medium",
      code: "HIDDEN_OWNER",
      message: "The port is reachable, but none of the available collectors identified its owner.",
    });
  }

  if (claimCount === 0) {
    if (!complete || reachableWithoutOwner) {
      const unavailable = Object.entries(report.sources)
        .filter(([, source]) => source.status !== "ok")
        .map(([name]) => name);
      if (unavailable.length) {
        findings.push({
          severity: "medium",
          code: "INCOMPLETE_EVIDENCE",
          message: `Could not fully inspect: ${unavailable.join(", ")}.`,
        });
      }
      return {
        verdict: "UNKNOWN",
        summary: "No owner was found, but the evidence is incomplete or contradictory.",
        confidence: "low",
        findings,
      };
    }

    return {
      verdict: "FREE",
      summary: "No Windows listener, WSL listener, or Docker mapping was found.",
      confidence: "high",
      findings,
    };
  }

  if (wsl.length && report.probes.windows.reachable === false) {
    findings.push({
      severity: "medium",
      code: "WSL_NOT_REACHABLE_FROM_WINDOWS",
      message: "WSL is listening, but Windows could not connect through 127.0.0.1.",
    });
    return {
      verdict: "UNKNOWN",
      summary: "A WSL listener exists, but Windows localhost forwarding is not working.",
      confidence: "medium",
      findings,
    };
  }

  if (!complete) {
    const unavailable = Object.entries(report.sources)
      .filter(([, source]) => source.status !== "ok")
      .map(([name]) => name);
    findings.push({
      severity: "low",
      code: "PARTIAL_INSPECTION",
      message: `Owner found, but could not inspect: ${unavailable.join(", ")}.`,
    });
  }

  return {
    verdict: "OK",
    summary: describeSingleOwner(windows, wsl, docker),
    confidence: complete ? "high" : "medium",
    findings,
  };
}

function isDockerProcess(listener) {
  return /docker|com\.docker|vpnkit/i.test(listener.process ?? "");
}

function describeSingleOwner(windows, wsl, docker) {
  if (docker.length) {
    const containerCount = new Set(docker.map((mapping) => mapping.containerId || mapping.container)).size;
    return `Docker publishes this port for ${containerCount} container${containerCount === 1 ? "" : "s"}.`;
  }
  if (windows.length) return `Windows owns this port with ${windows.length} listener${windows.length === 1 ? "" : "s"}.`;
  return `WSL owns this port with ${wsl.length} listener${wsl.length === 1 ? "" : "s"}.`;
}
