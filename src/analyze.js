export function analyze(report) {
  const windows = report.sources.windows.listeners;
  const wsl = report.sources.wsl.listeners;
  const docker = report.sources.docker.mappings;
  const findings = endpointFindings(report.endpointMatrix);
  const complete = Object.values(report.sources).every((source) => source.status === "ok");
  const claimCount = Number(windows.length > 0) + Number(wsl.length > 0) + Number(docker.length > 0);
  const allProbes = report.endpointMatrix
    ? Object.values(report.endpointMatrix).flatMap((side) => Object.values(side))
    : Object.values(report.probes);
  const incompleteProbes = allProbes.some((probe) => ["error", "unavailable"].includes(probe.status));
  const skippedProbes = allProbes.length > 0 && allProbes.every((probe) => probe.status === "skipped");
  const reservationMatches = report.reservations?.matches ?? [];
  const reservationsIncomplete = report.reservations && report.reservations.status !== "ok";
  if (reservationMatches.length) findings.push({
    severity: "medium",
    code: "WINDOWS_RESERVED_PORT",
    message: "This port is in a Windows excluded TCP range. New bindings may be restricted depending on the API and permissions; this does not identify an occupying process.",
  });
  if (reservationsIncomplete) findings.push({
    severity: "low",
    code: "RESERVATIONS_INCOMPLETE",
    message: "Windows excluded TCP ranges could not be fully checked. Successful listener checks do not prove a new bind will succeed.",
  });

  const independentWindows = windows.filter((listener) => !isForwarderProcess(listener));
  const nativeWsl = wsl.filter((listener) => !isDockerProcess(listener));
  if (independentWindows.some((left) => nativeWsl.some((right) => addressesOverlap(left.address, right.address)))) {
    findings.push({
      severity: "medium",
      code: "WINDOWS_WSL_COLLISION",
      message: "Windows and WSL report overlapping listeners. This may be a port conflict or expected network isolation; TCP probes do not identify which service receives traffic.",
    });
  }

  if (docker.some((mapping) => nativeWsl.some((listener) => addressesOverlap(mapping.hostAddress, listener.address)))) {
    findings.push({
      severity: "medium",
      code: "DOCKER_WSL_COLLISION",
      message: "Docker publishes this host port while WSL reports an overlapping listener. Review the mapping and network mode before treating this as a confirmed collision.",
    });
  }

  if (docker.some((mapping) => independentWindows.some((listener) => addressesOverlap(mapping.hostAddress, listener.address)))) {
    findings.push({
      severity: "medium",
      code: "WINDOWS_DOCKER_COLLISION",
      message: "Docker publishes this port and Windows reports an overlapping listener outside known forwarding processes. These claims need review; a shared port number alone does not prove misrouting.",
    });
  }

  const hasCollisionFinding = findings.some((finding) => finding.code.endsWith("_COLLISION"));
  if (hasCollisionFinding) {
    return {
      verdict: "CONFLICT",
      summary: "Overlapping port claims need review; actual traffic ownership is not proven.",
      confidence: "medium",
      findings,
    };
  }

  if (findings.some((finding) => finding.code === "LOCALHOST_RESOLUTION_MISMATCH")) {
    return {
      verdict: "UNKNOWN",
      summary: "localhost failed while a loopback literal connected. Compare address families and service bindings.",
      confidence: "medium",
      findings,
    };
  }

  const reachableWithoutOwner = claimCount === 0 && allProbes.some((probe) => probe.reachable === true);
  if (reachableWithoutOwner) {
    findings.push({
      severity: "medium",
      code: "HIDDEN_OWNER",
      message: "The port is reachable, but none of the available collectors identified its owner.",
    });
  }

  if (claimCount === 0) {
    if (reservationMatches.length) return {
      verdict: "UNKNOWN",
      summary: "No listener was found, but this port appears in a Windows excluded TCP range. Review the reservation before attempting a new bind.",
      confidence: "medium",
      findings,
    };
    if (!complete || reachableWithoutOwner || incompleteProbes || reservationsIncomplete) {
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
      if (incompleteProbes) findings.push({
        severity: "medium",
        code: "INCOMPLETE_PROBES",
        message: "One or more endpoint probes could not run; an unchecked endpoint is not evidence of a free port.",
      });
      return {
        verdict: "UNKNOWN",
        summary: "No owner was found, but the evidence is incomplete or contradictory.",
        confidence: "low",
        findings,
      };
    }

    return {
      verdict: "FREE",
      summary: `No Windows listener, WSL listener, or Docker mapping was found.${skippedProbes ? " Reachability probes were skipped; this does not test whether a new bind will succeed." : ""}`,
      confidence: "high",
      findings,
    };
  }

  if (wsl.length && !windows.length && !docker.length && windowsToWslReachability(report, wsl) === false) {
    findings.push({
      severity: "medium",
      code: "WSL_NOT_REACHABLE_FROM_WINDOWS",
      message: "WSL reports a listener, but its corresponding Windows loopback probes did not connect. Check service bindings and forwarding; the TCP results do not identify the cause.",
    });
    return {
      verdict: "UNKNOWN",
      summary: "A WSL listener exists, but the corresponding Windows loopback probes did not connect; review bindings and forwarding.",
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

  if (incompleteProbes) findings.push({
    severity: "low",
    code: "PARTIAL_PROBES",
    message: "An owner was found, but one or more endpoint probes could not run. Unchecked endpoints have unknown reachability.",
  });

  return {
    verdict: "OK",
    summary: describeSingleOwner(windows, wsl, docker),
    confidence: complete && !incompleteProbes && !reservationsIncomplete && !reservationMatches.length ? "high" : "medium",
    findings,
  };
}

function isDockerProcess(listener) {
  return /docker|com\.docker|vpnkit/i.test(listener.process ?? "");
}

function isForwarderProcess(listener) {
  return isDockerProcess(listener) || /^(wslrelay|wslhost)(\.exe)?$/i.test(listener.process ?? "");
}

function addressesOverlap(left, right) {
  // Missing address metadata cannot justify excluding a potential collision.
  if (!left || !right || ["*", "::", "[::]"].includes(left) || ["*", "::", "[::]"].includes(right)) return true;
  const normalize = (value) => value.replace(/^\[(.*)\]$/, "$1").replace(/^::ffff:/i, "");
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) return true;
  if (a === "0.0.0.0" && !b.includes(":")) return true;
  if (b === "0.0.0.0" && !a.includes(":")) return true;
  return false;
}

function endpointFindings(matrix) {
  if (!matrix) return [];
  const findings = [];
  for (const [side, probes] of Object.entries(matrix)) {
    const label = side === "windows" ? "Windows" : "WSL";
    const { localhost, ipv4, ipv6 } = probes;
    if (ipv4?.status === "ok" && ipv6?.status === "ok" && ipv4.reachable !== ipv6.reachable) {
      findings.push({
        severity: "low",
        code: "ENDPOINT_FAMILY_MISMATCH",
        side,
        message: `${label}: IPv4 and IPv6 loopback reachability differ. This can be an intentional service binding; use the endpoint matrix to choose a working address.`,
      });
    }
    if (localhost?.status === "ok" && localhost.reachable === false && [ipv4, ipv6].some((probe) => probe?.status === "ok" && probe.reachable === true)) {
      findings.push({
        severity: "medium",
        code: "LOCALHOST_RESOLUTION_MISMATCH",
        side,
        message: `${label}: localhost did not connect, but a literal loopback address did. The probe uses only the first resolved address without family fallback; review name resolution and IPv4/IPv6 bindings.`,
      });
    }
  }
  return findings;
}

function windowsToWslReachability(report, listeners) {
  const probes = report.endpointMatrix?.windows;
  if (!probes) return report.probes.windows.reachable;
  // Any successful local endpoint means that a blanket forwarding-failure
  // conclusion would be unsupported. A literal address selects its family;
  // a wildcard IPv6 listener may accept both families, so neither is assumed.
  if (Object.values(probes).some((probe) => probe.status === "ok" && probe.reachable === true)) return true;
  const keys = new Set(listeners.flatMap((listener) => {
    const address = listener.address?.replace(/^\[(.*)\]$/, "$1");
    if (address === "::" || address === "*") return ["ipv4", "ipv6"];
    return address?.includes(":") ? ["ipv6"] : ["ipv4"];
  }));
  const relevant = [...keys].map((key) => probes[key]);
  return relevant.every((probe) => probe?.status === "ok" && probe.reachable === false) ? false : null;
}

function describeSingleOwner(windows, wsl, docker) {
  if (docker.length) {
    const containerCount = new Set(docker.map((mapping) => mapping.containerId || mapping.container)).size;
    return `Docker publishes this port for ${containerCount} container${containerCount === 1 ? "" : "s"}.`;
  }
  if (windows.length) return `Windows owns this port with ${windows.length} listener${windows.length === 1 ? "" : "s"}.`;
  return `WSL owns this port with ${wsl.length} listener${wsl.length === 1 ? "" : "s"}.`;
}
