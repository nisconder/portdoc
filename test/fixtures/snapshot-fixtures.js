// Synthetic, stable fixtures. They are not live compatibility evidence.
export function diagnosisFixture() {
  const connect = (address, reachable) => ({ status: "ok", reachable, address, family: address.includes(":") ? 6 : 4, latencyMs: 2 });
  const windows = { localhost: connect("::1", false), ipv4: connect("127.0.0.1", true), ipv6: connect("::1", false) };
  const wsl = { localhost: connect("::1", false), ipv4: connect("127.0.0.1", true), ipv6: connect("::1", false) };
  return {
    schemaVersion: 3, kind: "diagnosis", sample: true,
    checkedAt: "2026-11-07T01:00:00.000Z", port: 5173, protocol: "tcp", target: "127.0.0.1",
    sources: {
      windows: { status: "ok", listeners: [{ address: "127.0.0.1", port: 5173, pid: 100, process: "node", path: "C:\\node\\node.exe", commandLine: "node C:\\shop\\server.js", cwd: null, projectPath: "C:\\shop", identitySource: "commandLine" }] },
      wsl: { status: "ok", distro: "Ubuntu", listeners: [{ address: "0.0.0.0", port: 5173, pid: 20, process: "node", projectPath: "/srv/shop", identitySource: "proc" }] },
      docker: { status: "ok", endpoint: "npipe:////./pipe/docker_engine", mappings: [{ containerId: "old-container", container: "shop-web-1", image: "web:v1", hostAddress: "127.0.0.1", hostPort: 5173, containerPort: 80, protocol: "tcp", composeProject: "shop", composeService: "web", projectPath: "C:\\shop" }] },
    },
    endpointMatrix: { windows, wsl }, probes: { windows: windows.ipv4, wsl: wsl.ipv4 },
    reservations: { status: "ok", ranges: [], matches: [], families: { ipv4: { status: "ok" }, ipv6: { status: "ok" } } },
    assessment: { verdict: "CONFLICT", confidence: "medium", summary: "Synthetic comparison fixture", findings: [] },
    nextActions: [],
  };
}

export function scanFixture() {
  const { sources } = diagnosisFixture();
  return {
    schemaVersion: 1, kind: "scan", checkedAt: "2026-11-07T01:00:00.000Z", sources,
    ports: [{ port: 5173, windows: sources.windows.listeners, wsl: sources.wsl.listeners, docker: sources.docker.mappings, overlap: true }],
    totalPorts: 1, overlapCount: 1, truncated: false, limit: 500,
  };
}

export function wrap(report = diagnosisFixture()) {
  return { schemaVersion: 1, kind: "snapshot", context: { hostname: "fixture-machine", platform: "win32", requestedDistro: "Ubuntu" }, report };
}
