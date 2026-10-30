// PowerShell commands are suggestions only. The application never executes them.
export function buildNextActions(report) {
  const actions = [];
  const seen = new Set();
  for (const source of ["windows", "wsl"]) {
    for (const listener of report.sources[source].listeners) {
      const pid = listener.pid;
      if (!Number.isInteger(pid) || pid <= 0 || seen.has(`${source}:${pid}`)) continue;
      seen.add(`${source}:${pid}`);
      if (source === "windows") {
        actions.push({ source, code: "VERIFY_WINDOWS_PROCESS", command: `Get-Process -Id ${pid}` });
      } else if (report.sources.wsl.distro && report.sources.wsl.distro !== "unknown") {
        actions.push({ source, code: "VERIFY_WSL_PROCESS", command: `wsl -d ${quote(report.sources.wsl.distro)} -- ps -p ${pid} -o pid,comm,args` });
      }
    }
  }
  for (const mapping of report.sources.docker.mappings) {
    const container = mapping.containerId || mapping.container;
    if (!container || seen.has(`docker:${container}`)) continue;
    seen.add(`docker:${container}`);
    const id = /^[0-9a-f]{64}$/i.test(container) ? container.slice(0, 12) : container;
    const executable = report.sources.docker.executable;
    const cli = executable && executable !== "docker" ? `& ${quote(executable)}` : "docker";
    actions.push({ source: "docker", code: "VERIFY_DOCKER_MAPPING", command: `${cli} port ${quote(id)}` });
  }
  for (const family of new Set((report.reservations?.matches ?? []).map((range) => range.family))) {
    if (family === 4 || family === 6) actions.push({ source: "windows", code: "VERIFY_RESERVED_RANGE", command: `netsh interface ipv${family} show excludedportrange protocol=tcp` });
  }
  return actions;
}

function quote(value) {
  return `'${String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/'/g, "''")}'`;
}
